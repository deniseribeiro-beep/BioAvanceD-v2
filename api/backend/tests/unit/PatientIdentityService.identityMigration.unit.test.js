import { describe, it, expect, afterEach, vi } from 'vitest';

const participantIdentityService = require('../../src/services/PatientIdentityService');

// RF005/RNF007 (#561): the import-time name+birthDate match must resolve
// against ParticipantIdentity, not Patient's own (soon to be removed)
// patientNameNormalized/birthDateKey fields — and must dual-write the
// segregated collection too, or matches would never find records created
// through this path once #561 stops trusting Patient's own fields.

function makeCollection(initialDocs = []) {
  const docs = [...initialDocs];
  return {
    _docs: docs,
    findOne: vi.fn().mockImplementation((query = {}) =>
      Promise.resolve(
        docs.find((doc) =>
          Object.entries(query).every(([k, v]) => doc[k] === v)
        ) || null
      )
    ),
    find: vi.fn().mockImplementation((query = {}) => ({
      toArray: vi.fn().mockResolvedValue(
        docs.filter((doc) => {
          if (query.birthDate && (query.birthDate.$gte || query.birthDate.$lt)) {
            const value = doc.birthDate instanceof Date ? doc.birthDate.getTime() : new Date(doc.birthDate).getTime();
            if (query.birthDate.$gte && value < query.birthDate.$gte.getTime()) return false;
            if (query.birthDate.$lt && value >= query.birthDate.$lt.getTime()) return false;
            return true;
          }
          return true;
        })
      ),
    })),
    insertOne: vi.fn().mockImplementation((doc) => {
      docs.push(doc);
      return Promise.resolve({ insertedId: 'generated-id' });
    }),
    updateOne: vi.fn().mockImplementation((query, update, options = {}) => {
      const existing = docs.find((doc) => Object.entries(query).every(([k, v]) => doc[k] === v));
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

describe('PatientIdentityService (import-time matching) resolves via ParticipantIdentity (#561)', () => {
  it('matches an existing participant by name+birthDate found in ParticipantIdentity, not Patient', async () => {
    const patients = makeCollection([
      { _id: 'p1', participantId: '11111111', patientName: 'STALE ON PATIENT', birthDate: new Date(1990, 0, 20) },
    ]);
    const participantIdentities = makeCollection([
      { participantId: '11111111', patientName: 'Ana Silva', birthDate: new Date(1990, 0, 20) },
    ]);
    const db = makeDb({ patients, participantIdentities });

    const result = await participantIdentityService.matchOrUpsertParticipant(db, {
      patientName: 'Ana Silva',
      birthDate: '20/01/1990',
    });

    expect(result.created).toBe(false);
    expect(result.patient.participantId).toBe('11111111');
    expect(patients.insertOne).not.toHaveBeenCalled();
  });

  it('creates a new participant and dual-writes ParticipantIdentity when no match exists', async () => {
    const patients = makeCollection([]);
    const participantIdentities = makeCollection([]);
    const db = makeDb({ patients, participantIdentities });

    const result = await participantIdentityService.matchOrUpsertParticipant(db, {
      patientName: 'Carla Souza',
      birthDate: '05/03/1988',
      identityDocument: '11144477735',
    });

    expect(result.created).toBe(true);
    expect(patients.insertOne).toHaveBeenCalled();

    const identity = participantIdentities._docs.find((doc) => doc.participantId === result.patient.participantId);
    expect(identity).toBeTruthy();
    expect(identity.patientName).toBe('Carla Souza');
    expect(identity.identityDocument).toBe('11144477735');
  });

  // #1166 slice 4: the contact is identity data, written through
  // encryptIdentityFields (ciphertext + phoneHash) and never onto patients.
  it('#1166: writes a supplied contact to the identity record only, encrypted', async () => {
    const patients = makeCollection([]);
    const participantIdentities = makeCollection([]);
    const db = makeDb({ patients, participantIdentities });

    const result = await participantIdentityService.matchOrUpsertParticipant(db, {
      patientName: 'Carla Souza',
      birthDate: '05/03/1988',
      email: 'carla@example.com',
      phone: '11955554444',
    });

    expect(patients.insertOne.mock.calls[0][0]).not.toHaveProperty('email');
    expect(patients.insertOne.mock.calls[0][0]).not.toHaveProperty('phone');
    const identity = participantIdentities._docs.find((doc) => doc.participantId === result.patient.participantId);
    expect(identity.emailEncrypted).toBeTruthy();
    expect(identity.phoneHash).toBeTruthy();
  });
});
