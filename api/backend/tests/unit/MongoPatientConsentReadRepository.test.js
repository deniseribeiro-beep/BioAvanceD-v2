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
    specimenId: 'BR-0001',
    barcode: 'BC1',
    participantId: 'P1',
    sampleType: 'blood',
    sampleOrigin: 'clinic',
    currentStatus: 'stored',
    quantity: 5,
    registeredAt: '2024-01-01',
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
        findOne: vi.fn().mockResolvedValue({ _id: patientObjId, participantId: 'P1' })
      },
      consents: {
        findOne: vi.fn().mockResolvedValue({ participantId: 'patient-id-1', status: 'ACTIVE' }),
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
      specimenId: 'BR-0001',
      barcode: 'BC1',
      participantId: 'P1'
    });
    expect(db.__patientsCollection.findOne).toHaveBeenCalledWith({ participantId: 'P1' });
    expect(db.__consentsCollection.findOne).toHaveBeenCalledWith({
      participantId: { $in: ['P1', 'patient-id-1'] },
      status: 'ACTIVE'
    });
  });

  it('rejects (canAllocate=false, filtered out) when patient found, no active consent, and the consents collection is empty', async () => {
    const patientObjId = { toString: () => 'patient-id-2' };
    const db = createDb({
      patients: {
        findOne: vi.fn().mockResolvedValue({ _id: patientObjId, participantId: 'P2' })
      },
      consents: {
        findOne: vi.fn().mockResolvedValue(null),
        countDocuments: vi.fn().mockResolvedValue(0)
      }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const result = await repo.enrichSamplesWithConsent([makeSample({ participantId: 'P2' })]);

    // An empty consents collection is no longer an escape hatch (fixed in 5e571099):
    // the sample is rejected and filtered out like any other missing-consent case.
    expect(result).toEqual([]);
  });

  it('rejects (canAllocate=false, filtered out) when patient found, no active consent, and other consents exist in the collection', async () => {
    const patientObjId = { toString: () => 'patient-id-3' };
    const db = createDb({
      patients: {
        findOne: vi.fn().mockResolvedValue({ _id: patientObjId, participantId: 'P3' })
      },
      consents: {
        findOne: vi.fn().mockResolvedValue(null),
        countDocuments: vi.fn().mockResolvedValue(3)
      }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const result = await repo.enrichSamplesWithConsent([makeSample({ participantId: 'P3' })]);

    // The rejected sample is filtered out of the final array entirely.
    expect(result).toEqual([]);
  });

  it('rejects (canAllocate=false, filtered out) when the patient is not found', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue(null) },
      consents: { countDocuments: vi.fn().mockResolvedValue(3) }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const result = await repo.enrichSamplesWithConsent([makeSample({ participantId: 'unknown-patient' })]);

    // A missing patient record no longer bypasses consent (fixed in 5e571099):
    // it fails closed and is filtered out of the result.
    expect(result).toEqual([]);
    // No consent lookup should be attempted for a patient that was never found.
    expect(db.__consentsCollection.findOne).not.toHaveBeenCalled();
  });

  it('issues no patient lookup at all when participantId is absent, and treats the sample as not found', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue({ _id: 'someone-else', participantId: 'other' }) }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const result = await repo.enrichSamplesWithConsent([
      makeSample({ _id: 'blank-sample', participantId: undefined })
    ]);

    // No query may be issued for a blank/absent participantId: an unguarded
    // $or on { participantId: undefined } / { _id: undefined } serialises to
    // BSON null and would match any patient with a null/absent participantId.
    expect(db.__patientsCollection.findOne).not.toHaveBeenCalled();
    // Same fail-closed path as "patient not found": no consent lookup, and
    // the sample is filtered out of the result entirely.
    expect(db.__consentsCollection.findOne).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  // #850: this asserted the old two-leg $or. The `_id` leg was dead by
  // construction -- PatientModel.create's allow-list omits `_id`, so every
  // patient `_id` is an ObjectId and a string participantId cannot match it.
  // The filter is now single-key, and this pins that exact shape.
  it('looks up the patient by participantId alone, with no dead _id leg', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue(null) }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    await repo.enrichSamplesWithConsent([makeSample({ participantId: 'some-value' })]);

    expect(db.__patientsCollection.findOne).toHaveBeenCalledWith({ participantId: 'some-value' });
    expect(db.__patientsCollection.findOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ $or: expect.anything() })
    );
  });

  it('filters the returned array down to only canAllocate=true entries (mixed accept/reject)', async () => {
    const acceptedPatientId = { toString: () => 'accepted-id' };
    const rejectedPatientId = { toString: () => 'rejected-id' };

    const db = createDb({
      patients: {
        findOne: vi.fn((query) => {
          const target = query.participantId;
          if (target === 'accept-me') {
            return Promise.resolve({ _id: acceptedPatientId, participantId: 'accept-me' });
          }
          if (target === 'reject-me') {
            return Promise.resolve({ _id: rejectedPatientId, participantId: 'reject-me' });
          }
          return Promise.resolve(null);
        })
      },
      consents: {
        findOne: vi.fn((query) => {
          if (query.participantId?.$in?.includes('accepted-id')) {
            return Promise.resolve({ participantId: 'accepted-id', status: 'ACTIVE' });
          }
          return Promise.resolve(null);
        }),
        countDocuments: vi.fn().mockResolvedValue(10)
      }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const samples = [
      makeSample({ _id: 'sample-accepted', participantId: 'accept-me' }),
      makeSample({ _id: 'sample-rejected', participantId: 'reject-me' })
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
          const target = query.participantId;
          if (target === 'A') return Promise.resolve({ _id: patientA, participantId: 'A' });
          if (target === 'B') return Promise.resolve({ _id: patientB, participantId: 'B' });
          if (target === 'C') return Promise.resolve({ _id: patientC, participantId: 'C' });
          return Promise.resolve(null);
        })
      },
      consents: {
        findOne: vi.fn((query) => {
          if (query.participantId?.$in?.includes('id-a')) {
            return Promise.resolve({ participantId: 'id-a', status: 'ACTIVE' });
          }
          return Promise.resolve(null); // B and C have no active consent
        }),
        countDocuments: vi.fn().mockResolvedValue(7)
      }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const samples = [
      makeSample({ _id: 'sample-A', participantId: 'A' }),
      makeSample({ _id: 'sample-B', participantId: 'B' }),
      makeSample({ _id: 'sample-C', participantId: 'C' })
    ];

    const result = await repo.enrichSamplesWithConsent(samples);

    // Only A has an active consent; B and C are rejected and dropped.
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe('sample-A');
    expect(result[0].consentMessage).toBe('Consentimento ativo');
  });

  it('never calls countDocuments (per-patient consent check only, no collection-wide escape hatch)', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue(null) }
    });
    const repo = new MongoPatientConsentReadRepository(db);

    const samples = [
      makeSample({ _id: 's1', participantId: 'P1' }),
      makeSample({ _id: 's2', participantId: 'P2' }),
      makeSample({ _id: 's3', participantId: 'P3' }),
      makeSample({ _id: 's4', participantId: 'P4' })
    ];

    await repo.enrichSamplesWithConsent(samples);

    expect(db.__consentsCollection.countDocuments).not.toHaveBeenCalled();
  });
});
