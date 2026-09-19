import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const StorageService = require('../../src/services/storageService');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');

afterEach(() => vi.restoreAllMocks());

function db() {
  return createDbMock();
}

function sample(id, placement = null) {
  return { _id: id, specimenId: String(id), barcode: null, currentStoragePlacement: placement };
}

describe('StorageService item 8 residual canonical branches', () => {
  it('returns BOX_NOT_FOUND, SAMPLE_NOT_FOUND and ALREADY_ALLOCATED before transaction start', async () => {
    const specimenId = new ObjectId();
    const boxId = new ObjectId();

    let service = new StorageService(db());
    service.storageRepository = {
      findBoxById: vi.fn().mockResolvedValue(null),
      findSampleById: vi.fn(),
      withTransaction: vi.fn(),
    };
    await expect(service.autoAssignSampleToBox(specimenId, boxId)).resolves.toMatchObject({ success: false, error: 'BOX_NOT_FOUND' });

    service = new StorageService(db());
    service.storageRepository = {
      findBoxById: vi.fn().mockResolvedValue({ _id: boxId, dimension: { rows: 1, cols: 1 }, occupancyGrid: {} }),
      findSampleById: vi.fn().mockResolvedValue(null),
      withTransaction: vi.fn(),
    };
    await expect(service.autoAssignSampleToBox(specimenId, boxId)).resolves.toMatchObject({ success: false, error: 'SAMPLE_NOT_FOUND' });

    service = new StorageService(db());
    service.storageRepository = {
      findBoxById: vi.fn().mockResolvedValue({ _id: boxId, dimension: { rows: 1, cols: 1 }, occupancyGrid: {} }),
      findSampleById: vi.fn().mockResolvedValue(sample(specimenId, { boxId: 'BOX', positionCode: 'A1' })),
      withTransaction: vi.fn(),
    };
    await expect(service.autoAssignSampleToBox(specimenId, boxId)).resolves.toMatchObject({ success: false, error: 'ALREADY_ALLOCATED' });
  });

  it('maps canonical transaction refresh failures to their specific error codes', async () => {
    const specimenId = new ObjectId();
    const boxId = new ObjectId();
    const database = db();
    const service = new StorageService(database);
    const snapshot = sample(specimenId, null);
    service.storageRepository = {
      findBoxById: vi.fn().mockResolvedValue({ _id: boxId, dimension: { rows: 1, cols: 1 }, occupancyGrid: {} }),
      findSampleById: vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce(null),
      withTransaction: vi.fn(async (handler) => handler(database.session)),
    };
    service._findFirstAvailablePosition = vi.fn(() => 'A1');

    await expect(service.autoAssignSampleToBox(specimenId, boxId)).resolves.toMatchObject({ success: false, error: 'SAMPLE_NOT_FOUND' });
  });

  it('covers explicit legacy catch-code mappings without changing canonical persistence', async () => {
    const specimenId = new ObjectId();
    const boxId = new ObjectId();
    for (const code of ['BOX_NOT_FOUND', 'SAMPLE_NOT_FOUND', 'ALREADY_ALLOCATED', 'BOX_FULL']) {
      const service = new StorageService(db());
      service.storageRepository = {
        findBoxById: vi.fn().mockRejectedValue(new Error(code)),
      };
      const result = await service.autoAssignSampleToBox(specimenId, boxId);
      expect(result.error).toBe(code);
    }
    const service = new StorageService(db());
    service.storageRepository = { findBoxById: vi.fn().mockRejectedValue({}) };
    await expect(service.autoAssignSampleToBox(specimenId, boxId)).resolves.toMatchObject({
      success: false,
      error: 'AUTO_ASSIGNMENT_ERROR',
      message: 'Erro ao realizar alocação inteligente',
    });
  });

  it('returns release precondition failures before opening a transaction', async () => {
    const specimenId = new ObjectId();

    let service = new StorageService(db());
    service.storageRepository = { findSampleById: vi.fn().mockResolvedValue(null), withTransaction: vi.fn() };
    await expect(service.releaseSampleFromPosition(specimenId)).resolves.toMatchObject({ success: false, error: 'SAMPLE_NOT_FOUND' });

    service = new StorageService(db());
    service.storageRepository = {
      findSampleById: vi.fn().mockResolvedValue(sample(specimenId, null)),
      withTransaction: vi.fn(),
    };
    await expect(service.releaseSampleFromPosition(specimenId)).resolves.toMatchObject({ success: false, error: 'NO_PHYSICAL_PLACEMENT' });
  });

  it('maps refreshed release failures for missing sample and missing physical placement', async () => {
    const specimenId = new ObjectId();
    const boxId = new ObjectId();

    let database = db();
    let service = new StorageService(database);
    service.storageRepository = {
      findSampleById: vi.fn()
        .mockResolvedValueOnce(sample(specimenId, { boxId, positionCode: 'A1' }))
        .mockResolvedValueOnce(null),
      withTransaction: vi.fn(async (handler) => handler(database.session)),
    };
    await expect(service.releaseSampleFromPosition(specimenId)).resolves.toMatchObject({ success: false, error: 'SAMPLE_NOT_FOUND' });

    database = db();
    service = new StorageService(database);
    service.storageRepository = {
      findSampleById: vi.fn()
        .mockResolvedValueOnce(sample(specimenId, { boxId, positionCode: 'A1' }))
        .mockResolvedValueOnce(sample(specimenId, null)),
      withTransaction: vi.fn(async (handler) => handler(database.session)),
    };
    await expect(service.releaseSampleFromPosition(specimenId)).resolves.toMatchObject({ success: false, error: 'NO_PHYSICAL_PLACEMENT' });
  });

  it('returns BOX_NOT_FOUND from integrity validation', async () => {
    const storageBoxes = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    const service = new StorageService(createDbMock({ storageBoxes, samples: createCollectionMock() }));
    await expect(service.verifyBoxIntegrity(new ObjectId())).resolves.toEqual({ valid: false, error: 'BOX_NOT_FOUND' });
  });

  it('covers Map occupancy, blank entries, orphan references, placement fallbacks and count mismatch', async () => {
    const boxId = new ObjectId();
    const orphanId = new ObjectId();
    const liveId = new ObjectId();
    const grid = new Map([['A1', null], ['A2', orphanId], ['A3', liveId]]);
    const storageBoxes = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: boxId, dimension: { rows: 1, cols: 3 }, occupancyGrid: grid, currentOccupancy: 99 }),
    });
    const samples = createCollectionMock({
      findOne: vi.fn(async ({ _id }) => String(_id) === String(orphanId) ? null : { _id: liveId }),
    });
    const service = new StorageService(createDbMock({ storageBoxes, samples }));
    service.storageRepository.findCurrentStoragePlacement = vi.fn().mockResolvedValue(null);

    const result = await service.verifyBoxIntegrity(boxId);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Orfão'),
      expect.stringContaining('Inconsistência'),
      expect.stringContaining('Contagem incorreta'),
    ]));
  });

  it('delegates generation of all valid positions to the canonical grid helper', () => {
    const service = new StorageService(db());
    expect(service._getAllValidPositions({ rows: 1, cols: 2 })).toEqual(['A1', 'A2']);
  });
});
