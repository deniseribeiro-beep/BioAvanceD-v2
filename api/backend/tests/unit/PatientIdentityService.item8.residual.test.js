import { afterEach, describe, expect, it, vi } from 'vitest';

const participantIdentityService = require('../../src/services/PatientIdentityService');
const identityCryptoService = require('../../src/services/participantIdentity.service');

function makeCollection(initialDocs = []) {
  const docs = [...initialDocs];
  return {
    _docs: docs,
    findOne: vi.fn().mockImplementation((query = {}) =>
      Promise.resolve(
        docs.find((doc) => Object.entries(query).every(([k, v]) => doc[k] === v)) || null
      )
    ),
    find: vi.fn().mockImplementation((query = {}) => ({
      toArray: vi.fn().mockResolvedValue(
        docs.filter((doc) => {
          if (query.$or) {
            return query.$or.some((clause) => {
              if (clause.birthDateHash?.$in) {
                return clause.birthDateHash.$in.includes(doc.birthDateHash);
              }
              if (clause.birthDate?.$gte || clause.birthDate?.$lt) {
                const value = doc.birthDate instanceof Date
                  ? doc.birthDate.getTime()
                  : new Date(doc.birthDate).getTime();
                if (clause.birthDate.$gte && value < clause.birthDate.$gte.getTime()) return false;
                if (clause.birthDate.$lt && value >= clause.birthDate.$lt.getTime()) return false;
                return true;
              }
              return false;
            });
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

function makeDb({ participants, participantIdentities }) {
  return {
    collection: vi.fn((name) => {
      if (name === 'participants') return participants;
      if (name === 'participantIdentities') return participantIdentities;
      throw new Error(`unexpected collection requested: ${name}`);
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PatientIdentityService item 8 residual branches', () => {
  it('accepts a Date birthDate instance and matches via the keyless plaintext range', async () => {
    vi.spyOn(identityCryptoService, 'computeBlindIndexCandidates').mockReturnValue([]);
    vi.spyOn(identityCryptoService, 'decryptIdentity').mockImplementation((doc) => doc || {});
    vi.spyOn(identityCryptoService, 'encryptIdentityFields').mockImplementation((values) => values);

    const birthDate = new Date(1990, 0, 20);
    const participants = makeCollection([
      { _id: 'p1', participantId: '11111111', email: null },
    ]);
    const participantIdentities = makeCollection([
      { participantId: '11111111', patientName: 'Ana Silva', birthDate },
    ]);
    const db = makeDb({ participants, participantIdentities });

    const result = await participantIdentityService.matchOrUpsertParticipant(db, {
      patientName: 'Ana Silva',
      birthDate,
    });

    expect(result.created).toBe(false);
    expect(result.matchType).toBe('name+birthDate');
    expect(identityCryptoService.computeBlindIndexCandidates).toHaveBeenCalled();
  });

  it('parses an ISO birthDate string on create', async () => {
    vi.spyOn(identityCryptoService, 'computeBlindIndexCandidates').mockReturnValue(['hash-1']);
    vi.spyOn(identityCryptoService, 'decryptIdentity').mockImplementation((doc) => doc || {});
    vi.spyOn(identityCryptoService, 'encryptIdentityFields').mockImplementation((values) => values);

    const participants = makeCollection();
    const participantIdentities = makeCollection();
    const db = makeDb({ participants, participantIdentities });

    const result = await participantIdentityService.matchOrUpsertParticipant(db, {
      patientName: 'Bruno Costa',
      birthDate: '1991-05-15T12:00:00.000Z',
    });

    expect(result.created).toBe(true);
    expect(result.matchType).toBe('new');
    expect(result.patient.birthDate).toBeInstanceOf(Date);
  });

  it('uses PACIENTE SEM NOME when creating with only a valid participantId', async () => {
    vi.spyOn(identityCryptoService, 'encryptIdentityFields').mockImplementation((values) => values);

    const participants = makeCollection();
    const participantIdentities = makeCollection();
    const db = makeDb({ participants, participantIdentities });

    const result = await participantIdentityService.matchOrUpsertParticipant(db, {
      participantId: '87654321',
    });

    expect(result.created).toBe(true);
    expect(result.patient.patientName).toBe('PACIENTE SEM NOME');
    expect(result.patient.participantId).toBe('87654321');
  });
});
