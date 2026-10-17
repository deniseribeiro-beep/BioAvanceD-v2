import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const require = createRequire(import.meta.url);
const {
  backfillParticipantIdentities,
  checkParticipantIdentityParity,
  moveParticipantContactToIdentity
} = require('../../../src/services/participant-identity-backfill.service');

/**
 * Real query-matching fake, same shape as
 * sealed-snapshot-backfill.service.test.js's — exact-match filters plus a
 * plain `find().toArray()` chain.
 */
function createFakeCollection(name) {
  const docs = [];
  const matches = (doc, filter) =>
    Object.keys(filter).every((key) => String(doc[key]) === String(filter[key]));
  let autoId = 1;
  return {
    name,
    docs,
    async insertOne(doc) {
      const _id = doc._id || `${name}-${autoId++}`;
      const stored = { _id, ...doc };
      docs.push(stored);
      return { insertedId: _id };
    },
    async findOne(filter = {}) {
      return docs.find((d) => matches(d, filter)) || null;
    },
    find(filter = {}) {
      const current = docs.filter((d) => matches(d, filter));
      return { toArray: async () => current };
    },
    // #1166 slice 4: $set/$unset only, plus a hook to refuse a write the way
    // a unique index would.
    refuseUpdate: null,
    async updateOne(filter, update = {}) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (this.refuseUpdate && this.refuseUpdate(doc, update)) {
        const error = new Error('E11000 duplicate key error');
        error.code = 11000;
        error.keyPattern = { phoneHash: 1 };
        throw error;
      }
      Object.assign(doc, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete doc[key];
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

function createFakeDb(seed = {}) {
  const collections = {
    patients: createFakeCollection('patients'),
    participantIdentities: createFakeCollection('participantIdentities')
  };
  for (const [key, docs] of Object.entries(seed)) {
    for (const doc of docs) collections[key].docs.push(doc);
  }
  return {
    collections,
    collection(collectionName) {
      if (!collections[collectionName]) throw new Error(`unexpected collection: ${collectionName}`);
      return collections[collectionName];
    }
  };
}

describe('participant-identity-backfill.service#backfillParticipantIdentities', () => {
  it('creates a ParticipantIdentity for a pre-#363 Patient with no matching identity record', async () => {
    const db = createFakeDb({
      patients: [
        {
          _id: 'p1',
          participantId: '11111111',
          patientName: 'Paciente Legado',
          birthDate: new Date('1985-03-10'),
          identityDocument: '11144477735'
        }
      ]
    });

    const { summary } = await backfillParticipantIdentities(db);

    expect(summary).toEqual({
      patientsProcessed: 1,
      identitiesCreated: 1,
      skippedNoParticipantId: 0,
      skippedAlreadyPresent: 0
    });
    expect(db.collections.participantIdentities.docs).toHaveLength(1);
    const created = db.collections.participantIdentities.docs[0];
    expect(created.participantId).toBe('11111111');
    // #1104: ciphertext-only -- no plaintext at rest, recovered by decryption.
    const identityCrypto = require('../../../src/services/participantIdentity.service');
    expect(created.patientName).toBeNull();
    expect(identityCrypto.decryptIdentity(created).patientName).toBe('Paciente Legado');
    // Backfilled records go through the same #566 encryption as new ones.
    expect(created.identityDocumentCiphertext).toMatchObject({ alg: 'aes-256-gcm' });
  });

  it('is a no-op for a Patient that already has a matching ParticipantIdentity (safe to run more than once)', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '11111111', patientName: 'Paciente Migrado', birthDate: new Date('1985-03-10'), identityDocument: '11144477735' }],
      participantIdentities: [{ _id: 'i1', participantId: '11111111', patientName: 'Paciente Migrado', birthDate: new Date('1985-03-10'), identityDocument: '11144477735' }]
    });

    const { summary } = await backfillParticipantIdentities(db);

    expect(summary).toEqual({
      patientsProcessed: 1,
      identitiesCreated: 0,
      skippedNoParticipantId: 0,
      skippedAlreadyPresent: 1
    });
    expect(db.collections.participantIdentities.docs).toHaveLength(1);
  });

  it('skips a Patient document with no participantId rather than throwing', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', patientName: 'Sem Participant Id', birthDate: new Date('1990-01-01'), identityDocument: '00000000000' }]
    });

    const { summary } = await backfillParticipantIdentities(db);

    expect(summary).toEqual({
      patientsProcessed: 1,
      identitiesCreated: 0,
      skippedNoParticipantId: 1,
      skippedAlreadyPresent: 0
    });
    expect(db.collections.participantIdentities.docs).toHaveLength(0);
  });

  it('does not copy representative/email/phone fields from the Patient document (out of #565 scope)', async () => {
    const db = createFakeDb({
      patients: [
        {
          _id: 'p1',
          participantId: '22222222',
          patientName: 'Paciente Falecido',
          birthDate: new Date('1970-06-15'),
          identityDocument: '22233344455',
          email: 'paciente@example.com',
          phone: '11999998888',
          isDeceased: true,
          representativeName: 'Representante Legal',
          // Already encrypted-and-nulled by patient.service.js's unrelated
          // representativeIdentityDocument encryption — must not be copied.
          representativeIdentityDocument: null,
          representativeIdentityDocumentEncrypted: { alg: 'aes-256-gcm', keyId: 'test-key-1', iv: 'x', tag: 'y', data: 'z' }
        }
      ]
    });

    const { summary } = await backfillParticipantIdentities(db);

    expect(summary.identitiesCreated).toBe(1);
    const created = db.collections.participantIdentities.docs[0];
    expect(created.email).toBeNull();
    expect(created.phone).toBeNull();
    expect(created.representativeName).toBeNull();
    expect(created).not.toHaveProperty('representativeIdentityDocumentEncrypted');
  });
});

describe('participant-identity-backfill.service#checkParticipantIdentityParity', () => {
  it('reports full parity when every Patient has a matching, value-consistent ParticipantIdentity', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '11111111', patientName: 'Paciente Ok', birthDate: new Date('1985-03-10'), identityDocument: '11144477735' }],
      participantIdentities: [{ _id: 'i1', participantId: '11111111', patientName: 'Paciente Ok', birthDate: new Date('1985-03-10'), identityDocument: '11144477735' }]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity).toEqual({ isFullParity: true, totalPatients: 1, missing: [], drifted: [] });
  });

  it('flags a Patient with no matching ParticipantIdentity record as missing', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '33333333', patientName: 'Sem Identidade', birthDate: new Date('1990-01-01'), identityDocument: '00000000000' }]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity.isFullParity).toBe(false);
    expect(parity.missing).toEqual(['33333333']);
    expect(parity.drifted).toEqual([]);
  });

  it('flags a Patient whose fields drifted from the ParticipantIdentity mirror', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '44444444', patientName: 'Nome Atualizado', birthDate: new Date('1985-03-10'), identityDocument: '11144477735' }],
      participantIdentities: [{ _id: 'i1', participantId: '44444444', patientName: 'Nome Antigo', birthDate: new Date('1985-03-10'), identityDocument: '11144477735' }]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity.isFullParity).toBe(false);
    expect(parity.missing).toEqual([]);
    expect(parity.drifted).toEqual(['44444444']);
  });

  it('resolves parity through ciphertext-only ParticipantIdentity records (decrypts before comparing)', async () => {
    const participantIdentityService = require('../../../src/services/participantIdentity.service');
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '55555555',
      patientName: 'Paciente Cifrado',
      birthDate: new Date('1992-08-20'),
      identityDocument: '55566677788'
    });
    const ciphertextOnly = { ...encrypted, patientName: null, birthDate: null, identityDocument: null };

    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '55555555', patientName: 'Paciente Cifrado', birthDate: new Date('1992-08-20'), identityDocument: '55566677788' }],
      participantIdentities: [ciphertextOnly]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity).toEqual({ isFullParity: true, totalPatients: 1, missing: [], drifted: [] });
  });

  // #1111: every fixture above is a pre-#363-shaped Patient carrying the
  // legacy civil-identity fields -- the population this function was
  // written for, and no longer the population that exists. #575 removed
  // all three fields from Patient, so the cases below are what
  // createPatient actually writes today.
  it('reports full parity for a post-#575 Patient whose identity mirror is correct', async () => {
    const participantIdentityService = require('../../../src/services/participantIdentity.service');
    const mirrored = participantIdentityService.encryptIdentityFields({
      participantId: '66666666',
      patientName: 'Paciente Pos 575',
      birthDate: new Date('1991-04-05'),
      identityDocument: '11144477735'
    });

    const db = createFakeDb({
      // omitLegacyIdentityFields strips patientName/birthDate/
      // identityDocument before insertOne, so the Patient carries none.
      patients: [{ _id: 'p1', participantId: '66666666' }],
      participantIdentities: [mirrored]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity).toEqual({ isFullParity: true, totalPatients: 1, missing: [], drifted: [] });
  });

  it('still flags a post-#575 Patient whose identity mirror holds no civil identity', async () => {
    // backfillParticipantIdentities above will happily create exactly this
    // record for a post-#575 Patient -- ParticipantIdentityModel.create
    // nulls every absent field and only requires participantId. Calling it
    // parity would open #574 gate on data that was never backfilled, which
    // is the one thing this check exists to prevent.
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '77777777' }],
      participantIdentities: [{ _id: 'i1', participantId: '77777777', patientName: null, birthDate: null, identityDocument: null }]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity.isFullParity).toBe(false);
    expect(parity.drifted).toEqual(['77777777']);
  });

  it('reports full parity for a pre-#363 Patient whose legacy identityDocument is punctuated', async () => {
    // #1109 canonicalized identityDocument to digits-only at rest, while a
    // legacy Patient field keeps whatever spelling was typed. Comparing the
    // two spellings verbatim reported drift for every punctuated legacy row.
    const participantIdentityService = require('../../../src/services/participantIdentity.service');
    const mirrored = participantIdentityService.encryptIdentityFields({
      participantId: '88888888',
      patientName: 'Paciente Legado',
      birthDate: new Date('1979-11-30'),
      identityDocument: '111.444.777-35'
    });

    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '88888888', patientName: 'Paciente Legado', birthDate: new Date('1979-11-30'), identityDocument: '111.444.777-35' }],
      participantIdentities: [mirrored]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity).toEqual({ isFullParity: true, totalPatients: 1, missing: [], drifted: [] });
  });

  it('ignores a Patient document with no participantId', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', patientName: 'Sem Id', birthDate: new Date('1990-01-01'), identityDocument: '00000000000' }]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity).toEqual({ isFullParity: true, totalPatients: 1, missing: [], drifted: [] });
  });
});

describe('participant-identity-backfill.service#moveParticipantContactToIdentity (#1166 slice 4)', () => {
  const participantIdentityService = require('../../../src/services/participantIdentity.service');

  it('copies a Patient contact the identity record lacks, encrypted and hashed, then removes it from the Patient', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '61616161', email: 'contato@example.com', phone: '11988887777' }],
      participantIdentities: [{ _id: 'i1', participantId: '61616161', patientName: 'Paciente', email: null, phone: null }]
    });

    const { summary } = await moveParticipantContactToIdentity(db);

    const patient = db.collections.patients.docs[0];
    expect(patient).not.toHaveProperty('email');
    expect(patient).not.toHaveProperty('phone');
    const identity = db.collections.participantIdentities.docs[0];
    expect(identity.emailCiphertext).toBeTruthy();
    expect(identity.phoneCiphertext).toBeTruthy();
    expect(identity.phoneHash).toBe(participantIdentityService.computeBlindIndex('phone', '11988887777'));
    const decrypted = participantIdentityService.decryptIdentity(identity);
    expect(decrypted.email).toBe('contato@example.com');
    expect(decrypted.phone).toBe('11988887777');
    expect(summary.contactsMoved).toBe(1);
  });

  it('treats the Patient copy as authoritative over a stale identity contact written before ba9e9f19', async () => {
    const stale = participantIdentityService.encryptIdentityFields({ email: 'antigo@example.com' });
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '62626262', email: 'novo@example.com', phone: null }],
      participantIdentities: [{ _id: 'i1', participantId: '62626262', ...stale }]
    });

    await moveParticipantContactToIdentity(db);

    const decrypted = participantIdentityService.decryptIdentity(db.collections.participantIdentities.docs[0]);
    expect(decrypted.email).toBe('novo@example.com');
  });

  it('keeps the Patient copy when there is no identity record to move it to', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '63636363', email: 'orfao@example.com' }]
    });

    const { summary } = await moveParticipantContactToIdentity(db);

    expect(db.collections.patients.docs[0].email).toBe('orfao@example.com');
    expect(summary.skippedNoIdentity).toEqual(['63636363']);
  });

  it('keeps the Patient copy and reports the participant when the phone is refused as a duplicate', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '64646464', phone: '11977776666' }],
      participantIdentities: [{ _id: 'i1', participantId: '64646464', patientName: 'Paciente' }]
    });
    db.collections.participantIdentities.refuseUpdate = (doc, update) => Boolean(update.$set?.phoneHash);

    const { summary } = await moveParticipantContactToIdentity(db);

    expect(db.collections.patients.docs[0].phone).toBe('11977776666');
    expect(summary.phoneConflicts).toEqual(['64646464']);
  });

  it('hashes and encrypts an identity phone written before slice 1 even when no Patient copy remains', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '65656565' }],
      participantIdentities: [{ _id: 'i1', participantId: '65656565', patientName: 'Paciente', phone: '11966665555' }]
    });

    const { summary } = await moveParticipantContactToIdentity(db);

    const identity = db.collections.participantIdentities.docs[0];
    expect(identity.phoneHash).toBe(participantIdentityService.computeBlindIndex('phone', '11966665555'));
    expect(identity.phoneCiphertext).toBeTruthy();
    expect(summary.identitiesRehashed).toBe(1);
  });

  it('leaves a Patient with no contact and an already-hashed identity untouched (control)', async () => {
    const hashed = participantIdentityService.encryptIdentityFields({ phone: '11955554444' });
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '66666666' }],
      participantIdentities: [{ _id: 'i1', participantId: '66666666', ...hashed, phone: null }]
    });
    const before = JSON.stringify(db.collections.participantIdentities.docs[0]);

    const { summary } = await moveParticipantContactToIdentity(db);

    expect(JSON.stringify(db.collections.participantIdentities.docs[0])).toBe(before);
    expect(summary.contactsMoved).toBe(0);
    expect(summary.identitiesRehashed).toBe(0);
  });
});

describe('participant-identity-backfill.service#moveParticipantContactToIdentity representative fields (#1168)', () => {
  const participantIdentityService = require('../../../src/services/participantIdentity.service');
  const { encryptValue } = require('../../../src/utils/fieldEncryption');

  it('moves the representative, including a Patient-side ciphertext document, and removes it from the Patient', async () => {
    const db = createFakeDb({
      patients: [{
        _id: 'p1', participantId: '71717171', isDeceased: true,
        representativeName: 'Rep Legal', representativeEmail: 'rep@example.com', representativePhone: '11955554444',
        representativeIdentityDocument: null, representativeIdentityDocumentEncrypted: encryptValue('98765432100')
      }],
      participantIdentities: [{ _id: 'i1', participantId: '71717171', patientName: 'Paciente' }]
    });

    await moveParticipantContactToIdentity(db);

    const patient = db.collections.patients.docs[0];
    for (const field of ['representativeName', 'representativeEmail', 'representativePhone', 'representativeIdentityDocument', 'representativeIdentityDocumentEncrypted']) {
      expect(patient).not.toHaveProperty(field);
    }
    expect(patient.isDeceased).toBe(true);
    const identity = db.collections.participantIdentities.docs[0];
    expect(identity.representativeName).toBeNull();
    const decrypted = participantIdentityService.decryptIdentity(identity);
    expect(decrypted.representativeName).toBe('Rep Legal');
    expect(decrypted.representativeIdentityDocument).toBe('98765432100');
  });

  it('flags a Patient whose representative differs from the identity record', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '72727272', representativeName: 'Rep Novo' }],
      participantIdentities: [{ _id: 'i1', participantId: '72727272', patientName: 'Paciente', representativeName: 'Rep Antigo' }]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity.drifted).toEqual(['72727272']);
  });
});

describe('participant-identity-backfill.service#checkParticipantIdentityParity contact fields (#1166 slice 4)', () => {
  it('flags a Patient whose email differs from the identity record', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '67676767', email: 'novo@example.com' }],
      participantIdentities: [{ _id: 'i1', participantId: '67676767', patientName: 'Paciente', email: 'antigo@example.com' }]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity.drifted).toEqual(['67676767']);
  });

  it('reports parity when the contact matches up to case and phone punctuation (control)', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', participantId: '68686868', email: 'Mesmo@Example.com', phone: '(11) 94444-3333' }],
      participantIdentities: [{ _id: 'i1', participantId: '68686868', patientName: 'Paciente', email: 'mesmo@example.com', phone: '11944443333' }]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity).toEqual({ isFullParity: true, totalPatients: 1, missing: [], drifted: [] });
  });
});
