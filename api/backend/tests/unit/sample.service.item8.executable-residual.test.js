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
