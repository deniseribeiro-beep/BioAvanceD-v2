import { describe, it, expect, vi, beforeEach } from 'vitest';
const { ObjectId } = require('mongodb');
const StorageService = require('../../src/services/storageService');

function makeDb(overrides = {}) {
  return {
    // no listCollections -> getCollection() falls back to canonical name directly
    collection: vi.fn(),
    getMongo: vi.fn(),
    ...overrides
  };
}

describe('StorageService - pure/near-pure helpers', () => {
  let service;

  beforeEach(() => {
    service = new StorageService(makeDb());
  });

  describe('_normalizeObjectId', () => {
    it('passes through an existing ObjectId instance unchanged', () => {
      const id = new ObjectId();
      expect(service._normalizeObjectId(id)).toBe(id);
    });

    it('converts a valid ObjectId string into an ObjectId', () => {
      const idStr = new ObjectId().toString();
      const result = service._normalizeObjectId(idStr);
      expect(result).toBeInstanceOf(ObjectId);
      expect(result.toString()).toBe(idStr);
    });

    it('passes through an invalid string unchanged', () => {
      const result = service._normalizeObjectId('not-a-valid-id');
      expect(result).toBe('not-a-valid-id');
    });
  });

  describe('_isPositionOccupied', () => {
    it('returns false for null/undefined grid', () => {
      expect(service._isPositionOccupied(null, 'A1')).toBe(false);
      expect(service._isPositionOccupied(undefined, 'A1')).toBe(false);
    });

    it('Map-based grid: returns true when position has a truthy value', () => {
      const grid = new Map([['A1', new ObjectId()]]);
      expect(service._isPositionOccupied(grid, 'A1')).toBe(true);
    });

    it('Map-based grid: returns false when position key is absent', () => {
      const grid = new Map([['A1', new ObjectId()]]);
      expect(service._isPositionOccupied(grid, 'B2')).toBe(false);
    });

    it('Map-based grid: returns false when key exists but value is falsy', () => {
      const grid = new Map([['A1', null]]);
      expect(service._isPositionOccupied(grid, 'A1')).toBe(false);
    });

    it('plain-object grid: returns true when key has a truthy value', () => {
      const grid = { A1: 'sample123' };
      expect(service._isPositionOccupied(grid, 'A1')).toBe(true);
    });

    it('plain-object grid: returns false when key exists but value is falsy', () => {
      const grid = { A1: null };
      expect(service._isPositionOccupied(grid, 'A1')).toBe(false);
    });

    it('plain-object grid: returns false when key is absent', () => {
      const grid = { A1: 'sample123' };
      expect(service._isPositionOccupied(grid, 'B2')).toBe(false);
    });
  });

  describe('_getAllValidPositions', () => {
    it('generates positions in row-major order for a 2x3 grid', () => {
      const positions = service._getAllValidPositions({ rows: 2, cols: 3 });
      expect(positions).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
    });
  });

  describe('_findFirstAvailablePosition', () => {
    it('returns null when box has 0 rows/cols', () => {
      expect(service._findFirstAvailablePosition({ dimension: { rows: 0, cols: 0 }, occupancyGrid: {} })).toBeNull();
    });

    it('returns null when box has undefined dimension', () => {
      expect(service._findFirstAvailablePosition({})).toBeNull();
    });

    it('returns null when box is fully occupied', () => {
      const box = {
        dimension: { rows: 1, cols: 2 },
        occupancyGrid: { A1: 'x', A2: 'y' }
      };
      expect(service._findFirstAvailablePosition(box)).toBeNull();
    });

    it('returns the correct first-available position in row-major order', () => {
      const box = {
        dimension: { rows: 2, cols: 2 },
        occupancyGrid: { A1: 'x', A2: 'y' } // B1, B2 free
      };
      expect(service._findFirstAvailablePosition(box)).toBe('B1');
    });

    it('works with a Map-based occupancyGrid too', () => {
      const box = {
        dimension: { rows: 1, cols: 2 },
        occupancyGrid: new Map([['A1', 'x']])
      };
      expect(service._findFirstAvailablePosition(box)).toBe('A2');
    });
  });
});

describe('StorageService.validatePositionAvailability', () => {
  let db;
  let findOne;
  let service;

  beforeEach(() => {
    findOne = vi.fn();
    db = makeDb({
      collection: vi.fn(() => ({ findOne }))
    });
    service = new StorageService(db);
  });

  it('returns INVALID_INPUT when boxId is missing', async () => {
    const result = await service.validatePositionAvailability(null, 'A1');
    expect(result).toEqual({
      available: false,
      error: 'INVALID_INPUT',
      message: expect.any(String)
    });
  });

  it('returns INVALID_INPUT when position is missing', async () => {
    const result = await service.validatePositionAvailability(new ObjectId().toString(), null);
    expect(result.available).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('returns BOX_NOT_FOUND when box does not exist', async () => {
    findOne.mockResolvedValue(null);
    const result = await service.validatePositionAvailability(new ObjectId().toString(), 'A1');
    expect(result.available).toBe(false);
    expect(result.error).toBe('BOX_NOT_FOUND');
  });

  it('returns INVALID_POSITION_FORMAT for malformed position', async () => {
    findOne.mockResolvedValue({ dimension: { rows: 9, cols: 9 }, occupancyGrid: new Map() });
    const result = await service.validatePositionAvailability(new ObjectId().toString(), '1A');
    expect(result.available).toBe(false);
    expect(result.error).toBe('INVALID_POSITION_FORMAT');
  });

  it('returns POSITION_OUT_OF_BOUNDS_ROW when row letter exceeds box rows', async () => {
    findOne.mockResolvedValue({ dimension: { rows: 2, cols: 9 }, occupancyGrid: new Map() });
    const result = await service.validatePositionAvailability(new ObjectId().toString(), 'C1');
    expect(result.available).toBe(false);
    expect(result.error).toBe('POSITION_OUT_OF_BOUNDS_ROW');
  });

  it('returns POSITION_OUT_OF_BOUNDS_COL when column exceeds box cols', async () => {
    findOne.mockResolvedValue({ dimension: { rows: 9, cols: 2 }, occupancyGrid: new Map() });
    const result = await service.validatePositionAvailability(new ObjectId().toString(), 'A5');
    expect(result.available).toBe(false);
    expect(result.error).toBe('POSITION_OUT_OF_BOUNDS_COL');
  });

  it('returns STORAGE_COLLISION when position is occupied (Map-based occupancyGrid)', async () => {
    const occupyingSampleId = new ObjectId();
    findOne.mockResolvedValue({
      dimension: { rows: 9, cols: 9 },
      occupancyGrid: new Map([['A1', occupyingSampleId]]),
      currentOccupancy: 1
    });
    const result = await service.validatePositionAvailability(new ObjectId().toString(), 'A1');
    expect(result.available).toBe(false);
    expect(result.error).toBe('STORAGE_COLLISION');
    expect(result.occupiedBySampleId).toBe(occupyingSampleId);
  });

  it('happy path: returns available:true with correct capacity/availablePositions math', async () => {
    findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: 'Box 1',
      dimension: { rows: 3, cols: 3 },
      occupancyGrid: new Map(),
      currentOccupancy: 4
    });
    const result = await service.validatePositionAvailability(new ObjectId().toString(), 'A1');
    expect(result.available).toBe(true);
    expect(result.boxData.capacity).toBe(9);
    expect(result.boxData.availablePositions).toBe(5);
  });

  it('BUG NOTE: plain-object occupancyGrid is NOT checked for collision (source uses .get() unconditionally)', async () => {
    // The source calls `box.occupancyGrid?.get(position)` directly (line ~144), not
    // through the polymorphic `_isPositionOccupied` helper used elsewhere in this file.
    // A plain-object occupancyGrid has no `.get` method, so this line throws a TypeError,
    // which is caught by the outer try/catch and reported as INTERNAL_ERROR instead of
    // correctly detecting (or gracefully ignoring) the collision.
    findOne.mockResolvedValue({
      dimension: { rows: 9, cols: 9 },
      occupancyGrid: { A1: new ObjectId() }, // plain object, not a Map
      currentOccupancy: 1
    });
    const result = await service.validatePositionAvailability(new ObjectId().toString(), 'A1');
    expect(result.available).toBe(false);
    expect(result.error).toBe('INTERNAL_ERROR');
  });
});

describe('StorageService.verifyBoxIntegrity', () => {
  let db;
  let boxesFindOne;
  let samplesFindOne;
  let service;

  beforeEach(() => {
    boxesFindOne = vi.fn();
    samplesFindOne = vi.fn();
    db = makeDb({
      collection: vi.fn((name) => {
        if (name === 'storageBoxes') return { findOne: boxesFindOne };
        if (name === 'samples') return { findOne: samplesFindOne };
        throw new Error(`unexpected collection: ${name}`);
      })
    });
    service = new StorageService(db);
  });

  it('returns BOX_NOT_FOUND when box does not exist', async () => {
    boxesFindOne.mockResolvedValue(null);
    const result = await service.verifyBoxIntegrity(new ObjectId().toString());
    expect(result).toEqual({ valid: false, error: 'BOX_NOT_FOUND' });
  });

  it('pushes an error for an orphaned occupancyGrid entry (sample does not exist)', async () => {
    const boxId = new ObjectId();
    const missingSampleId = new ObjectId();
    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      currentOccupancy: 1,
      occupancyGrid: new Map([['A1', missingSampleId]])
    });
    samplesFindOne.mockResolvedValue(null);

    const result = await service.verifyBoxIntegrity(boxId.toString());
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Orfão/);
  });

  it('pushes an error for an inconsistent sample (points elsewhere)', async () => {
    const boxId = new ObjectId();
    const sampleId = new ObjectId();
    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      currentOccupancy: 1,
      occupancyGrid: new Map([['A1', sampleId]])
    });
    samplesFindOne.mockResolvedValue({
      _id: sampleId,
      storageLocation: { boxId: new ObjectId().toString(), position: 'B2' }
    });

    const result = await service.verifyBoxIntegrity(boxId.toString());
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Inconsistência/);
  });

  it('pushes an error when currentOccupancy count mismatches actual occupancy', async () => {
    const boxId = new ObjectId();
    const sampleId = new ObjectId();
    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      currentOccupancy: 5, // wrong, only 1 actual entry
      occupancyGrid: new Map([['A1', sampleId]])
    });
    samplesFindOne.mockResolvedValue({
      _id: sampleId,
      storageLocation: { boxId: boxId.toString(), position: 'A1' }
    });

    const result = await service.verifyBoxIntegrity(boxId.toString());
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.match(/Contagem incorreta/))).toBe(true);
  });

  it('returns valid:true with no errors for a fully consistent box', async () => {
    const boxId = new ObjectId();
    const sampleId = new ObjectId();
    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      currentOccupancy: 1,
      occupancyGrid: new Map([['A1', sampleId]])
    });
    samplesFindOne.mockResolvedValue({
      _id: sampleId,
      storageLocation: { boxId: boxId.toString(), position: 'A1' }
    });

    const result = await service.verifyBoxIntegrity(boxId.toString());
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });
});

describe('StorageService.getFreezerOccupancyStats', () => {
  let db;
  let containersFindOne;
  let aggregateToArray;
  let service;

  beforeEach(() => {
    containersFindOne = vi.fn();
    aggregateToArray = vi.fn();
    db = makeDb({
      collection: vi.fn((name) => {
        if (name === 'storageContainers') return { findOne: containersFindOne };
        if (name === 'storageBoxes') return { aggregate: () => ({ toArray: aggregateToArray }) };
        throw new Error(`unexpected collection: ${name}`);
      })
    });
    service = new StorageService(db);
  });

  it('returns FREEZER_NOT_FOUND when freezer does not exist', async () => {
    containersFindOne.mockResolvedValue(null);
    const result = await service.getFreezerOccupancyStats(new ObjectId().toString());
    expect(result).toEqual({ stats: null, error: 'FREEZER_NOT_FOUND' });
  });

  it('happy path: computes totalCapacity/totalOccupied/occupancyPercent correctly', async () => {
    const freezerId = new ObjectId();
    containersFindOne.mockResolvedValue({
      _id: freezerId,
      name: 'Freezer A',
      temperature: -80,
      containerType: 'FREEZER'
    });
    aggregateToArray.mockResolvedValue([
      { _id: new ObjectId(), rackName: 'Rack 1', totalCapacity: 100, totalOccupied: 25 },
      { _id: new ObjectId(), rackName: 'Rack 2', totalCapacity: 100, totalOccupied: 50 }
    ]);

    const result = await service.getFreezerOccupancyStats(freezerId.toString());
    expect(result.stats.aggregate.totalCapacity).toBe(200);
    expect(result.stats.aggregate.totalOccupied).toBe(75);
    expect(result.stats.aggregate.totalAvailable).toBe(125);
    expect(result.stats.aggregate.occupancyPercent).toBe(38); // Math.round(75/200*100) = 38
  });
});

describe('StorageService.findAvailablePosition', () => {
  let db;
  let findOne;
  let service;

  beforeEach(() => {
    findOne = vi.fn();
    db = makeDb({
      collection: vi.fn(() => ({ findOne }))
    });
    service = new StorageService(db);
  });

  it('returns BOX_NOT_FOUND when box does not exist', async () => {
    findOne.mockResolvedValue(null);
    const result = await service.findAvailablePosition(new ObjectId().toString());
    expect(result.found).toBe(false);
    expect(result.error).toBe('BOX_NOT_FOUND');
  });

  it('happy path: finds first available position with a Map-based occupancyGrid', async () => {
    findOne.mockResolvedValue({
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: new Map([['A1', new ObjectId()]]),
      currentOccupancy: 1
    });
    const result = await service.findAvailablePosition(new ObjectId().toString());
    expect(result.found).toBe(true);
    expect(result.position).toBe('A2');
    expect(result.availableCount).toBe(1);
  });

  it('returns found:false when box is fully occupied', async () => {
    findOne.mockResolvedValue({
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: new Map([['A1', new ObjectId()]]),
      currentOccupancy: 1
    });
    const result = await service.findAvailablePosition(new ObjectId().toString());
    expect(result.found).toBe(false);
    expect(result.boxStats.available).toBe(0);
  });
});

describe('StorageService.getSampleStorage', () => {
  let db;
  let samplesFindOne;
  let pathsFindOne;
  let service;

  beforeEach(() => {
    samplesFindOne = vi.fn();
    pathsFindOne = vi.fn();
    db = makeDb({
      collection: vi.fn((name) => {
        if (name === 'samples') return { findOne: samplesFindOne };
        if (name === 'storagePaths') return { findOne: pathsFindOne };
        throw new Error(`unexpected collection: ${name}`);
      })
    });
    service = new StorageService(db);
  });

  it('returns SAMPLE_NOT_FOUND when sample does not exist', async () => {
    samplesFindOne.mockResolvedValue(null);
    const result = await service.getSampleStorage(new ObjectId().toString());
    expect(result).toEqual({ found: false, error: 'SAMPLE_NOT_FOUND' });
  });

  it('returns found:false with message when sample has no storageLocation', async () => {
    samplesFindOne.mockResolvedValue({ _id: new ObjectId(), storageLocation: null });
    const result = await service.getSampleStorage(new ObjectId().toString());
    expect(result.found).toBe(false);
    expect(result.message).toMatch(/sem localização/);
  });

  it('happy path: returns full location with path hierarchy', async () => {
    const boxId = new ObjectId();
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      barcode: 'BC-1',
      storageLocation: { boxId: boxId.toString(), position: 'A1' }
    });
    pathsFindOne.mockResolvedValue({
      boxId,
      path: 'Freezer/Shelf/Rack/Box',
      freezerId: 'F1',
      shelfId: 'S1',
      rackId: 'R1'
    });

    const result = await service.getSampleStorage(new ObjectId().toString());
    expect(result.found).toBe(true);
    expect(result.location.box.position).toBe('A1');
    expect(result.location.path).toBe('Freezer/Shelf/Rack/Box');
    expect(result.location.fullHierarchy.freezerId).toBe('F1');
  });
});
