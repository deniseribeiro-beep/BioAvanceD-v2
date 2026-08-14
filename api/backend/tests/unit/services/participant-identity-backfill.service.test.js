import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const require = createRequire(import.meta.url);
const {
  backfillParticipantIdentities,
  checkParticipantIdentityParity
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
    expect(created.patientName).toBe('Paciente Legado');
    // Backfilled records go through the same #566 encryption as new ones.
    expect(created.identityDocumentEncrypted).toMatchObject({ alg: 'aes-256-gcm' });
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

  it('ignores a Patient document with no participantId', async () => {
    const db = createFakeDb({
      patients: [{ _id: 'p1', patientName: 'Sem Id', birthDate: new Date('1990-01-01'), identityDocument: '00000000000' }]
    });

    const parity = await checkParticipantIdentityParity(db);

    expect(parity).toEqual({ isFullParity: true, totalPatients: 1, missing: [], drifted: [] });
  });
});
