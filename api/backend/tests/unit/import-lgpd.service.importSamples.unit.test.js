import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────────────────
// ImportLGPDService.importSamples — DB-backed method, previously untested
// at the service level (only mocked out in the controller test suite).
//
// patientIdentityService/qualityDomain are required as module objects (not
// destructured), so vi.spyOn on the real singletons works normally.
// DrugService/SampleGraphValidator are constructed with `new`, so they're
// vi.mock'd as minimal classes. generateSampleHash is destructured at
// module scope in import-lgpd.service.js, so it must be vi.mock'd too (see
// testing-conventions' note on destructured imports defeating vi.spyOn).
// ──────────────────────────────────────────────────────────

vi.mock('../../src/services/DrugService', () => ({
  default: class DrugService {
    async searchAndCacheDrug() {
      return [];
    }
  },
}));
vi.mock('../../src/services/SampleGraphValidator', () => ({
  default: class SampleGraphValidator {
    async validateSampleCompliance() {
      return { ok: true };
    }
  },
}));
vi.mock('../../src/services/MerkleService', () => ({ generateSampleHash: vi.fn(() => 'hash-1') }));

const service = require('../../src/services/import-lgpd.service');
const patientIdentityService = require('../../src/services/PatientIdentityService');
const qualityDomain = require('../../src/services/quality-domain.service');

const MATCHED_PATIENT = {
  patient: { _id: 'patient-obj-1', patientID: '12345678', patientName: 'Maria Silva' },
};

const VALID_ROW = {
  sampleType: 'PLASMA',
  sampleOrigin: 'VENOUS_BLOOD',
  extractionProtocol: 'TUBE_EDTA',
  patientID: '12345678',
  quantity: '5',
  quality: 'GOOD',
  linkedProject: 'Proj1',
  tcle_id: 'tcle-1',
  sprec_sample_type: 'ST1',
  sprec_primary_container: 'PC1',
};

function makeDb({ sampleTypeFound = true, sampleOriginFound = true, protocolFound = true, existingBarcode = null } = {}) {
  const samplesCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-id-1' }),
    updateOne: vi.fn().mockResolvedValue({}),
    findOne: vi.fn().mockResolvedValue(existingBarcode),
  };
  const patientsCollection = {
    updateOne: vi.fn().mockResolvedValue({}),
  };
  const sampleTypesCollection = { findOne: vi.fn().mockResolvedValue(sampleTypeFound ? { description: 'PLASMA' } : null) };
  const sampleOriginsCollection = { findOne: vi.fn().mockResolvedValue(sampleOriginFound ? { description: 'VENOUS_BLOOD' } : null) };
  const extractionProtocolsCollection = { findOne: vi.fn().mockResolvedValue(protocolFound ? { description: 'TUBE_EDTA' } : null) };
  const amostrasCollection = {
    // Backs generateUniqueBarcode's own lookup for the last barcode of the year.
    find: vi.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })),
  };

  const collections = {
    samples: samplesCollection,
    patients: patientsCollection,
    sampleTypes: sampleTypesCollection,
    sampleOrigins: sampleOriginsCollection,
    extractionProtocols: extractionProtocolsCollection,
    amostras: amostrasCollection,
  };

  const db = {
    collection: vi.fn((name) => {
      if (!collections[name]) {
        throw new Error(`unexpected collection requested: ${name}`);
      }
      return collections[name];
    }),
  };

  return { db, samplesCollection, patientsCollection };
}

describe('ImportLGPDService.importSamples', () => {
  let db;
  let samplesCollection;
  let patientsCollection;

  beforeEach(() => {
    ({ db, samplesCollection, patientsCollection } = makeDb());

    vi.spyOn(patientIdentityService, 'matchOrUpsertPatient').mockResolvedValue(MATCHED_PATIENT);
    vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
      governance_status: 1,
      final_grade: 'A',
      category: 'A',
      score: 90,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when required sample fields are missing from the headers', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ sampleOrigin: 'VENOUS_BLOOD', patientID: '12345678' }]);
    await expect(
      service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' })
    ).rejects.toThrow(/Campos obrigatórios ausentes/);
  });

  it('throws when there is no patient-identification column at all', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ sampleType: 'PLASMA', sampleOrigin: 'VENOUS_BLOOD' }]);
    await expect(
      service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' })
    ).rejects.toThrow(/Identificação do paciente ausente/);
  });

  it('records a per-row error when patient identity resolution comes back empty', async () => {
    patientIdentityService.matchOrUpsertPatient.mockResolvedValue({ patient: null });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors[0]).toMatch(/identidade do paciente/);
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('records a per-row error when the resolved patientID is not exactly 8 digits', async () => {
    patientIdentityService.matchOrUpsertPatient.mockResolvedValue({
      patient: { _id: 'p1', patientID: '123', patientName: 'X' },
    });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors[0]).toMatch(/8 dígitos numéricos/);
  });

  it('records a per-row error for a malformed atc_code', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, treatment_status: 'TREATED', atc_code: 'NOT-A-CODE' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors[0]).toMatch(/atc_code inválido/);
  });

  // BUG (issue #84): `SampleModel` here is
  // `require('../models/Sample')`, which exports the *mongoose Model*, not
  // the hand-written validator class (attached separately as
  // `SampleModel.SampleModel`). Calling `SampleModel.validate(sampleData)`
  // therefore invokes mongoose's own async static `Model.validate`, which
  // returns a Promise — so `!validation.isValid` is always `true` and
  // `validation.errors` is always `undefined`. Every row is rejected
  // regardless of actual validity, insertOne is never reached, and the
  // unawaited rejection (e.g. for a genuinely missing required field) surfaces
  // as an unhandled promise rejection. These tests assert the actual (buggy)
  // behavior, not the intended one.
  it('BUG: an unrecognized quality value silently becomes null (parseQualityMIABIS), so the explicit MIABIS-scale check never fires, and the row is instead rejected downstream by the broken SampleModel.validate call', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, quality: 'BOGUS' }]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errors).toBeUndefined();
  });

  it('BUG: a row with otherwise-valid data is still rejected, with a corrupted (undefined) errors array, because SampleModel.validate never returns {isValid,errors} synchronously', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errors).toBeUndefined();
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('BUG: the duplicate-barcode check is dead code — it sits after SampleModel.validate, which rejects the row first regardless of the barcode', async () => {
    ({ db, samplesCollection } = makeDb({ existingBarcode: { barcode: 'BR-2026-001' } }));
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, barcode: 'BR-2026-001' }]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors).toBeUndefined();
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('propagates the underlying error (and never reaches the DB) when reading the file fails', async () => {
    vi.spyOn(service, 'readFile').mockRejectedValue(new Error('Arquivo não encontrado'));

    await expect(
      service.importSamples(db, { path: '/missing.csv', originalname: 'missing.csv' })
    ).rejects.toThrow('Arquivo não encontrado');
    expect(db.collection).not.toHaveBeenCalled();
  });
});

describe('ImportLGPDService.getNextAvailableLocation', () => {
  function makeLocationsDb(locations) {
    return {
      collection: vi.fn(() => ({
        findOne: vi.fn(async (query) => locations.find((loc) => loc.locationID === query.locationID) || null),
        find: vi.fn(() => ({ toArray: async () => locations })),
      })),
    };
  }

  it('returns null when the start location does not exist', async () => {
    const db = makeLocationsDb([]);
    const result = await service.getNextAvailableLocation(db, 'L1', 1);
    expect(result).toBeNull();
  });

  it('returns the location N steps after the start location, sorted by block/rack/drawer/box', async () => {
    const db = makeLocationsDb([
      { locationID: 'L1', block: 1, rack: 1, drawer: 1, box: 1 },
      { locationID: 'L2', block: 1, rack: 1, drawer: 1, box: 2 },
      { locationID: 'L3', block: 1, rack: 1, drawer: 1, box: 3 },
    ]);

    const result = await service.getNextAvailableLocation(db, 'L1', 1);
    expect(result).toBe('L2');
  });

  it('returns null when the requested offset runs past the end of the sorted list', async () => {
    const db = makeLocationsDb([
      { locationID: 'L1', block: 1, rack: 1, drawer: 1, box: 1 },
    ]);

    const result = await service.getNextAvailableLocation(db, 'L1', 5);
    expect(result).toBeNull();
  });

  it('returns null (and logs) instead of throwing when the query rejects', async () => {
    const db = {
      collection: vi.fn(() => ({
        findOne: vi.fn().mockRejectedValue(new Error('mongo down')),
      })),
    };

    const result = await service.getNextAvailableLocation(db, 'L1', 1);
    expect(result).toBeNull();
  });
});
