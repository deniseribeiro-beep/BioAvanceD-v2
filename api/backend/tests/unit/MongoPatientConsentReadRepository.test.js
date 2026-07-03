import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const MongoPatientConsentReadRepository = require('../../src/infrastructure/persistence/mongo/MongoPatientConsentReadRepository');

/**
 * Builds a fake `db` with a `.collection(name)` method returning per-name
 * fake Mongo collection objects. This bypasses `getCollection` entirely
 * (see note in report about why spying on getCollection wouldn't work here).
 */
function createDb({ patients = {}, consents = {} } = {}) {
  const patientsCollection = {
    findOne: vi.fn(),
    ...patients
  };
  const consentsCollection = {
    findOne: vi.fn(),
    countDocuments: vi.fn().mockResolvedValue(0),
    ...consents
  };

  const collection = vi.fn((name) => {
    if (name === 'patients') return patientsCollection;
    if (name === 'patientConsents') return consentsCollection;
    throw new Error(`Unexpected collection name: ${name}`);
  });

  return {
    collection,
    listCollections: undefined, // not a function -> resolveCollectionName short-circuits to preferred name
    __patientsCollection: patientsCollection,
    __consentsCollection: consentsCollection
  };
}

function makeSample(overrides = {}) {
  return {
    _id: 's1',
    barcode: 'BC1',
    patientID: 'P1',
    sampleType: 'blood',
    sampleOrigin: 'clinic',
    currentStatus: 'stored',
    quantity: 5,
    registrationDate: '2024-01-01',
    ...overrides
  };
}

describe('MongoPatientConsentReadRepository', () => {
  it('returns empty array when samples is undefined', async () => {
    const db = createDb();
    const repo = new MongoPatientConsentReadRepository(db);

    const result = await repo.enrichSamplesWithConsent(undefined);

    expect(result).toEqual([]);
  });

  it('returns empty array when samples is an empty array', async () => {
    const db = createDb();
    const repo = new MongoPatientConsentReadRepository(db);

    const result = await repo.enrichSamplesWithConsent([]);

    expect(result).toEqual([]);
  });

  it('marks sample allocatable with "Consentimento ativo" when patient found and has an active consent', async () => {
    const patientObjId = { toString: () => 'patient-id-1' };
    const db = createDb({
      patients: {
        findOne: vi.fn().mockResolvedValue({ _id: patientObjId, patientID: 'P1' })
      },
      consents: {
        findOne: vi.fn().mockResolvedValue({ patientId: 'patient-id-1', status: 'ACTIVE' }),
        countDocuments: vi.fn().mockResolvedValue(5)
      }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const result = await repo.enrichSamplesWithConsent([makeSample()]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      consentValid: true,
      consentMessage: 'Consentimento ativo',
      canAllocate: true,
      barcode: 'BC1',
      patientID: 'P1'
    });
    expect(db.__consentsCollection.findOne).toHaveBeenCalledWith({
      patientId: 'patient-id-1',
      status: 'ACTIVE'
    });
  });

  it('bypasses consent as valid ("Sistema de consentimento em implementação") when patient found, no active consent, but total consent count is zero', async () => {
    const patientObjId = { toString: () => 'patient-id-2' };
    const db = createDb({
      patients: {
        findOne: vi.fn().mockResolvedValue({ _id: patientObjId, patientID: 'P2' })
      },
      consents: {
        findOne: vi.fn().mockResolvedValue(null),
        countDocuments: vi.fn().mockResolvedValue(0)
      }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const result = await repo.enrichSamplesWithConsent([makeSample({ patientID: 'P2' })]);

    expect(result).toHaveLength(1);
    expect(result[0].consentValid).toBe(true);
    expect(result[0].consentMessage).toBe('Sistema de consentimento em implementação');
    expect(result[0].canAllocate).toBe(true);
  });

  it('rejects (canAllocate=false, filtered out) when patient found, no active consent, and other consents exist in the collection', async () => {
    const patientObjId = { toString: () => 'patient-id-3' };
    const db = createDb({
      patients: {
        findOne: vi.fn().mockResolvedValue({ _id: patientObjId, patientID: 'P3' })
      },
      consents: {
        findOne: vi.fn().mockResolvedValue(null),
        countDocuments: vi.fn().mockResolvedValue(3)
      }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const result = await repo.enrichSamplesWithConsent([makeSample({ patientID: 'P3' })]);

    // The rejected sample is filtered out of the final array entirely.
    expect(result).toEqual([]);
  });

  it('bypasses consent as valid ("Paciente não encontrado (dev mode)") when the patient is not found', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue(null) },
      consents: { countDocuments: vi.fn().mockResolvedValue(3) }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const result = await repo.enrichSamplesWithConsent([makeSample({ patientID: 'unknown-patient' })]);

    expect(result).toHaveLength(1);
    expect(result[0].consentValid).toBe(true);
    expect(result[0].consentMessage).toBe('Paciente não encontrado (dev mode)');
    expect(result[0].canAllocate).toBe(true);
    // No consent lookup should be attempted for a patient that was never found.
    expect(db.__consentsCollection.findOne).not.toHaveBeenCalled();
  });

  it('looks up the patient via $or matching either patientID or _id', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue(null) }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    await repo.enrichSamplesWithConsent([makeSample({ patientID: 'some-value' })]);

    expect(db.__patientsCollection.findOne).toHaveBeenCalledWith({
      $or: [
        { patientID: 'some-value' },
        { _id: 'some-value' }
      ]
    });
  });

  it('filters the returned array down to only canAllocate=true entries (mixed accept/reject)', async () => {
    const acceptedPatientId = { toString: () => 'accepted-id' };
    const rejectedPatientId = { toString: () => 'rejected-id' };

    const db = createDb({
      patients: {
        findOne: vi.fn((query) => {
          const target = query.$or[0].patientID;
          if (target === 'accept-me') {
            return Promise.resolve({ _id: acceptedPatientId, patientID: 'accept-me' });
          }
          if (target === 'reject-me') {
            return Promise.resolve({ _id: rejectedPatientId, patientID: 'reject-me' });
          }
          return Promise.resolve(null);
        })
      },
      consents: {
        findOne: vi.fn((query) => {
          if (query.patientId === 'accepted-id') {
            return Promise.resolve({ patientId: 'accepted-id', status: 'ACTIVE' });
          }
          return Promise.resolve(null);
        }),
        countDocuments: vi.fn().mockResolvedValue(10) // non-zero -> no escape hatch for the rejected one
      }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const samples = [
      makeSample({ _id: 'sample-accepted', patientID: 'accept-me' }),
      makeSample({ _id: 'sample-rejected', patientID: 'reject-me' })
    ];

    const result = await repo.enrichSamplesWithConsent(samples);

    expect(result).toHaveLength(1);
    expect(result.map((s) => s._id)).toEqual(['sample-accepted']);
  });

  it('processes multiple samples in parallel without cross-sample state leakage', async () => {
    const patientA = { toString: () => 'id-a' };
    const patientB = { toString: () => 'id-b' };
    const patientC = { toString: () => 'id-c' };

    const db = createDb({
      patients: {
        findOne: vi.fn((query) => {
          const target = query.$or[0].patientID;
          if (target === 'A') return Promise.resolve({ _id: patientA, patientID: 'A' });
          if (target === 'B') return Promise.resolve({ _id: patientB, patientID: 'B' });
          if (target === 'C') return Promise.resolve({ _id: patientC, patientID: 'C' });
          return Promise.resolve(null);
        })
      },
      consents: {
        findOne: vi.fn((query) => {
          if (query.patientId === 'id-a') {
            return Promise.resolve({ patientId: 'id-a', status: 'ACTIVE' });
          }
          return Promise.resolve(null); // B and C have no active consent
        }),
        countDocuments: vi.fn().mockResolvedValue(7) // non-zero: B, C rejected (no escape hatch)
      }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const samples = [
      makeSample({ _id: 'sample-A', patientID: 'A' }),
      makeSample({ _id: 'sample-B', patientID: 'B' }),
      makeSample({ _id: 'sample-C', patientID: 'C' })
    ];

    const result = await repo.enrichSamplesWithConsent(samples);

    // Only A has an active consent; B and C are rejected and dropped.
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe('sample-A');
    expect(result[0].consentMessage).toBe('Consentimento ativo');
  });

  it('calls countDocuments exactly once per enrichSamplesWithConsent call, regardless of sample count', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue(null) }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const samples = [
      makeSample({ _id: 's1', patientID: 'P1' }),
      makeSample({ _id: 's2', patientID: 'P2' }),
      makeSample({ _id: 's3', patientID: 'P3' }),
      makeSample({ _id: 's4', patientID: 'P4' })
    ];

    await repo.enrichSamplesWithConsent(samples);

    expect(db.__consentsCollection.countDocuments).toHaveBeenCalledTimes(1);
  });
});
