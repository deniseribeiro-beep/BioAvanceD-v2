import { describe, it, expect, afterEach, vi } from 'vitest';

const participantIdentityService = require('../../src/services/PatientIdentityService');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      // $setOnInsert applies on an upsert's insert only, as in MongoDB.
      if (options.upsert) {
        docs.push({ ...query, ...(update.$set || {}), ...(update.$setOnInsert || {}) });
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

  // #1353: a create path's organization lands on the participant it creates,
  // and never moves a participant it matches.
  it('stamps a supplied clinicalUnitId on a created participant only (#1353)', async () => {
    const patients = makeCollection([
      { _id: 'p1', participantId: '11111111', clinicalUnitId: 'org-old' },
    ]);
    const db = makeDb({ patients, participantIdentities: makeCollection([]) });

    await participantIdentityService.matchOrUpsertParticipant(db, {
      patientName: 'Carla Souza', birthDate: '05/03/1988', clinicalUnitId: 'org-a',
    });
    expect(patients.insertOne.mock.calls[0][0].clinicalUnitId).toBe('org-a');

    await participantIdentityService.matchOrUpsertParticipant(db, { participantId: '11111111', clinicalUnitId: 'org-a' });
    expect(patients.updateOne.mock.calls.at(-1)[1].$set).not.toHaveProperty('clinicalUnitId');
  });

  // #1356: a scoped caller never writes another organization's participant.
  it('links an out-of-scope match without writing its records, and still updates an in-scope one (#1356)', async () => {
    const patients = makeCollection([
      { _id: 'p1', participantId: '11111111', clinicalUnitId: 'org-other' },
      { _id: 'p2', participantId: '22222222', clinicalUnitId: 'org-a' },
    ]);
    const participantIdentities = makeCollection([]);
    const db = makeDb({ patients, participantIdentities });
    const scope = { organizationScope: { scope: 'organization', organizationIds: ['org-a'] } };

    const foreign = await participantIdentityService.matchOrUpsertParticipant(db, { participantId: '11111111', sex: 'F', patientName: 'Overwrite' }, scope);
    expect(foreign).toMatchObject({ created: false, outOfScope: true, patient: { participantId: '11111111' } });
    expect(patients.updateOne).not.toHaveBeenCalled();
    expect(participantIdentities.updateOne).not.toHaveBeenCalled();

    const own = await participantIdentityService.matchOrUpsertParticipant(db, { participantId: '22222222', sex: 'F' }, scope);
    expect(own.outOfScope).toBeUndefined();
    expect(patients.updateOne).toHaveBeenCalledTimes(1);
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
    // #1104: ciphertext-only -- no plaintext at rest, recovered by decryption.
    const identityCrypto = require('../../src/services/participantIdentity.service');
    expect(identity.patientName).toBeNull();
    expect(identity.identityDocument).toBeNull();
    expect(identityCrypto.decryptIdentity(identity)).toMatchObject({
      patientName: 'Carla Souza',
      identityDocument: '11144477735',
    });
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

  // #1386: an identity record this path inserts gets its own id and a status
  // (P1X-0348, P1X-0361); one it matches keeps the id it has.
  it("#1386: a new participant's identity record carries a uuid participantIdentityId and identityStatus active", async () => {
    const participantIdentities = makeCollection([]);
    const db = makeDb({ patients: makeCollection([]), participantIdentities });

    const result = await participantIdentityService.matchOrUpsertParticipant(db, {
      patientName: 'Carla Souza',
      birthDate: '05/03/1988',
    });

    const identity = participantIdentities._docs.find((doc) => doc.participantId === result.patient.participantId);
    expect(identity.participantIdentityId).toMatch(UUID_V4);
    expect(identity.identityStatus).toBe('active');
  });

  it("#1386: the match branch leaves an existing identity record's participantIdentityId unchanged", async () => {
    const participantIdentities = makeCollection([
      { participantId: '11111111', participantIdentityId: 'kept-id', identityStatus: 'merged', patientName: 'Ana Silva' },
    ]);
    const db = makeDb({ patients: makeCollection([{ _id: 'p1', participantId: '11111111' }]), participantIdentities });

    const result = await participantIdentityService.matchOrUpsertParticipant(db, { participantId: '11111111', sex: 'F' });

    expect(result.created).toBe(false);
    expect(participantIdentities.updateOne).toHaveBeenCalledTimes(1);
    expect(participantIdentities._docs).toHaveLength(1);
    expect(participantIdentities._docs[0]).toMatchObject({ participantIdentityId: 'kept-id', identityStatus: 'merged' });
  });
});
