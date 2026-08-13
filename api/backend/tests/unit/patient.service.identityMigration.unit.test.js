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
    const participantIdentities = makeInMemoryCollection([
      { participantId: '11111111', patientName: 'Ana Silva', birthDate: new Date(1990, 0, 20) },
    ]);
    const db = makeDb({ patients, participantIdentities });

    const duplicate = await patientService.checkDuplicatePatient(db, { patientName: 'ana   silva', birthDate: new Date(1990, 0, 20) });

    expect(duplicate).toBeTruthy();
    expect(duplicate.participantId).toBe('11111111');
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
    const participantIdentities = makeInMemoryCollection([
      { participantId: '11111111', birthDate: new Date(1990, 0, 20) },
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
});
