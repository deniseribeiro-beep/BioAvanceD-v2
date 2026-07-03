import { describe, it, expect, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import MongoStorageRepository from '../../src/infrastructure/persistence/mongo/MongoStorageRepository.js';

function makeCollection(overrides = {}) {
  return {
    findOne: vi.fn(),
    updateOne: vi.fn(),
    find: vi.fn(),
    ...overrides
  };
}

function makeDb(collections) {
  return {
    collection: (name) => collections[name]
  };
}

describe('MongoStorageRepository', () => {
  describe('toObjectId', () => {
    it('converts a valid ObjectId string', () => {
      const repo = new MongoStorageRepository(makeDb({}));
      const idStr = new ObjectId().toString();
      const result = repo.toObjectId(idStr);
      expect(result).toBeInstanceOf(ObjectId);
      expect(result.toString()).toBe(idStr);
    });

    it('passes through an already-an-ObjectId value', () => {
      const repo = new MongoStorageRepository(makeDb({}));
      const oid = new ObjectId();
      const result = repo.toObjectId(oid);
      expect(result).toBe(oid);
    });

    it('passes through an invalid string unchanged', () => {
      const repo = new MongoStorageRepository(makeDb({}));
      const result = repo.toObjectId('not-a-valid-id');
      expect(result).toBe('not-a-valid-id');
    });
  });

  describe('withTransaction', () => {
    it('happy path calls handler and returns its result, ends session', async () => {
      const endSession = vi.fn();
      const session = {
        withTransaction: vi.fn(async (fn) => fn()),
        endSession
      };
      const startSession = vi.fn(() => session);
      const db = { client: { startSession } };
      const repo = new MongoStorageRepository(db);

      const handler = vi.fn(async () => 'handler-result');
      const result = await repo.withTransaction(handler);

      expect(result).toBe('handler-result');
      expect(handler).toHaveBeenCalledWith(session);
      expect(endSession).toHaveBeenCalledTimes(1);
    });

    it('uses db.s.client when db.client is absent', async () => {
      const endSession = vi.fn();
      const session = {
        withTransaction: vi.fn(async (fn) => fn()),
        endSession
      };
      const startSession = vi.fn(() => session);
      const db = { s: { client: { startSession } } };
      const repo = new MongoStorageRepository(db);

      const result = await repo.withTransaction(async () => 42);
      expect(result).toBe(42);
      expect(endSession).toHaveBeenCalledTimes(1);
    });

    it('throws when client has no startSession function', async () => {
      const repo = new MongoStorageRepository({});
      await expect(repo.withTransaction(async () => {})).rejects.toThrow(
        'não suporta transação'
      );
    });

    it('ends session even when handler throws', async () => {
      const endSession = vi.fn();
      const session = {
        withTransaction: vi.fn(async (fn) => fn()),
        endSession
      };
      const startSession = vi.fn(() => session);
      const db = { client: { startSession } };
      const repo = new MongoStorageRepository(db);

      await expect(
        repo.withTransaction(async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      expect(endSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('moveSamplePosition', () => {
    const sampleId = new ObjectId().toString();
    const fromBoxId = new ObjectId().toString();
    const toBoxId = new ObjectId().toString();
    const input = {
      sampleId,
      fromBoxId,
      fromPosition: 'A1',
      toBoxId,
      toPosition: 'B2'
    };

    it('happy path performs all 3 updates', async () => {
      const storageBoxes = makeCollection({
        updateOne: vi
          .fn()
          .mockResolvedValueOnce({ matchedCount: 1 }) // source
          .mockResolvedValueOnce({ matchedCount: 1 }) // target
      });
      const samples = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const db = makeDb({ storageBoxes, amostras: samples });
      const repo = new MongoStorageRepository(db);

      await expect(repo.moveSamplePosition(input, {})).resolves.toBeUndefined();
      expect(storageBoxes.updateOne).toHaveBeenCalledTimes(2);
      expect(samples.updateOne).toHaveBeenCalledTimes(1);
    });

    it('throws "Origem inconsistente" when source update matchedCount is 0', async () => {
      const storageBoxes = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 0 })
      });
      const samples = makeCollection();
      const db = makeDb({ storageBoxes, amostras: samples });
      const repo = new MongoStorageRepository(db);

      await expect(repo.moveSamplePosition(input, {})).rejects.toThrow(
        'Origem inconsistente'
      );
      expect(samples.updateOne).not.toHaveBeenCalled();
    });

    it('throws "STORAGE_COLLISION" when target update matchedCount is 0', async () => {
      const storageBoxes = makeCollection({
        updateOne: vi
          .fn()
          .mockResolvedValueOnce({ matchedCount: 1 })
          .mockResolvedValueOnce({ matchedCount: 0 })
      });
      const samples = makeCollection();
      const db = makeDb({ storageBoxes, amostras: samples });
      const repo = new MongoStorageRepository(db);

      await expect(repo.moveSamplePosition(input, {})).rejects.toThrow(
        'STORAGE_COLLISION'
      );
      expect(samples.updateOne).not.toHaveBeenCalled();
    });

    it('throws "Falha ao atualizar localização" when sample update matchedCount is 0', async () => {
      const storageBoxes = makeCollection({
        updateOne: vi
          .fn()
          .mockResolvedValueOnce({ matchedCount: 1 })
          .mockResolvedValueOnce({ matchedCount: 1 })
      });
      const samples = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 0 })
      });
      const db = makeDb({ storageBoxes, amostras: samples });
      const repo = new MongoStorageRepository(db);

      await expect(repo.moveSamplePosition(input, {})).rejects.toThrow(
        'Falha ao atualizar localização'
      );
    });
  });

  describe('allocateSamplePosition', () => {
    const sampleId = new ObjectId().toString();
    const boxId = new ObjectId().toString();
    const baseInput = { sampleId, boxId, position: 'A1' };
    const boxDoc = { _id: new ObjectId(boxId), dimension: { rows: 4, cols: 4 } };

    it('happy path allocates the position', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(boxDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).resolves.toBeUndefined();
      expect(storageBoxes.updateOne).toHaveBeenCalledTimes(1);
      expect(samples.updateOne).toHaveBeenCalledTimes(1);
      const setPayload = samples.updateOne.mock.calls[0][1].$set;
      expect(setPayload.status).toBe('AVAILABLE');
      expect(setPayload['storageLocation.position']).toBe('A1');
    });

    it('throws when sample not found', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const storageBoxes = makeCollection();
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).rejects.toThrow(
        'Amostra não encontrada'
      );
    });

    it('throws when sample already allocated', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: sampleId,
          storageLocation: { boxId: new ObjectId(), position: 'C3' }
        })
      });
      const storageBoxes = makeCollection();
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).rejects.toThrow(
        'já está alocada'
      );
    });

    it('throws when box not found', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }) });
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).rejects.toThrow(
        'Caixa de armazenamento não encontrada'
      );
    });

    it('throws when position format is invalid', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }) });
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(boxDoc) });
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(
        repo.allocateSamplePosition({ ...baseInput, position: '11A' }, {})
      ).rejects.toThrow('Posição inválida');
    });

    it('throws when position is out of bounds', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }) });
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(boxDoc) });
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(
        repo.allocateSamplePosition({ ...baseInput, position: 'Z9' }, {})
      ).rejects.toThrow('fora dos limites');
    });

    it('throws "STORAGE_COLLISION" when box update matchedCount is 0', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }) });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(boxDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 0 })
      });
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).rejects.toThrow(
        'STORAGE_COLLISION'
      );
    });
  });

  describe('releaseSamplePosition', () => {
    const sampleId = new ObjectId().toString();
    const boxId = new ObjectId();

    it('happy path returns from/barcode/quantity/unit, defaulting unit to µL', async () => {
      const sampleDoc = {
        _id: sampleId,
        barcode: 'BC-1',
        quantity: 10,
        unit: null,
        storageLocation: { boxId, position: 'a1' }
      };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(sampleDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.releaseSamplePosition({ sampleId }, {});
      expect(result).toEqual({
        from: { boxId: String(boxId), position: 'A1' },
        barcode: 'BC-1',
        quantity: 10,
        unit: 'µL'
      });
    });

    it('preserves an explicit non-falsy unit', async () => {
      const sampleDoc = {
        _id: sampleId,
        barcode: 'BC-2',
        quantity: 5,
        unit: 'mL',
        storageLocation: { boxId, position: 'B2' }
      };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(sampleDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.releaseSamplePosition({ sampleId }, {});
      expect(result.unit).toBe('mL');
    });

    it('throws when sample not found', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const storageBoxes = makeCollection();
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.releaseSamplePosition({ sampleId }, {})).rejects.toThrow(
        'Amostra não encontrada'
      );
    });

    it('throws when sample has no storageLocation', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId })
      });
      const storageBoxes = makeCollection();
      const db = makeDb({ amostras: samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.releaseSamplePosition({ sampleId }, {})).rejects.toThrow(
        'não possui localização'
      );
    });
  });

  describe('validatePositionAvailability', () => {
    const boxId = new ObjectId().toString();

    it('returns BOX_NOT_FOUND when box does not exist', async () => {
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'BOX_NOT_FOUND' })
      );
    });

    it('returns INVALID_POSITION_FORMAT for a malformed position', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          dimension: { rows: 4, cols: 4 },
          occupancyGrid: {}
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: '1A' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'INVALID_POSITION_FORMAT' })
      );
    });

    it('returns POSITION_OUT_OF_BOUNDS_ROW when row exceeds dimension', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          dimension: { rows: 2, cols: 4 },
          occupancyGrid: {}
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'C1' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'POSITION_OUT_OF_BOUNDS_ROW' })
      );
    });

    it('returns POSITION_OUT_OF_BOUNDS_COL when column exceeds dimension', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          dimension: { rows: 4, cols: 2 },
          occupancyGrid: {}
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A5' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'POSITION_OUT_OF_BOUNDS_COL' })
      );
    });

    it('returns STORAGE_COLLISION with occupiedBySampleId when position occupied', async () => {
      const occupantId = new ObjectId();
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          dimension: { rows: 4, cols: 4 },
          occupancyGrid: { A1: occupantId }
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result).toEqual(
        expect.objectContaining({
          available: false,
          error: 'STORAGE_COLLISION',
          occupiedBySampleId: String(occupantId)
        })
      );
    });

    it('happy path returns available:true with computed capacity/availablePositions', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          name: 'Box 1',
          dimension: { rows: 4, cols: 4 },
          currentOccupancy: 3,
          occupancyGrid: {}
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result.available).toBe(true);
      expect(result.boxData.capacity).toBe(16);
      expect(result.boxData.availablePositions).toBe(13);
      expect(result.boxData.currentOccupancy).toBe(3);
    });
  });

  describe('getBoxAvailablePositions', () => {
    const boxId = new ObjectId().toString();

    it('returns null when box not found', async () => {
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getBoxAvailablePositions({ boxId });
      expect(result).toBeNull();
    });

    it('happy path computes positions/available/occupied/stats for a 2x2 grid with 1 occupied', async () => {
      const occupantId = new ObjectId();
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          name: 'Box 2x2',
          dimension: { rows: 2, cols: 2 },
          currentOccupancy: 1,
          occupancyGrid: { A1: occupantId }
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getBoxAvailablePositions({ boxId });
      expect(result.availablePositions.sort()).toEqual(['A2', 'B1', 'B2'].sort());
      expect(result.occupiedPositions).toEqual(['A1']);
      expect(result.stats).toEqual({
        capacity: 4,
        occupied: 1,
        available: 3,
        occupancyPercent: 25
      });
    });

    it('slices occupiedPositions to 10 entries', async () => {
      const occupancyGrid = {};
      // 3 rows x 5 cols = 15 positions, occupy all of them
      for (let row = 0; row < 3; row += 1) {
        const letter = String.fromCharCode(65 + row);
        for (let col = 1; col <= 5; col += 1) {
          occupancyGrid[`${letter}${col}`] = new ObjectId();
        }
      }
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          name: 'Big box',
          dimension: { rows: 3, cols: 5 },
          currentOccupancy: 15,
          occupancyGrid
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getBoxAvailablePositions({ boxId });
      expect(result.availablePositions).toEqual([]);
      expect(result.occupiedPositions).toHaveLength(10);
      expect(result.stats.occupancyPercent).toBe(100);
    });
  });

  describe('getSampleStorageLocation', () => {
    const sampleId = new ObjectId().toString();

    it('returns found:false SAMPLE_NOT_FOUND when sample missing', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const storagePaths = makeCollection();
      const db = makeDb({ amostras: samples, storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getSampleStorageLocation({ sampleId });
      expect(result).toEqual({ found: false, error: 'SAMPLE_NOT_FOUND' });
    });

    it('returns found:false with message when sample has no storageLocation.boxId', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId })
      });
      const storagePaths = makeCollection();
      const db = makeDb({ amostras: samples, storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getSampleStorageLocation({ sampleId });
      expect(result.found).toBe(false);
      expect(result.message).toMatch(/sem localização/);
    });

    it('happy path with matching storagePath populates fullHierarchy', async () => {
      const boxId = new ObjectId();
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: sampleId,
          barcode: 'BC-3',
          storageLocation: { boxId, position: 'A1' }
        })
      });
      const storagePaths = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          path: 'Freezer1/Shelf1/Rack1/Box1',
          freezerId: 'F1',
          shelfId: 'S1',
          rackId: 'R1',
          boxId
        })
      });
      const db = makeDb({ amostras: samples, storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getSampleStorageLocation({ sampleId });
      expect(result.found).toBe(true);
      expect(result.location.path).toBe('Freezer1/Shelf1/Rack1/Box1');
      expect(result.location.fullHierarchy).toEqual({
        freezerId: 'F1',
        shelfId: 'S1',
        rackId: 'R1',
        boxId
      });
    });

    it('happy path with no matching storagePath returns path N/A and null fullHierarchy', async () => {
      const boxId = new ObjectId();
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: sampleId,
          barcode: 'BC-4',
          storageLocation: { boxId, position: 'B2' }
        })
      });
      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ amostras: samples, storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getSampleStorageLocation({ sampleId });
      expect(result.found).toBe(true);
      expect(result.location.path).toBe('N/A');
      expect(result.location.fullHierarchy).toBeNull();
    });
  });

  describe('searchAllocatableSampleCandidates', () => {
    it('returns [] without hitting the db when query is shorter than 2 chars', async () => {
      const samples = makeCollection();
      const db = makeDb({ amostras: samples });
      const repo = new MongoStorageRepository(db);

      const result = await repo.searchAllocatableSampleCandidates({ query: 'a' });
      expect(result).toEqual([]);
      expect(samples.find).not.toHaveBeenCalled();
    });

    it('returns [] for an empty/missing query', async () => {
      const samples = makeCollection();
      const db = makeDb({ amostras: samples });
      const repo = new MongoStorageRepository(db);

      const result = await repo.searchAllocatableSampleCandidates({ query: '' });
      expect(result).toEqual([]);
      expect(samples.find).not.toHaveBeenCalled();
    });

    it('happy path builds the expected filter shape and chains limit(20)', async () => {
      const toArray = vi.fn().mockResolvedValueOnce([{ barcode: 'BC-9' }]);
      const limit = vi.fn(() => ({ toArray }));
      const find = vi.fn(() => ({ limit }));
      const samples = makeCollection({ find });
      const db = makeDb({ amostras: samples });
      const repo = new MongoStorageRepository(db);

      const result = await repo.searchAllocatableSampleCandidates({ query: 'BC-9' });

      expect(result).toEqual([{ barcode: 'BC-9' }]);
      expect(find).toHaveBeenCalledTimes(1);
      const filter = find.mock.calls[0][0];
      expect(filter.$and).toHaveLength(3);
      expect(filter.$and[0].$or).toEqual([
        { barcode: expect.any(RegExp) },
        { patientID: expect.any(RegExp) },
        { sampleID: expect.any(RegExp) }
      ]);
      expect(filter.$and[1]).toEqual({
        currentStatus: { $in: ['Available', 'Registered', 'pending'] }
      });
      expect(filter.$and[2].$or).toEqual([
        { 'storageLocation.boxId': { $exists: false } },
        { 'storageLocation.boxId': null }
      ]);
      expect(limit).toHaveBeenCalledWith(20);
    });
  });
});
