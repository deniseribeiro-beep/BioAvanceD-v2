import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const require2 = createRequire(import.meta.url);
const fs = require2('fs');
const patientService = require2('../../src/services/patient.service');
const importService = require2('../../src/services/import.service');
const batchValidationEngine = require2('../../src/services/batch-validation-engine.service');
const sampleService = require2('../../src/services/sample.service');
const participantIdentityService = require2('../../src/services/participantIdentity.service');
const ParticipantIdentityModel = require2('../../src/models/ParticipantIdentity');
const { encryptValue, decryptValue } = require2('../../src/utils/fieldEncryption');

// #1386, dict-02 P1X-0355: the hospital record number lives on
// ParticipantIdentity as recordNumberCiphertext (with recordNumberHash), and
// no longer on the pseudonymous Patient document. Writers $unset the Patient
// copy; readers match the identity first and fall back to the legacy
// patients.recordNumber only where the identity holds no number
// (docs/decisions/2026-10-17-participant-identity-names-and-fields.md, item 6).

function matches(doc, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some((clause) => matches(doc, clause));
    const value = doc[key];
    // MongoDB: null matches a null field and a missing one.
    if (expected === null) return value === null || value === undefined;
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return expected.$in.includes(value);
    }
    if (expected && typeof expected === 'object' && '$regex' in expected) {
      return value !== undefined && value !== null
        && new RegExp(expected.$regex, expected.$options || '').test(String(value));
    }
    return value === expected;
  });
}

function makeCollection(initialDocs = []) {
  const docs = initialDocs.map((doc) => ({ ...doc }));
  const updates = [];
  const queries = [];
  const cursorOf = (matched) => {
    const cursor = {
      limit: () => cursor,
      skip: () => cursor,
      project: () => cursor,
      toArray: async () => matched,
    };
    return cursor;
  };
  return {
    docs,
    updates,
    queries,
    findOne: async (query = {}) => {
      queries.push(query);
      return docs.find((doc) => matches(doc, query)) || null;
    },
    find: (query = {}) => {
      queries.push(query);
      return cursorOf(docs.filter((doc) => matches(doc, query)));
    },
    countDocuments: async (query = {}) => docs.filter((doc) => matches(doc, query)).length,
    insertOne: async (doc) => {
      const insertedId = doc._id || `id-${docs.length + 1}`;
      docs.push({ ...doc, _id: insertedId });
      return { insertedId };
    },
    updateOne: async (query, update, options = {}) => {
      updates.push({ query, update });
      let doc = docs.find((candidate) => matches(candidate, query));
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 };
        doc = { ...query, ...(update.$setOnInsert || {}) };
        docs.push(doc);
      }
      Object.assign(doc, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete doc[key];
      return { matchedCount: 1, modifiedCount: 1 };
    },
    deleteOne: async () => ({ deletedCount: 1 }),
    createIndex: async () => undefined,
  };
}

function makeDb(collections = {}) {
  const store = {
    consent_templates: { findOne: async () => ({ _id: 'template' }) },
    ...collections,
  };
  return {
    collection: (name) => {
      if (!store[name]) store[name] = makeCollection();
      return store[name];
    },
  };
}

// The identity record a writer stores for this number, as encryptIdentityFields builds it.
function identityWithNumber(participantId, recordNumber) {
  return participantIdentityService.encryptIdentityFields(
    ParticipantIdentityModel.create({ participantId, recordNumber })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ParticipantIdentity.recordNumberCiphertext (#1386, P1X-0355)', () => {
  it('createPatient stores recordNumberCiphertext and recordNumberHash on the identity and no recordNumber on the Patient', async () => {
    const patients = makeCollection();
    const participantIdentities = makeCollection();
    const db = makeDb({ patients, participantIdentities });

    await patientService.createPatient(db, {
      participantId: '12345678',
      patientName: 'Maria Silva',
      birthDate: '1990-01-01',
      sex: 'F',
      consentTemplateId: '507f1f77bcf86cd799439011',
      recordNumber: ' PRONT-77 ',
    }, { skipConsentNotification: true });

    expect(patients.docs).toHaveLength(1);
    expect(patients.docs[0]).not.toHaveProperty('recordNumber');
    const identity = participantIdentities.docs[0];
    expect(identity.recordNumber).toBeNull();
    expect(decryptValue(identity.recordNumberCiphertext)).toBe('PRONT-77');
    expect(identity.recordNumberHash).toBe(participantIdentityService.computeBlindIndex('recordNumber', 'PRONT-77'));
    expect(participantIdentityService.decryptIdentity(identity).recordNumber).toBe('PRONT-77');
  });

  it('an imported numeric record number is stored as its string, and the new Patient holds none', async () => {
    const patients = makeCollection();
    const participantIdentities = makeCollection();
    const filePath = 'records-1386.json';
    const readFileSync = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => (
      file === filePath
        ? JSON.stringify({ patientName: 'Ana Souza', birthDate: '1985-05-20', sex: 'F', consentTemplateId: 'tcle-1', recordNumber: 4512 })
        : readFileSync(file, ...rest)
    ));
    vi.spyOn(require2('../../src/services/notification.service'), 'enqueueConsentNotification').mockResolvedValue(undefined);

    const result = await importService.importPatients(makeDb({ patients, participantIdentities }), { path: filePath, originalname: filePath });

    expect(result.success).toBe(1);
    expect(patients.docs[0]).not.toHaveProperty('recordNumber');
    const identity = participantIdentities.docs[0];
    expect(decryptValue(identity.recordNumberCiphertext)).toBe('4512');
    expect(identity.recordNumberHash).toBe(participantIdentityService.computeBlindIndex('recordNumber', '4512'));
  });

  it('ParticipantIdentityModel.create with no number holds no recordNumber or recordNumberCiphertext key, so by-barcode reads the legacy Patient number', async () => {
    const created = ParticipantIdentityModel.create({ participantId: '12345678' });
    expect(created).not.toHaveProperty('recordNumber');
    expect(created).not.toHaveProperty('recordNumberCiphertext');

    const db = makeDb({
      samples: makeCollection([{ _id: 's1', barcode: 'BR-1', participantId: '12345678' }]),
      patients: makeCollection([{ participantId: '12345678', recordNumber: 'LEGACY-1' }]),
      participantIdentities: makeCollection([participantIdentityService.encryptIdentityFields(created)]),
    });

    const { participant } = await sampleService.getSampleByBarcode(db, 'BR-1');
    expect(participant.recordNumber).toBe('LEGACY-1');
  });

  it('updatePatient with recordNumber sets the identity ciphertext and $unsets patients.recordNumber', async () => {
    const patients = makeCollection([{ participantId: '12345678', recordNumber: 'OLD-1' }]);
    const participantIdentities = makeCollection([{ participantId: '12345678' }]);

    await patientService.updatePatient(makeDb({ patients, participantIdentities }), '12345678', { recordNumber: 'NEW-2' });

    expect(patients.updates[0].update.$unset).toEqual({ recordNumber: '' });
    expect(patients.updates[0].update.$set).not.toHaveProperty('recordNumber');
    expect(patients.docs[0]).not.toHaveProperty('recordNumber');
    const identity = participantIdentities.docs[0];
    expect(decryptValue(identity.recordNumberCiphertext)).toBe('NEW-2');
    expect(identity.recordNumberHash).toBe(participantIdentityService.computeBlindIndex('recordNumber', 'NEW-2'));
  });

  it('updatePatient with recordNumber: null clears the ciphertext and the hash', async () => {
    const patients = makeCollection([{ participantId: '12345678' }]);
    const participantIdentities = makeCollection([identityWithNumber('12345678', 'PRONT-9')]);

    await patientService.updatePatient(makeDb({ patients, participantIdentities }), '12345678', { recordNumber: null });

    const identity = participantIdentities.docs[0];
    expect(identity.recordNumberCiphertext).toBeNull();
    expect(identity.recordNumberHash).toBeNull();
  });

  it('updatePatient with a whitespace-only recordNumber clears the ciphertext and the hash', async () => {
    const patients = makeCollection([{ participantId: '12345678' }]);
    const participantIdentities = makeCollection([identityWithNumber('12345678', 'PRONT-9')]);

    await patientService.updatePatient(makeDb({ patients, participantIdentities }), '12345678', { recordNumber: '  ' });

    const identity = participantIdentities.docs[0];
    expect(identity.recordNumberCiphertext).toBeNull();
    expect(identity.recordNumberHash).toBeNull();
  });

  it('checkIdentifierConflict finds a number held on an identity through its hash', async () => {
    const identity = identityWithNumber('11111111', 'PRONT-5');
    const db = makeDb({ patients: makeCollection([{ participantId: '11111111' }]), participantIdentities: makeCollection([identity]) });

    const conflict = await patientService.checkIdentifierConflict(db, { recordNumber: ' PRONT-5 ' });

    expect(conflict).toMatchObject({ field: 'recordNumber', value: 'PRONT-5', existing: { participantId: '11111111' } });
  });

  it('checkIdentifierConflict still finds a number held only on a legacy Patient', async () => {
    const db = makeDb({
      patients: makeCollection([{ participantId: '22222222', recordNumber: 'LEGACY-5' }]),
      participantIdentities: makeCollection([{ participantId: '22222222' }]),
    });

    const conflict = await patientService.checkIdentifierConflict(db, { recordNumber: 'LEGACY-5' });

    expect(conflict).toMatchObject({ field: 'recordNumber', value: 'LEGACY-5', existing: { participantId: '22222222' } });
  });

  it('searchPatients finds a participant by an identity-stored number and by a legacy one', async () => {
    const db = makeDb({
      patients: makeCollection([
        { participantId: '11111111' },
        { participantId: '22222222', recordNumber: 'LEGACY-7' },
      ]),
      participantIdentities: makeCollection([identityWithNumber('11111111', 'PRONT-7'), { participantId: '22222222' }]),
    });

    const byIdentity = await patientService.searchPatients(db, 'PRONT-7');
    expect(byIdentity.patients.map((patient) => patient.participantId)).toEqual(['11111111']);

    const byLegacy = await patientService.searchPatients(db, 'LEGACY-7');
    expect(byLegacy.patients.map((patient) => patient.participantId)).toEqual(['22222222']);
  });

  it('the import merge moves an existing Patient\'s recordNumber to the identity and unsets it', async () => {
    const patients = makeCollection([{ _id: 'existing-1', participantId: '33333333', recordNumber: 'LEGACY-3', sex: 'F' }]);
    const participantIdentities = makeCollection([{ participantId: '33333333' }]);
    const filePath = 'merge-1386-record.json';
    const readFileSync = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => (
      file === filePath
        ? JSON.stringify({ patientName: 'Ana Souza', birthDate: '1985-05-20', sex: 'F', consentTemplateId: 'tcle-1', recordNumber: 'LEGACY-3' })
        : readFileSync(file, ...rest)
    ));

    const result = await importService.importPatients(makeDb({ patients, participantIdentities }), { path: filePath, originalname: filePath });

    expect(result.success).toBe(1);
    expect(patients.updates[0].update.$unset).toEqual({ recordNumber: '' });
    expect(patients.docs[0]).not.toHaveProperty('recordNumber');
    const identity = participantIdentities.docs[0];
    expect(decryptValue(identity.recordNumberCiphertext)).toBe('LEGACY-3');
    expect(identity.recordNumberHash).toBe(participantIdentityService.computeBlindIndex('recordNumber', 'LEGACY-3'));
  });

  it('the import finds the existing participant by an identity-stored number', async () => {
    const patients = makeCollection([{ _id: 'existing-1', participantId: '44444444', sex: 'F' }]);
    const participantIdentities = makeCollection([identityWithNumber('44444444', 'PRONT-4')]);
    const filePath = 'merge-1386-identity.json';
    const readFileSync = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => (
      file === filePath
        ? JSON.stringify({ patientName: 'Ana Souza', birthDate: '1985-05-20', sex: 'F', consentTemplateId: 'tcle-1', recordNumber: 'PRONT-4' })
        : readFileSync(file, ...rest)
    ));

    const result = await importService.importPatients(makeDb({ patients, participantIdentities }), { path: filePath, originalname: filePath });

    expect(result.success).toBe(1);
    expect(patients.docs).toHaveLength(1);
    expect(participantIdentities.docs).toHaveLength(1);
  });

  it('findLinkedPatient links a row by an identity-stored number', async () => {
    const db = makeDb({
      patients: makeCollection([{ participantId: '55555555' }]),
      participantIdentities: makeCollection([identityWithNumber('55555555', 'PRONT-55')]),
    });

    const linked = await batchValidationEngine.findLinkedPatient(db, { recordNumber: 'PRONT-55' });

    expect(linked).toMatchObject({ participantId: '55555555' });
  });

  it('by-barcode returns the identity\'s number, never the legacy one beside it', async () => {
    const db = makeDb({
      samples: makeCollection([{ _id: 's1', barcode: 'BR-1', participantId: '12345678' }]),
      patients: makeCollection([{ participantId: '12345678', recordNumber: 'LEGACY-1' }]),
      participantIdentities: makeCollection([identityWithNumber('12345678', 'PRONT-1')]),
    });

    const { participant } = await sampleService.getSampleByBarcode(db, 'BR-1');
    expect(participant.recordNumber).toBe('PRONT-1');
  });

  it('by-barcode returns the legacy number where the identity has no recordNumberCiphertext', async () => {
    const db = makeDb({
      samples: makeCollection([{ _id: 's1', barcode: 'BR-1', participantId: '12345678' }]),
      patients: makeCollection([{ participantId: '12345678', recordNumber: 'LEGACY-1' }]),
      participantIdentities: makeCollection([{ participantId: '12345678', patientNameCiphertext: encryptValue('Maria Silva') }]),
    });

    const { participant } = await sampleService.getSampleByBarcode(db, 'BR-1');
    expect(participant.recordNumber).toBe('LEGACY-1');
  });

  it('by-barcode returns null, not the legacy number, where the identity holds a cleared number', async () => {
    const db = makeDb({
      samples: makeCollection([{ _id: 's1', barcode: 'BR-1', participantId: '12345678' }]),
      patients: makeCollection([{ participantId: '12345678', recordNumber: 'LEGACY-1' }]),
      participantIdentities: makeCollection([{ participantId: '12345678', recordNumber: null, recordNumberCiphertext: null }]),
    });

    const { participant } = await sampleService.getSampleByBarcode(db, 'BR-1');
    expect(participant.recordNumber).toBeNull();
  });

  // #1386: a blank number normalizes to null, and `{ recordNumber: null }`
  // matches every identity, whose plaintext encryptIdentityFields nulls. So
  // no reader may query the identities with one.
  describe('a whitespace-only record number runs no identity query', () => {
    const twoIdentities = () => makeCollection([{ participantId: '11111111' }, { participantId: '22222222' }]);
    const twoPatients = () => makeCollection([
      { _id: 'p1', participantId: '11111111', sex: 'F' },
      { _id: 'p2', participantId: '22222222', sex: 'M' },
    ]);

    it('recordNumberIdentityQuery gives no filter for a blank number', () => {
      for (const blank of ['   ', '', null, undefined]) {
        expect(participantIdentityService.recordNumberIdentityQuery(blank)).toBeNull();
      }
    });

    it('prepareParticipantId imports a whitespace-only row as a new participant, as before the move, and touches no existing one', async () => {
      const patients = twoPatients();
      const participantIdentities = twoIdentities();
      const filePath = 'blank-record-1386.json';
      const readFileSync = fs.readFileSync;
      vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => (
        file === filePath
          ? JSON.stringify({ patientName: 'Joana Nova', birthDate: '1990-01-01', sex: 'F', consentTemplateId: 't', recordNumber: '   ' })
          : readFileSync(file, ...rest)
      ));
      vi.spyOn(require2('../../src/services/notification.service'), 'enqueueConsentNotification').mockResolvedValue(undefined);

      const result = await importService.importPatients(makeDb({ patients, participantIdentities }), { path: filePath, originalname: filePath });

      expect(result.success).toBe(1);
      expect(participantIdentities.queries).toEqual([]);
      expect(patients.updates.filter(({ query }) => query._id === 'p1' || query._id === 'p2')).toEqual([]);
      expect(participantIdentities.updates).toEqual([]);
      expect(patients.docs).toHaveLength(3);
      expect(participantIdentities.docs).toHaveLength(3);
      expect(participantIdentities.docs[2]).not.toHaveProperty('recordNumberCiphertext');
    });

    it('checkIdentifierConflict finds no conflict and queries no identity', async () => {
      const participantIdentities = twoIdentities();
      const db = makeDb({ patients: twoPatients(), participantIdentities });

      expect(await patientService.checkIdentifierConflict(db, { recordNumber: '   ' })).toBeNull();
      expect(participantIdentities.queries).toEqual([]);
    });

    it('searchPatients finds nothing and queries no identity', async () => {
      const participantIdentities = twoIdentities();
      const db = makeDb({ patients: twoPatients(), participantIdentities });

      expect((await patientService.searchPatients(db, '   ')).patients).toEqual([]);
      expect(participantIdentities.queries).toEqual([]);
    });

    it('findLinkedPatient links nothing and queries no identity', async () => {
      const participantIdentities = twoIdentities();
      const db = makeDb({ patients: twoPatients(), participantIdentities });

      expect(await batchValidationEngine.findLinkedPatient(db, { recordNumber: '   ' })).toBeNull();
      expect(await batchValidationEngine.findPatientByIdentityRecordNumber(db, db.collection('patients'), '   ')).toBeNull();
      expect(participantIdentities.queries).toEqual([]);
    });
  });
});
