import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');

const allocatePath = require.resolve('../../src/core/use-cases/AllocateSampleUseCase');
const storageRepoPath = require.resolve('../../src/infrastructure/persistence/mongo/MongoStorageRepository');
const barcodeSymbologyPath = require.resolve('../../src/utils/barcodeSymbology');
const ledgerPath = require.resolve('../../src/utils/sampleMovementLedger');
const sampleServicePath = require.resolve('../../src/services/sample.service');

const originalAllocateCache = require.cache[allocatePath];
const originalStorageCache = require.cache[storageRepoPath];
const originalBarcodeCache = require.cache[barcodeSymbologyPath];
const originalLedgerCache = require.cache[ledgerPath];

let currentAppendMovement = vi.fn().mockResolvedValue();
let currentAllocate = vi.fn().mockResolvedValue({ success: true });
let currentPlacement = vi.fn().mockResolvedValue(null);

function StableAllocateSampleUseCase() {
  this.execute = (...args) => currentAllocate(...args);
}

function StableMongoStorageRepository() {
  this.findCurrentStoragePlacement = (...args) => currentPlacement(...args);
}

const realBarcode = require(barcodeSymbologyPath);
const realLedger = require(ledgerPath);

require.cache[allocatePath] = {
  id: allocatePath,
  filename: allocatePath,
  loaded: true,
  exports: StableAllocateSampleUseCase,
};
require.cache[storageRepoPath] = {
  id: storageRepoPath,
  filename: storageRepoPath,
  loaded: true,
  exports: StableMongoStorageRepository,
};
require.cache[barcodeSymbologyPath] = {
  id: barcodeSymbologyPath,
  filename: barcodeSymbologyPath,
  loaded: true,
  exports: {
    ...realBarcode,
    generateBarcodeSymbologies: () => ({ code128: 'BR-ITEM8' }),
    generateIndustrialBarcodeArtifacts: async () => ({ dataMatrix: 'BR-ITEM8' }),
  },
};
require.cache[ledgerPath] = {
  id: ledgerPath,
  filename: ledgerPath,
  loaded: true,
  exports: {
    ...realLedger,
    appendMovementWithHashChain: (...args) => currentAppendMovement(...args),
  },
};

delete require.cache[sampleServicePath];
const sampleService = require(sampleServicePath);
const qualityDomain = require('../../src/services/quality-domain.service');
const rcsAssessmentService = require('../../src/services/rcs-assessment.service');
const specimenPreanalyticsService = require('../../src/services/specimen-preanalytics.service');
const quarantineActionService = require('../../src/services/quarantine-action.service');

function collection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
    find: vi.fn(() => ({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) })),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    createIndex: vi.fn().mockResolvedValue('item8-index'),
    ...overrides,
  };
}

function buildCreateDb({ sensor = { status: 'active' } } = {}) {
  const boxId = new ObjectId();
  const rackId = new ObjectId();
  const shelfId = new ObjectId();
  const freezerId = new ObjectId();
  const insertedId = new ObjectId();

  const storageById = new Map([
    [String(rackId), { _id: rackId, containerType: 'RACK', parent_id: shelfId }],
    [String(shelfId), { _id: shelfId, containerType: 'SHELF', parent_id: freezerId }],
    [String(freezerId), { _id: freezerId, containerType: 'FREEZER', containerID: 'EQ-ITEM8' }],
  ]);

  const collections = {
    samples: collection({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId }),
    }),
    patients: collection({
      findOne: vi.fn().mockResolvedValue({ participantId: '12345678' }),
    }),
    storageBoxes: collection({
      findOne: vi.fn().mockResolvedValue({ _id: boxId, parent_id: rackId }),
    }),
    storageContainers: collection({
      findOne: vi.fn(async ({ _id }) => storageById.get(String(_id)) || null),
    }),
    equipment: collection({
      findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-ITEM8', status: 'Active' }),
    }),
    sensors: collection({
      findOne: vi.fn().mockResolvedValue(sensor),
    }),
    sample_movements: collection(),
    sampleMovements: collection(),
    counters: collection({
      findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
    }),
  };

  const db = {
    collection: vi.fn((name) => collections[name] || (collections[name] = collection())),
  };

  return { db, collections, boxId, insertedId };
}

function validSample(boxId, overrides = {}) {
  return {
    specimenId: 'BIO-ITEM8-001',
    participantId: '12345678',
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 10,
    quality: 'GOOD',
    linkedProject: 'ITEM8',
    barcode: 'BR-ITEM8-001',
    registeredAt: new Date('2026-09-20T12:00:00Z'),
    boxId: String(boxId),
    positionCode: 'A1',
    ...overrides,
  };
}

describe('sample.service item 8 executable residual branches', () => {
  beforeEach(() => {
    currentAppendMovement = vi.fn().mockResolvedValue();
    currentAllocate = vi.fn().mockResolvedValue({ success: true });
    currentPlacement = vi.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    delete require.cache[sampleServicePath];
    if (originalAllocateCache) require.cache[allocatePath] = originalAllocateCache;
    else delete require.cache[allocatePath];
    if (originalStorageCache) require.cache[storageRepoPath] = originalStorageCache;
    else delete require.cache[storageRepoPath];
    if (originalBarcodeCache) require.cache[barcodeSymbologyPath] = originalBarcodeCache;
    else delete require.cache[barcodeSymbologyPath];
    if (originalLedgerCache) require.cache[ledgerPath] = originalLedgerCache;
    else delete require.cache[ledgerPath];
  });

  it('rejects a sensor whose only reported state is a critical operationalStatus', async () => {
    const { db, boxId } = buildCreateDb({
      sensor: { operationalStatus: 'offline' },
    });

    await expect(sampleService.createSample(db, validSample(boxId)))
      .rejects.toThrow('Sensor atual está em status offline');
  });

  it('preserves the message from a real Error raised by the custody ledger', async () => {
    const { db, boxId, collections } = buildCreateDb();
    currentAppendMovement.mockRejectedValueOnce(new Error('ledger hash write failed'));

    await expect(sampleService.createSample(db, validSample(boxId)))
      .rejects.toThrow('Falha ao registrar cadeia de custódia no nascimento da amostra: ledger hash write failed');

    expect(collections.samples.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('logs Error messages from best-effort RCS and SPREC snapshot persistence without rolling the created sample back', async () => {
    const { db, boxId, collections } = buildCreateDb();
    vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
      model_version: 'RCS-GOV-1.0',
      matrix_type: 'fluid',
      governance_status: 1,
      governance_failure_reasons: [],
      governance_rule_codes: [],
      rcs_score: 95,
      score_based_grade: 'A',
      final_grade: 'A',
      grade_route: 'score',
      axis_penalties: [],
      calculation_trace: {},
    });
    vi.spyOn(rcsAssessmentService, 'recordAssessment')
      .mockRejectedValue(new Error('RCS snapshot unavailable'));
    vi.spyOn(specimenPreanalyticsService, 'recordProfile')
      .mockRejectedValue(new Error('SPREC snapshot unavailable'));

    const result = await sampleService.createSample(db, validSample(boxId, {
      sprec: {
        matrixType: 'fluid',
        sampleType: 'PLASMA',
        primaryContainer: 'A',
        preCentrifugation: 'B',
        centrifugation: 'C',
        secondCentrifugation: 'D',
        postCentrifugationDelay: 'E',
        longTermStorage: 'F',
      },
    }));

    expect(result._id).toEqual(expect.anything());
    expect(collections.samples.deleteOne).not.toHaveBeenCalled();
  });

  it('uses the canonical stored specimenId when reading quarantine-action history', async () => {
    const sampleDoc = {
      _id: new ObjectId(),
      specimenId: 'BIO-CANONICAL-QUAR-001',
    };
    const samples = collection({
      findOne: vi.fn().mockResolvedValue(sampleDoc),
    });
    const db = {
      collection: vi.fn((name) => {
        if (name === 'samples') return samples;
        return collection();
      }),
    };
    const getActions = vi.spyOn(quarantineActionService, 'getActionsForSpecimen')
      .mockResolvedValue([{ action: 'QUARANTINE' }]);

    const result = await sampleService.getQuarantineActions(db, 'BIO-LOOKUP-ALIAS');

    expect(getActions).toHaveBeenCalledWith(db, 'BIO-CANONICAL-QUAR-001');
    expect(result).toEqual([{ action: 'QUARANTINE' }]);
  });
});


describe('sample.service item 8 read/query alternate branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for a missing sample and false when deleteSample removes nothing', async () => {
    const samples = collection({
      findOne: vi.fn().mockResolvedValue(null),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    });
    const db = { collection: vi.fn(() => samples) };

    await expect(sampleService.getSample(db, 'missing')).resolves.toBeNull();
    await expect(sampleService.deleteSample(db, 'missing')).resolves.toBe(false);
  });

  it('applies all supported list filters including organization scope and explicit pagination', async () => {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ specimenId: 'S1' }]),
    };
    const samples = collection({
      find: vi.fn(() => cursor),
      countDocuments: vi.fn().mockResolvedValue(1),
    });
    const db = { collection: vi.fn(() => samples) };

    const result = await sampleService.listSamples(db, {
      participantId: '12345678',
      specimenStatus: 'available',
      sampleType: 'PLASMA',
      organizationScope: { scope: 'organization', organizationIds: ['ORG-1'] },
      limit: 7,
      skip: 3,
    });

    expect(result).toEqual({
      samples: [{ specimenId: 'S1', specimenStatus: 'available' }],
      total: 1,
      limit: 7,
      skip: 3,
    });
    expect(samples.find).toHaveBeenCalledWith(expect.objectContaining({
      participantId: '12345678',
      specimenStatus: 'available',
      sampleType: 'PLASMA',
    }));
    expect(cursor.skip).toHaveBeenCalledWith(3);
    expect(cursor.limit).toHaveBeenCalledWith(7);
  });

  it('resolves an exact barcode without a participant linkage', async () => {
    const sample = { _id: 'sample-1', specimenId: 'S1', barcode: 'ABC', specimenStatus: 'available' };
    const samples = collection({ findOne: vi.fn().mockResolvedValueOnce(sample) });
    const patients = collection();
    const db = {
      collection: vi.fn((name) => name === 'samples' ? samples : patients),
    };

    const result = await sampleService.getSampleByBarcode(db, 'ABC');

    expect(result.sample).toMatchObject({ specimenId: 'S1' });
    expect(result.participant).toBeNull();
    expect(patients.findOne).not.toHaveBeenCalled();
  });

  it('falls through to case-insensitive, numeric and regex barcode strategies', async () => {
    const sampleCase = { _id: 'case', specimenId: 'CASE', barcode: 'ABC', specimenStatus: 'available' };
    let samples = collection({
      findOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(sampleCase),
    });
    let db = { collection: vi.fn((name) => name === 'samples' ? samples : collection()) };
    await expect(sampleService.getSampleByBarcode(db, 'abc')).resolves.toMatchObject({
      sample: expect.objectContaining({ specimenId: 'CASE' }),
    });

    const sampleNumeric = { _id: 'num', specimenId: 'NUM', barcode: 123, specimenStatus: 'available' };
    samples = collection({
      findOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(sampleNumeric),
    });
    db = { collection: vi.fn((name) => name === 'samples' ? samples : collection()) };
    await expect(sampleService.getSampleByBarcode(db, '123')).resolves.toMatchObject({
      sample: expect.objectContaining({ specimenId: 'NUM' }),
    });

    const sampleRegex = { _id: 'regex', specimenId: 'REGEX', barcode: 'R.*', specimenStatus: 'available' };
    samples = collection({
      findOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(sampleRegex),
    });
    db = { collection: vi.fn((name) => name === 'samples' ? samples : collection()) };
    await expect(sampleService.getSampleByBarcode(db, 'R.*')).resolves.toMatchObject({
      sample: expect.objectContaining({ specimenId: 'REGEX' }),
    });
  });

  it('returns the canonical empty barcode result after all lookup strategies fail', async () => {
    const diagnosticsCursor = {
      limit: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ barcode: 'EXAMPLE' }]),
    };
    const samples = collection({
      findOne: vi.fn().mockResolvedValue(null),
      countDocuments: vi.fn().mockResolvedValue(1),
      find: vi.fn(() => diagnosticsCursor),
    });
    const db = { collection: vi.fn((name) => name === 'samples' ? samples : collection()) };

    await expect(sampleService.getSampleByBarcode(db, 'not-found'))
      .resolves.toEqual({ sample: null, participant: null });
  });

  it('anonymizes participant identity for missing, single-part and multi-part names', async () => {
    const identityService = require('../../src/services/participantIdentity.service');
    const sample = {
      _id: 'sample-p',
      specimenId: 'SP',
      barcode: 'P',
      participantId: '12345678',
      specimenStatus: 'available',
    };

    for (const [identity, expected] of [
      [null, '***'],
      [{ patientName: 'Ana' }, 'A***'],
      [{ patientName: 'Ana Silva' }, 'A. S.'],
    ]) {
      const samples = collection({ findOne: vi.fn().mockResolvedValueOnce(sample) });
      const patients = collection({ findOne: vi.fn().mockResolvedValue({ participantId: '12345678', recordNumber: 'R1' }) });
      const identities = collection({ findOne: vi.fn().mockResolvedValue(identity ? { encrypted: true } : null) });
      const db = {
        collection: vi.fn((name) => {
          if (name === 'samples') return samples;
          if (name === 'patients') return patients;
          if (name === 'participantIdentities') return identities;
          return collection();
        }),
      };
      const decrypt = vi.spyOn(identityService, 'decryptIdentity').mockReturnValue(identity);

      const result = await sampleService.getSampleByBarcode(db, 'P');
      expect(result.participant.patientName).toBe(expected);
      decrypt.mockRestore();
    }
  });

  it('rejects sample-result lookup when the sample does not exist', async () => {
    const samples = collection({ findOne: vi.fn().mockResolvedValue(null) });
    const results = collection();
    const db = {
      collection: vi.fn((name) => name === 'samples' ? samples : results),
    };

    await expect(sampleService.getSampleResults(db, 'missing')).rejects.toThrow('Amostra não encontrada');
  });

  it('rejects an invalid barcode render request and forwards includePayload=false for valid industrial assets', async () => {
    await expect(sampleService.getBarcodeIndustrialAssets(''))
      .rejects.toThrow('Código de barras inválido');

    await expect(sampleService.getBarcodeIndustrialAssets('ABC123', { includePayload: false }))
      .resolves.toEqual({ dataMatrix: 'BR-ITEM8' });
  });

  it('falls back to the requested specimen identifier when SPREC/quarantine history lookup finds no Sample', async () => {
    const samples = collection({ findOne: vi.fn().mockResolvedValue(null) });
    const db = { collection: vi.fn(() => samples) };
    const sprec = vi.spyOn(specimenPreanalyticsService, 'getProfilesForSpecimen').mockResolvedValue([]);
    const quarantine = vi.spyOn(quarantineActionService, 'getActionsForSpecimen').mockResolvedValue([]);

    const idObject = { toString: () => 'OBJ-SPEC' };
    await sampleService.getSprecProfiles(db, idObject);
    await sampleService.getQuarantineActions(db, 'RAW-SPEC');

    expect(sprec).toHaveBeenCalledWith(db, 'OBJ-SPEC');
    expect(quarantine).toHaveBeenCalledWith(db, 'RAW-SPEC');
  });

  it('forces research availability regardless of a caller-supplied specimenStatus', async () => {
    const cursor = { toArray: vi.fn().mockResolvedValue([]) };
    const samples = collection({ find: vi.fn(() => cursor) });
    const db = { collection: vi.fn(() => samples) };

    await sampleService.findAvailableSamplesForResearch(db, {
      specimenStatus: 'quarantined',
      sampleType: 'PLASMA',
    });

    expect(samples.find).toHaveBeenCalledWith({
      specimenStatus: 'available',
      sampleType: 'PLASMA',
    });
  });
});
