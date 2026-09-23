import { describe, it, expect, afterEach, vi } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const patientService = require('../../src/services/patient.service');

// RF005/RNF007 (#561): patient.service.js's search/duplicate-check/update
// paths must resolve civil identity (patientName/birthDate/identityDocument)
// via ParticipantIdentity, not the Patient document — same "same key
// createPatient's dual-write uses" contract #560 relied on.

function matchesQuery(doc, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') {
      return expected.some((clause) => matchesQuery(doc, clause));
    }
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return expected.$in.includes(doc[key]);
    }
    if (expected && typeof expected === 'object' && '$regex' in expected) {
      const flags = expected.$options || '';
      return new RegExp(expected.$regex, flags).test(String(doc[key] ?? ''));
    }
    if (expected && typeof expected === 'object' && ('$gte' in expected || '$lt' in expected)) {
      const value = doc[key] instanceof Date ? doc[key].getTime() : new Date(doc[key]).getTime();
      if ('$gte' in expected && value < expected.$gte.getTime()) return false;
      if ('$lt' in expected && value >= expected.$lt.getTime()) return false;
      return true;
    }
    return doc[key] === expected;
  });
}

function makeInMemoryCollection(initialDocs = []) {
  const docs = [...initialDocs];
  return {
    _docs: docs,
    findOne: vi.fn().mockImplementation((query = {}) =>
      Promise.resolve(docs.find((doc) => matchesQuery(doc, query)) || null)
    ),
    find: vi.fn().mockImplementation((query = {}) => {
      const matched = docs.filter((doc) => matchesQuery(doc, query));
      return {
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(matched),
      };
    }),
    countDocuments: vi.fn().mockImplementation((query = {}) =>
      Promise.resolve(docs.filter((doc) => matchesQuery(doc, query)).length)
    ),
    insertOne: vi.fn().mockImplementation((doc) => {
      docs.push(doc);
      return Promise.resolve({ insertedId: 'generated-id' });
    }),
    updateOne: vi.fn().mockImplementation((query, update, options = {}) => {
      const existing = docs.find((doc) => matchesQuery(doc, query));
      if (existing) {
        Object.assign(existing, update.$set || {});
        return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
      }
      if (options.upsert) {
        docs.push({ ...query, ...(update.$set || {}) });
        return Promise.resolve({ matchedCount: 0, modifiedCount: 0, upsertedCount: 1 });
      }
      return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
    }),
    createIndex: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDb({ patients, participantIdentities }) {
  return {
    collection: vi.fn((name) => {
      if (name === 'patients') return patients;
      if (name === 'participantIdentities') return participantIdentities;
      throw new Error(`unexpected collection requested: ${name}`);
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('patient.service.js identity resolution migrated to ParticipantIdentity (#561)', () => {
  it('checkIdentifierConflict finds a conflicting identityDocument via ParticipantIdentity even when the Patient document has none', async () => {
    const patients = makeInMemoryCollection([
      { participantId: '11111111', recordNumber: 'PRONT-1' },
    ]);
    const participantIdentities = makeInMemoryCollection([
      { participantId: '11111111', identityDocument: '11144477735' },
    ]);
    const db = makeDb({ patients, participantIdentities });

    const conflict = await patientService.checkIdentifierConflict(db, { identityDocument: '11144477735' });

    expect(conflict).toMatchObject({ field: 'identityDocument', value: '11144477735' });
  });

  // #1104: fifth participantIdentities matching site. It queried the
  // plaintext identityDocument with no blind-index arm, so a ciphertext-only
  // row was invisible and the uniqueness check would have gone dead under the
  // cutover -- letting a second participant be created for the same document.
  it('#1104: checkIdentifierConflict matches a CIPHERTEXT-ONLY identity via identityDocumentHash', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '11111111',
      identityDocument: '11144477735',
    });
    const patients = makeInMemoryCollection([]);
    const participantIdentities = makeInMemoryCollection([
      { ...encrypted, identityDocument: null },
    ]);
    const db = makeDb({ patients, participantIdentities });

    const conflict = await patientService.checkIdentifierConflict(db, { identityDocument: '11144477735' });

    expect(conflict).toMatchObject({ field: 'identityDocument', value: '11144477735' });
  });

  it('#1104: checkIdentifierConflict still returns null for a ciphertext-only identity with a DIFFERENT document', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '11111111',
      identityDocument: '52998224725',
    });
    const patients = makeInMemoryCollection([]);
    const participantIdentities = makeInMemoryCollection([
      { ...encrypted, identityDocument: null },
    ]);
    const db = makeDb({ patients, participantIdentities });

    const conflict = await patientService.checkIdentifierConflict(db, { identityDocument: '11144477735' });

    expect(conflict).toBeNull();
  });

  // #1109: every participantIdentities writer other than createPatient stores
  // identityDocument verbatim (ParticipantIdentityModel.fieldsOf only trims,
  // and updatePatient/import pass the raw value straight through), while
  // checkIdentifierConflict searches for the digits-only form. A CPF typed
  // with punctuation therefore missed BOTH arms -- the plaintext one and the
  // #1104 hash one -- so a second participant was created for the same civil
  // identity.
  it('#1109: checkIdentifierConflict matches a PUNCTUATED stored document (ciphertext-only)', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const ParticipantIdentityModel = require('../../src/models/ParticipantIdentity');
    const encrypted = participantIdentityService.encryptIdentityFields(
      ParticipantIdentityModel.create({ participantId: '11111111', identityDocument: '111.444.777-35' })
    );
    const patients = makeInMemoryCollection([]);
    const participantIdentities = makeInMemoryCollection([
      { ...encrypted, identityDocument: null },
    ]);
    const db = makeDb({ patients, participantIdentities });

    const conflict = await patientService.checkIdentifierConflict(db, { identityDocument: '111.444.777-35' });

    expect(conflict).toMatchObject({ field: 'identityDocument', value: '11144477735' });
  });

  it('#1109: checkIdentifierConflict matches a PUNCTUATED stored document from an UNPUNCTUATED query', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const ParticipantIdentityModel = require('../../src/models/ParticipantIdentity');
    const encrypted = participantIdentityService.encryptIdentityFields(
      ParticipantIdentityModel.create({ participantId: '11111111', identityDocument: '111.444.777-35' })
    );
    const patients = makeInMemoryCollection([]);
    const participantIdentities = makeInMemoryCollection([encrypted]);
    const db = makeDb({ patients, participantIdentities });

    const conflict = await patientService.checkIdentifierConflict(db, { identityDocument: '11144477735' });

    expect(conflict).toMatchObject({ field: 'identityDocument', value: '11144477735' });
  });

  // #1109 control: same punctuated write path, a genuinely different
  // document. Expected behaviour is identical before and after the fix, so a
  // red here means the fixture is wrong rather than the bug reproduced.
  it('#1109 control: a PUNCTUATED stored document with a different number still returns null', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const ParticipantIdentityModel = require('../../src/models/ParticipantIdentity');
    const encrypted = participantIdentityService.encryptIdentityFields(
      ParticipantIdentityModel.create({ participantId: '11111111', identityDocument: '529.982.247-25' })
    );
    const patients = makeInMemoryCollection([]);
    const participantIdentities = makeInMemoryCollection([encrypted]);
    const db = makeDb({ patients, participantIdentities });

    const conflict = await patientService.checkIdentifierConflict(db, { identityDocument: '111.444.777-35' });

    expect(conflict).toBeNull();
  });

  it('checkIdentifierConflict still checks recordNumber against Patient (not a civil-identity field)', async () => {
    const patients = makeInMemoryCollection([
      { participantId: '11111111', recordNumber: 'PRONT-1' },
    ]);
    const participantIdentities = makeInMemoryCollection([]);
    const db = makeDb({ patients, participantIdentities });

    const conflict = await patientService.checkIdentifierConflict(db, { recordNumber: 'PRONT-1' });

    expect(conflict).toMatchObject({ field: 'recordNumber', value: 'PRONT-1' });
  });

  it('checkDuplicatePatient finds a name+birthDate duplicate via ParticipantIdentity even when the Patient document carries a different name', async () => {
    const patients = makeInMemoryCollection([
      { participantId: '11111111', patientName: 'STALE NAME ON PATIENT', birthDate: new Date(1990, 0, 20) },
    ]);
    // #1104: built through the real write path rather than by hand -- since
    // the birthDate cutover a stored identity carries birthDateEncrypted and
    // birthDateHash and NO plaintext birthDate, and the query matches on the
    // hash. A hand-written plaintext-only row is a shape no writer produces.
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const participantIdentities = makeInMemoryCollection([
      participantIdentityService.encryptIdentityFields({
        participantId: '11111111',
        patientName: 'Ana Silva',
        birthDate: new Date(1990, 0, 20),
      }),
    ]);
    const db = makeDb({ patients, participantIdentities });

    const duplicate = await patientService.checkDuplicatePatient(db, { patientName: 'ana   silva', birthDate: new Date(1990, 0, 20) });

    expect(duplicate).toBeTruthy();
    expect(duplicate.participantId).toBe('11111111');
  });

  // #1104: checkDuplicatePatient is the FOURTH participantIdentities matching
  // site and the one #574's repointing missed entirely -- it queried the
  // plaintext birthDate with no blind-index arm, then compared
  // identity.patientName raw. A ciphertext-only row was invisible to it, so
  // the ciphertext-only cutover would have silently disabled duplicate
  // detection on createPatient and both LGPD import paths -- exactly the
  // "dois Participants para uma pessoa" failure import-lgpd.service.js:817
  // warns about. It also fails open (catch -> return null), so nothing would
  // have surfaced.
  it('#1104: checkDuplicatePatient matches a CIPHERTEXT-ONLY identity -- via birthDateHash, decrypting the name before comparing', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const birthDate = new Date(1990, 0, 20);
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '11111111',
      patientName: 'Ana Silva',
      birthDate,
    });
    const patients = makeInMemoryCollection([]);
    const participantIdentities = makeInMemoryCollection([
      { ...encrypted, patientName: null, birthDate: null },
    ]);
    const db = makeDb({ patients, participantIdentities });

    const duplicate = await patientService.checkDuplicatePatient(db, { patientName: 'ana   silva', birthDate });

    expect(duplicate).toBeTruthy();
    expect(duplicate.participantId).toBe('11111111');
  });

  it('#1104: checkDuplicatePatient still returns null for a ciphertext-only identity with a DIFFERENT name', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const birthDate = new Date(1990, 0, 20);
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '11111111',
      patientName: 'Bruno Costa',
      birthDate,
    });
    const patients = makeInMemoryCollection([]);
    const participantIdentities = makeInMemoryCollection([
      { ...encrypted, patientName: null, birthDate: null },
    ]);
    const db = makeDb({ patients, participantIdentities });

    const duplicate = await patientService.checkDuplicatePatient(db, { patientName: 'ana silva', birthDate });

    expect(duplicate).toBeNull();
  });

  it('listPatients({ patientName }) resolves matching participantIds via ParticipantIdentity, not Patient.patientName', async () => {
    const patients = makeInMemoryCollection([
      { participantId: '11111111', patientName: 'STALE' },
      { participantId: '22222222', patientName: 'STALE' },
    ]);
    const participantIdentities = makeInMemoryCollection([
      { participantId: '11111111', patientName: 'Ana Silva' },
      { participantId: '22222222', patientName: 'Bruno Costa' },
    ]);
    const db = makeDb({ patients, participantIdentities });

    const result = await patientService.listPatients(db, { patientName: 'ana' });

    expect(result.patients.map((p) => p.participantId)).toEqual(['11111111']);
  });

  it('searchPatients(term) resolves a birthDate-shaped term via ParticipantIdentity, not Patient.birthDate', async () => {
    const patients = makeInMemoryCollection([
      { participantId: '11111111', birthDate: new Date(1985, 5, 1) },
      { participantId: '22222222', birthDate: new Date(1985, 5, 1) },
    ]);
    // #1104: built through the real write path -- see the checkDuplicatePatient
    // sibling above for why a hand-written plaintext-only row no longer
    // represents anything a writer produces.
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const participantIdentities = makeInMemoryCollection([
      participantIdentityService.encryptIdentityFields({ participantId: '11111111', birthDate: new Date(1990, 0, 20) }),
      participantIdentityService.encryptIdentityFields({ participantId: '22222222', birthDate: new Date(1985, 5, 1) }),
    ]);
    const db = makeDb({ patients, participantIdentities });

    const result = await patientService.searchPatients(db, '20/01/1990');

    expect(result.patients.map((p) => p.participantId)).toEqual(['11111111']);
  });

  // #1104: sixth participantIdentities matching site, same shape as the
  // fifth -- a plaintext birthDate range query with no blind-index arm.
  it('#1104: searchPatients matches a CIPHERTEXT-ONLY identity via birthDateHash', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '11111111',
      birthDate: new Date(1990, 0, 20),
    });
    const patients = makeInMemoryCollection([
      { participantId: '11111111', birthDate: new Date(1985, 5, 1) },
      { participantId: '22222222', birthDate: new Date(1985, 5, 1) },
    ]);
    const participantIdentities = makeInMemoryCollection([
      { ...encrypted, birthDate: null },
      { participantId: '22222222', birthDate: new Date(1985, 5, 1) },
    ]);
    const db = makeDb({ patients, participantIdentities });

    const result = await patientService.searchPatients(db, '20/01/1990');

    expect(result.patients.map((p) => p.participantId)).toEqual(['11111111']);
  });

  it('updatePatient dual-writes patientName/birthDate/identityDocument into ParticipantIdentity', async () => {
    const patients = makeInMemoryCollection([
      { participantId: '11111111', patientName: 'Old Name', birthDate: new Date(1990, 0, 20) },
    ]);
    const participantIdentities = makeInMemoryCollection([
      { participantId: '11111111', patientName: 'Old Name', birthDate: new Date(1990, 0, 20) },
    ]);
    const db = makeDb({ patients, participantIdentities });

    await patientService.updatePatient(db, '11111111', { patientName: 'New Name' });

    const identity = await participantIdentities.findOne({ participantId: '11111111' });
    expect(identity.patientName).toBe('New Name');
  });

  it('updatePatient upserts into ParticipantIdentity when no prior identity record exists', async () => {
    const patients = makeInMemoryCollection([
      { participantId: '22222222', patientName: 'Old Name' },
    ]);
    const participantIdentities = makeInMemoryCollection([]);
    const db = makeDb({ patients, participantIdentities });

    await patientService.updatePatient(db, '22222222', { identityDocument: '11144477735' });

    const identity = await participantIdentities.findOne({ participantId: '22222222' });
    expect(identity).toBeTruthy();
    expect(identity.identityDocument).toBe('11144477735');
  });

  // updatePatient's identity sync is a participantIdentities WRITER, and it
  // was the one writer that never went through encryptIdentityFields: an
  // edit wrote raw plaintext beside the ciphertext and hash it left stale.
  it('updatePatient re-derives birthDate ciphertext and blind index and keeps it ciphertext-only (#1104)', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const oldDate = new Date(1990, 0, 20);
    const newDate = new Date(1985, 5, 1);
    const patients = makeInMemoryCollection([{ participantId: '11111111' }]);
    const participantIdentities = makeInMemoryCollection([
      participantIdentityService.encryptIdentityFields({ participantId: '11111111', patientName: 'Maria', birthDate: oldDate }),
    ]);
    const db = makeDb({ patients, participantIdentities });

    await patientService.updatePatient(db, '11111111', { birthDate: newDate });

    const identity = await participantIdentities.findOne({ participantId: '11111111' });
    expect(identity.birthDate).toBeNull();
    expect(identity.birthDateHash).toBe(participantIdentityService.computeBlindIndex('birthDate', newDate));
    expect(participantIdentityService.decryptIdentity(identity).birthDate.getTime()).toBe(newDate.getTime());
  });

  it('updatePatient stores identityDocument digits-only with a matching hash (#1109)', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const patients = makeInMemoryCollection([{ participantId: '22222222' }]);
    const participantIdentities = makeInMemoryCollection([]);
    const db = makeDb({ patients, participantIdentities });

    await patientService.updatePatient(db, '22222222', { identityDocument: '111.444.777-35' });

    const identity = await participantIdentities.findOne({ participantId: '22222222' });
    expect(identity.identityDocument).toBe('11144477735');
    expect(identity.identityDocumentHash).toBe(participantIdentityService.computeBlindIndex('identityDocument', '11144477735'));
  });

  // #1166: an edited contact used to update patients and leave the identity
  // copy stale -- the sync forwarded only the three civil-identity fields.
  it('updatePatient syncs an edited phone and email into ParticipantIdentity, encrypted (#1166)', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const patients = makeInMemoryCollection([{ participantId: '44444444', phone: '11900000000', email: 'old@example.com' }]);
    const participantIdentities = makeInMemoryCollection([
      participantIdentityService.encryptIdentityFields({ participantId: '44444444', phone: '11900000000', email: 'old@example.com' }),
    ]);
    const db = makeDb({ patients, participantIdentities });

    await patientService.updatePatient(db, '44444444', { phone: '(11) 98765-4321', email: 'New@Example.com' });

    const identity = participantIdentityService.decryptIdentity(
      { ...(await participantIdentities.findOne({ participantId: '44444444' })), phone: null, email: null }
    );
    expect(identity.phone).toBe('11987654321');
    expect(identity.email).toBe('new@example.com');
    expect(identity.phoneHash).toBe(participantIdentityService.computeBlindIndex('phone', '11987654321'));
  });

  // #1168: the deceased-representative merge reads the stored representative
  // from the identity record -- the only place it lives -- and writes the
  // edit back there, never to patients.
  it('#1168: updatePatient merges a representative edit against the identity record', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const patients = makeInMemoryCollection([{ participantId: '46464646', isDeceased: true }]);
    const participantIdentities = makeInMemoryCollection([
      participantIdentityService.encryptIdentityFields({ participantId: '46464646', ...{ representativeName: 'Rep Legal', representativeEmail: 'rep@example.com', representativeIdentityDocument: '98765432100', representativePhone: '11955554444' } }),
    ]);
    const db = makeDb({ patients, participantIdentities });

    await patientService.updatePatient(db, '46464646', { representativePhone: '(11) 93333-2222' });

    const patientSet = patients.updateOne.mock.calls[0][1].$set;
    for (const field of ['representativeName', 'representativeEmail', 'representativeIdentityDocument', 'representativePhone', 'representativeIdentityDocumentEncrypted']) {
      expect(patientSet).not.toHaveProperty(field);
    }
    const identity = participantIdentityService.decryptIdentity(await participantIdentities.findOne({ participantId: '46464646' }));
    expect(identity.representativePhone).toBe('11933332222');
    expect(identity.representativeIdentityDocument).toBe('98765432100');
  });

  // #1168: the patients-side encryption loop used to run BEFORE the merge and
  // null the plaintext it was about to validate, so this edit threw
  // "... obrigatórios" whenever an ENCRYPTION_KEY was configured.
  it('#1168: updatePatient accepts an edited representativeIdentityDocument', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const patients = makeInMemoryCollection([{ participantId: '47474747', isDeceased: true }]);
    const participantIdentities = makeInMemoryCollection([
      participantIdentityService.encryptIdentityFields({ participantId: '47474747', ...{ representativeName: 'Rep Legal', representativeEmail: 'rep@example.com', representativeIdentityDocument: '98765432100', representativePhone: '11955554444' } }),
    ]);
    const db = makeDb({ patients, participantIdentities });

    await expect(
      patientService.updatePatient(db, '47474747', { representativeIdentityDocument: '111.444.777-35' })
    ).resolves.toEqual({ success: true });

    const identity = participantIdentityService.decryptIdentity(await participantIdentities.findOne({ participantId: '47474747' }));
    expect(identity.representativeIdentityDocument).toBe('11144477735');
  });

  it('#1168: marking a participant not deceased clears the representative on the identity record', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const patients = makeInMemoryCollection([{ participantId: '48484848', isDeceased: true }]);
    const participantIdentities = makeInMemoryCollection([
      participantIdentityService.encryptIdentityFields({ participantId: '48484848', ...{ representativeName: 'Rep Legal', representativeEmail: 'rep@example.com', representativeIdentityDocument: '98765432100', representativePhone: '11955554444' } }),
    ]);
    const db = makeDb({ patients, participantIdentities });

    await patientService.updatePatient(db, '48484848', { isDeceased: false });

    const identity = participantIdentityService.decryptIdentity(await participantIdentities.findOne({ participantId: '48484848' }));
    expect(identity.representativeName ?? null).toBeNull();
    expect(identity.representativeIdentityDocument ?? null).toBeNull();
    expect(patients._docs[0].isDeceased).toBe(false);
  });

  it('#1168: a deceased participant with no stored representative is still refused (control)', async () => {
    const patients = makeInMemoryCollection([{ participantId: '49494949', isDeceased: false }]);
    const participantIdentities = makeInMemoryCollection([{ participantId: '49494949' }]);
    const db = makeDb({ patients, participantIdentities });

    await expect(
      patientService.updatePatient(db, '49494949', { isDeceased: true, representativeName: 'Só o nome' })
    ).rejects.toThrow('representante legal são obrigatórios');
  });

  // #1166 slice 4: the edit goes to the identity record only.
  it('#1166: updatePatient does not write an edited contact to patients', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const patients = makeInMemoryCollection([{ participantId: '45454545' }]);
    const participantIdentities = makeInMemoryCollection([
      participantIdentityService.encryptIdentityFields({ participantId: '45454545', email: 'old@example.com' }),
    ]);
    const db = makeDb({ patients, participantIdentities });

    await patientService.updatePatient(db, '45454545', { phone: '(11) 98765-4321', email: 'New@Example.com' });

    const patientSet = patients.updateOne.mock.calls[0][1].$set;
    expect(patientSet).not.toHaveProperty('email');
    expect(patientSet).not.toHaveProperty('phone');
    expect(patients._docs[0]).not.toHaveProperty('email');
  });

  it('updatePatient clearing a civil-identity field clears its ciphertext and hash too', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const patients = makeInMemoryCollection([{ participantId: '33333333' }]);
    const participantIdentities = makeInMemoryCollection([
      participantIdentityService.encryptIdentityFields({ participantId: '33333333', identityDocument: '11144477735' }),
    ]);
    const db = makeDb({ patients, participantIdentities });

    await patientService.updatePatient(db, '33333333', { identityDocument: null });

    const identity = participantIdentityService.decryptIdentity(
      await participantIdentities.findOne({ participantId: '33333333' })
    );
    expect(identity.identityDocument ?? null).toBeNull();
    expect(identity.identityDocumentHash ?? null).toBeNull();
  });
});
