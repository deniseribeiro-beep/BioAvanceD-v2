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
  patient: { _id: 'patient-obj-1', participantId: '12345678', patientName: 'Maria Silva' },
};

const VALID_ROW = {
  sampleType: 'PLASMA',
  sampleOrigin: 'VENOUS_BLOOD',
  extractionProtocol: 'TUBE_EDTA',
  participantId: '12345678',
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
    // Backs both the barcode-duplicate check and generateUniqueSpecimenId's
    // own collision check (`{ specimenId }`) — only the barcode query should
    // resolve `existingBarcode`, or the specimenId generator spins until it
    // exhausts its retry budget.
    findOne: vi.fn().mockImplementation((query) => {
      if (query && Object.prototype.hasOwnProperty.call(query, 'specimenId')) {
        return Promise.resolve(null);
      }
      return Promise.resolve(existingBarcode);
    }),
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
    findOne: vi.fn().mockResolvedValue(null),
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

    vi.spyOn(patientIdentityService, 'matchOrUpsertParticipant').mockResolvedValue(MATCHED_PATIENT);
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
    vi.spyOn(service, 'readFile').mockResolvedValue([{ sampleOrigin: 'VENOUS_BLOOD', participantId: '12345678' }]);
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
    patientIdentityService.matchOrUpsertParticipant.mockResolvedValue({ patient: null });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors[0]).toMatch(/identidade do paciente/);
    expect(samplesCollection.insertOne).not.toHaveBeenCalled();
  });

  it('records a per-row error when the resolved patientID is not exactly 8 digits', async () => {
    patientIdentityService.matchOrUpsertParticipant.mockResolvedValue({
      patient: { _id: 'p1', participantId: '123', patientName: 'X' },
    });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors[0]).toMatch(/8 dígitos numéricos/);
  });

  it('records a per-row error for a malformed atc_code', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, treatmentStatus: 'TREATED', atcCode: 'NOT-A-CODE' },
    ]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors[0]).toMatch(/atcCode inválido/);
  });

  // Regression coverage for issue #84: `SampleModel` here must resolve to the
  // hand-written validator class (`require('../models/Sample').SampleModel`),
  // not the mongoose Model (the default export of that same module). Before
  // the fix, `SampleModel.validate(sampleData)` invoked mongoose's own async
  // static `Model.validate`, which returns a Promise — so every row was
  // rejected regardless of actual validity and `validation.errors` was
  // always `undefined`.
  // Pinned to current behavior, not desired behavior: parseQualityMIABIS
  // silently maps an unrecognized value to null, and SampleModel.validate()
  // doesn't require `quality` at all, so the row imports successfully
  // instead of being rejected. Whether `quality` should be required is the
  // same Sample.validate/create design gap tracked in #224 — revisit this
  // assertion once that design call resolves.
  it('accepts an unrecognized quality value: parseQualityMIABIS silently maps it to null, and SampleModel.validate does not require quality (tracked in #224)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, quality: 'BOGUS' }]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('imports a row with otherwise-valid data, running it through the real validator', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(samplesCollection.insertOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a row whose barcode already exists (the duplicate-barcode check now runs after real validation)', async () => {
    ({ db, samplesCollection } = makeDb({ existingBarcode: { barcode: 'BR-2026-001' } }));
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, barcode: 'BR-2026-001' }]);

    const result = await service.importSamples(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors).toEqual(['Já existe uma amostra com o código de barras BR-2026-001']);
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
