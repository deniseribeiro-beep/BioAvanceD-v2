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

  it('returns STORAGE_COLLISION when position is occupied (plain-object occupancyGrid)', async () => {
    // Fixed in issue #23: the source used to call `box.occupancyGrid?.get(position)`
    // directly (Map API only), instead of the polymorphic `_isPositionOccupied`
    // helper used elsewhere in this file, so a plain-object occupancyGrid threw a
    // TypeError that was swallowed as INTERNAL_ERROR instead of detecting the collision.
    const occupyingSampleId = new ObjectId();
    findOne.mockResolvedValue({
      dimension: { rows: 9, cols: 9 },
      occupancyGrid: { A1: occupyingSampleId }, // plain object, not a Map
      currentOccupancy: 1
    });
    const result = await service.validatePositionAvailability(new ObjectId().toString(), 'A1');
    expect(result.available).toBe(false);
    expect(result.error).toBe('STORAGE_COLLISION');
    expect(result.occupiedBySampleId).toBe(occupyingSampleId);
  });

  it('returns INTERNAL_ERROR when the box lookup throws', async () => {
    findOne.mockRejectedValue(new Error('db down'));
    const result = await service.validatePositionAvailability(new ObjectId().toString(), 'A1');
    expect(result.available).toBe(false);
    expect(result.error).toBe('INTERNAL_ERROR');
    expect(result.message).toMatch(/db down/);
  });

  it('falls back to the raw boxId when ObjectId.isValid throws while converting it', async () => {
    const isValidSpy = vi.spyOn(ObjectId, 'isValid').mockImplementationOnce(() => {
      throw new Error('isValid boom');
    });
    findOne.mockResolvedValue(null); // BOX_NOT_FOUND is fine, we only care boxObjId conversion didn't throw uncaught
    const result = await service.validatePositionAvailability('some-box-id', 'A1');
    expect(result.available).toBe(false);
    expect(result.error).toBe('BOX_NOT_FOUND');
    isValidSpy.mockRestore();
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

  it('falls back to the raw boxId when ObjectId.isValid throws while converting it', async () => {
    const isValidSpy = vi.spyOn(ObjectId, 'isValid').mockImplementationOnce(() => {
      throw new Error('isValid boom');
    });
    boxesFindOne.mockResolvedValue(null);
    const result = await service.verifyBoxIntegrity('some-box-id');
    expect(result).toEqual({ valid: false, error: 'BOX_NOT_FOUND' });
    isValidSpy.mockRestore();
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

  it('falls back to the raw freezerId when ObjectId.isValid throws while converting it', async () => {
    const isValidSpy = vi.spyOn(ObjectId, 'isValid').mockImplementationOnce(() => {
      throw new Error('isValid boom');
    });
    containersFindOne.mockResolvedValue(null);
    const result = await service.getFreezerOccupancyStats('some-freezer-id');
    expect(result).toEqual({ stats: null, error: 'FREEZER_NOT_FOUND' });
    isValidSpy.mockRestore();
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

  it('falls back to the raw boxId when ObjectId.isValid throws while converting it', async () => {
    const isValidSpy = vi.spyOn(ObjectId, 'isValid').mockImplementationOnce(() => {
      throw new Error('isValid boom');
    });
    findOne.mockResolvedValue(null);
    const result = await service.findAvailablePosition('some-box-id');
    expect(result.found).toBe(false);
    expect(result.error).toBe('BOX_NOT_FOUND');
    isValidSpy.mockRestore();
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

  it('falls back to the raw storageLocation.boxId when `new ObjectId()` throws on an unparseable value', async () => {
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      barcode: 'BC-2',
      storageLocation: { boxId: 'not-a-valid-object-id', position: 'A1' }
    });
    pathsFindOne.mockResolvedValue(null);

    const result = await service.getSampleStorage(new ObjectId().toString());
    expect(result.found).toBe(true);
    expect(pathsFindOne).toHaveBeenCalledWith({ boxId: 'not-a-valid-object-id' });
    expect(result.location.path).toBe('N/A');
  });
});

// ---------------------------------------------------------------------------
// Helpers shared by the DB-write-path tests below (allocate/autoAssign/release)
// ---------------------------------------------------------------------------

function makeMovementsCollection() {
  const chain = {
    sort: vi.fn(function sort() { return chain; }),
    limit: vi.fn(function limit() { return chain; }),
    next: vi.fn().mockResolvedValue(null),
    toArray: vi.fn().mockResolvedValue([])
  };
  return {
    find: vi.fn(() => chain),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    createIndex: vi.fn().mockResolvedValue(true)
  };
}

function makeCountersCollection() {
  return {
    findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 1 } })
  };
}

function makeSession() {
  return {
    withTransaction: vi.fn(async (fn) => { await fn(); }),
    endSession: vi.fn().mockResolvedValue(undefined)
  };
}

describe('StorageService.allocateSampleToPosition', () => {
  let boxesFindOne;
  let boxesUpdateOne;
  let samplesFindOne;
  let samplesUpdateOne;
  let movements;
  let db;
  let service;

  beforeEach(() => {
    boxesFindOne = vi.fn();
    boxesUpdateOne = vi.fn().mockResolvedValue({});
    samplesFindOne = vi.fn();
    samplesUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    movements = makeMovementsCollection();

    db = makeDb({
      collection: vi.fn((name) => {
        if (name === 'storageBoxes') return { findOne: boxesFindOne, updateOne: boxesUpdateOne };
        if (name === 'samples') return { findOne: samplesFindOne, updateOne: samplesUpdateOne };
        if (name === 'sample_movements') return movements;
        if (name === 'counters') return makeCountersCollection();
        if (name === 'storageAssignments') return { insertOne: vi.fn().mockResolvedValue({}) };
        if (name === 'storagePaths') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected collection: ${name}`);
      }),
      getMongo: vi.fn(() => ({ startSession: vi.fn(() => makeSession()) }))
    });
    service = new StorageService(db);
  });

  it('happy path: allocates the sample and writes storageLocation/status fields', async () => {
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();

    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(boxId),
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map(),
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(sampleId),
      barcode: 'BC-1',
      quantity: 5,
      unit: 'mL',
      storageLocation: null
    });

    const result = await service.allocateSampleToPosition(sampleId, boxId, 'A1');

    expect(result.success).toBe(true);
    expect(result.sampleLocation).toEqual({ specimenId: sampleId, boxId, position: 'A1' });

    // Box occupancyGrid gets the sample written at the position, sample gets storageLocation+status
    const boxUpdateCall = boxesUpdateOne.mock.calls[0];
    expect(boxUpdateCall[1].$set[`occupancyGrid.A1`]).toBeInstanceOf(ObjectId);

    const sampleUpdateCall = samplesUpdateOne.mock.calls[0];
    expect(sampleUpdateCall[1].$set['storageLocation.position']).toBe('A1');
    expect(sampleUpdateCall[1].$set['status']).toBe('AVAILABLE');
  });

  it('issue #23: increments currentOccupancy via a top-level $inc, not nested inside $set', async () => {
    // The box update used to write `$set: { currentOccupancy: { $inc: 1 } }`, which
    // is not a valid Mongo update shape ($inc must be a sibling top-level operator),
    // so currentOccupancy was never actually incremented.
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();

    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(boxId),
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map(),
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(sampleId),
      barcode: 'BC-1',
      quantity: 5,
      unit: 'mL',
      storageLocation: null
    });

    await service.allocateSampleToPosition(sampleId, boxId, 'A1');

    const boxUpdateCall = boxesUpdateOne.mock.calls[0];
    expect(boxUpdateCall[1].$set.currentOccupancy).toBeUndefined();
    expect(boxUpdateCall[1].$inc).toEqual({ currentOccupancy: 1 });
  });

  it('rejects allocation to an already-occupied position with a STORAGE_COLLISION error', async () => {
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();
    const occupyingSampleId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(boxId),
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map([['A1', occupyingSampleId]]),
      currentOccupancy: 1
    });

    const result = await service.allocateSampleToPosition(sampleId, boxId, 'A1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('STORAGE_COLLISION');
    // The sample document is never even looked up because validation fails first.
    expect(samplesFindOne).not.toHaveBeenCalled();
  });

  it('returns BOX_NOT_FOUND (surfaced via validation) when the box does not exist', async () => {
    boxesFindOne.mockResolvedValue(null);
    const result = await service.allocateSampleToPosition(
      new ObjectId().toString(),
      new ObjectId().toString(),
      'A1'
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('BOX_NOT_FOUND');
  });

  it('returns a generic ALLOCATION_ERROR when the sample does not exist', async () => {
    const boxId = new ObjectId().toString();
    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(boxId),
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map(),
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue(null);

    const sampleId = new ObjectId().toString();
    const result = await service.allocateSampleToPosition(sampleId, boxId, 'A1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('ALLOCATION_ERROR');
    expect(result.message).toMatch(/não encontrada/);
  });

  it('rejects when the sample is already allocated elsewhere', async () => {
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();

    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(boxId),
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map(),
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(sampleId),
      storageLocation: { boxId: new ObjectId().toString(), position: 'B2' }
    });

    const result = await service.allocateSampleToPosition(sampleId, boxId, 'A1');

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/já está alocada/);
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('#69: STORAGE_COLLISION guard fires on a real driver-shaped collision result (matchedCount: 0)', async () => {
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();

    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(boxId),
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map(),
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(sampleId),
      barcode: 'BC-1',
      quantity: 5,
      unit: 'mL',
      storageLocation: null
    });
    // Real MongoDB driver reports collisions via `matchedCount: 0`.
    boxesUpdateOne.mockResolvedValue({ matchedCount: 0 });

    const result = await service.allocateSampleToPosition(sampleId, boxId, 'A1');

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/STORAGE_COLLISION/);
  });

  it('returns ALLOCATION_ERROR when the sample update reports modifiedCount 0', async () => {
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();

    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(boxId),
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map(),
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(sampleId),
      barcode: 'BC-1',
      quantity: 5,
      unit: 'mL',
      storageLocation: null
    });
    samplesUpdateOne.mockResolvedValue({ modifiedCount: 0 });

    const result = await service.allocateSampleToPosition(sampleId, boxId, 'A1');

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Falha ao atualizar amostra/);
  });

  it('falls back to the raw specimenId/boxId when ObjectId.isValid throws while converting them', async () => {
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();

    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(boxId),
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: new Map(),
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(sampleId),
      barcode: 'BC-1',
      quantity: 5,
      unit: 'mL',
      storageLocation: null
    });

    const realIsValid = ObjectId.isValid.bind(ObjectId);
    const isValidSpy = vi.spyOn(ObjectId, 'isValid').mockImplementation((value) => {
      if (value === sampleId || value === boxId) {
        throw new Error('isValid boom');
      }
      return realIsValid(value);
    });

    const result = await service.allocateSampleToPosition(sampleId, boxId, 'A1');

    expect(result.success).toBe(true);
    isValidSpy.mockRestore();
  });
});

describe('StorageService.autoAssignSampleToBox', () => {
  let boxesFindOne;
  let boxesUpdateOne;
  let samplesFindOne;
  let samplesUpdateOne;
  let movements;
  let db;
  let service;

  beforeEach(() => {
    boxesFindOne = vi.fn();
    boxesUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    samplesFindOne = vi.fn();
    samplesUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    movements = makeMovementsCollection();

    db = makeDb({
      collection: vi.fn((name) => {
        if (name === 'storageBoxes') return { findOne: boxesFindOne, updateOne: boxesUpdateOne };
        if (name === 'samples') return { findOne: samplesFindOne, updateOne: samplesUpdateOne };
        if (name === 'sample_movements') return movements;
        throw new Error(`unexpected collection: ${name}`);
      }),
      getMongo: vi.fn(() => ({ startSession: vi.fn(() => makeSession()) }))
    });
    service = new StorageService(db);
  });

  it('happy path: finds the first free position and allocates the specimen there (no neo4j configured)', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: { A1: new ObjectId() }, // A1 occupied, A2 free
      currentOccupancy: 1
    });
    samplesFindOne.mockResolvedValue({
      _id: specimenId,
      barcode: 'BC-9',
      storageLocation: null
    });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result.success).toBe(true);
    expect(result.sampleLocation.position).toBe('A2');
    expect(result.graphPersisted).toBe(false);

    const boxUpdateCall = boxesUpdateOne.mock.calls[0];
    expect(boxUpdateCall[0][`occupancyGrid.A2`]).toEqual({ $exists: false });

    const sampleUpdateCall = samplesUpdateOne.mock.calls[0];
    expect(sampleUpdateCall[1].$set['storageLocation.position']).toBe('A2');
    expect(sampleUpdateCall[1].$set['status']).toBe('AVAILABLE');
  });

  it('#479: reports the transaction-committed position, not the stale pre-transaction scan, when they diverge', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    // Pre-transaction scan sees only A1 occupied -> would pick A2.
    boxesFindOne.mockResolvedValueOnce({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 3 },
      occupancyGrid: { A1: new ObjectId() },
      currentOccupancy: 1
    });
    // In-transaction re-scan finds A2 has since been taken by a concurrent
    // write -> the actually committed position is A3.
    boxesFindOne.mockResolvedValueOnce({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 3 },
      occupancyGrid: { A1: new ObjectId(), A2: new ObjectId() },
      currentOccupancy: 2
    });
    samplesFindOne.mockResolvedValue({
      _id: specimenId,
      barcode: 'BC-9',
      storageLocation: null
    });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result.success).toBe(true);
    expect(result.sampleLocation.position).toBe('A3');
  });

  it('returns BOX_FULL when the box has no available position', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: { A1: new ObjectId() },
      currentOccupancy: 1
    });
    samplesFindOne.mockResolvedValue({
      _id: specimenId,
      storageLocation: null
    });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result.success).toBe(false);
    expect(result.error).toBe('BOX_FULL');
    // Never reaches the write phase.
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('returns BOX_NOT_FOUND when the target box does not exist', async () => {
    boxesFindOne.mockResolvedValue(null);
    const result = await service.autoAssignSampleToBox(
      new ObjectId().toString(),
      new ObjectId().toString()
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('BOX_NOT_FOUND');
  });

  it('returns SAMPLE_NOT_FOUND when the specimen does not exist', async () => {
    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue(null);

    const result = await service.autoAssignSampleToBox(new ObjectId().toString(), new ObjectId().toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('SAMPLE_NOT_FOUND');
  });

  it('returns ALREADY_ALLOCATED on the pre-transaction check when the sample already has a storageLocation', async () => {
    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      storageLocation: { boxId: new ObjectId().toString(), position: 'A1' }
    });

    const result = await service.autoAssignSampleToBox(new ObjectId().toString(), new ObjectId().toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('ALREADY_ALLOCATED');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('re-checks inside the transaction and returns ALREADY_ALLOCATED if a concurrent write allocated the sample first', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    // Pre-check: not yet allocated. In-transaction fresh read: now allocated (race).
    samplesFindOne
      .mockResolvedValueOnce({ _id: specimenId, storageLocation: null })
      .mockResolvedValueOnce({
        _id: specimenId,
        storageLocation: { boxId: boxId.toString(), position: 'A1' }
      });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('ALREADY_ALLOCATED');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('re-checks inside the transaction and returns BOX_FULL if a concurrent write filled the box first', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    // Pre-check snapshot: one free slot. In-transaction fresh read: now full (race).
    boxesFindOne
      .mockResolvedValueOnce({
        _id: boxId,
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: {},
        currentOccupancy: 0
      })
      .mockResolvedValueOnce({
        _id: boxId,
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: { A1: new ObjectId() },
        currentOccupancy: 1
      });
    samplesFindOne.mockResolvedValue({ _id: specimenId, storageLocation: null });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('BOX_FULL');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('returns STORAGE_COLLISION when the atomic box update reports no matched document (real collision)', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({ _id: specimenId, storageLocation: null });
    boxesUpdateOne.mockResolvedValue({ matchedCount: 0 });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('AUTO_ASSIGNMENT_ERROR');
    expect(result.message).toMatch(/Colisão detectada/);
  });

  it('returns AUTO_ASSIGNMENT_ERROR when the sample update fails to match after allocation', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({ _id: specimenId, storageLocation: null });
    samplesUpdateOne.mockResolvedValue({ matchedCount: 0 });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('AUTO_ASSIGNMENT_ERROR');
    expect(result.message).toMatch(/Falha ao atualizar/);
  });

  it('re-checks inside the transaction and returns BOX_NOT_FOUND if the box was deleted concurrently', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne
      .mockResolvedValueOnce({
        _id: boxId,
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: {},
        currentOccupancy: 0
      })
      .mockResolvedValueOnce(null); // in-transaction fresh read: box gone
    samplesFindOne.mockResolvedValue({ _id: specimenId, storageLocation: null });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('BOX_NOT_FOUND');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('re-checks inside the transaction and returns SAMPLE_NOT_FOUND if the specimen was deleted concurrently', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne
      .mockResolvedValueOnce({ _id: specimenId, storageLocation: null })
      .mockResolvedValueOnce(null); // in-transaction fresh read: sample gone

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('SAMPLE_NOT_FOUND');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('persists to Neo4j and reports graphPersisted:true when a driver is configured', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();
    const runMock = vi.fn().mockResolvedValue({});
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const neo4jSessionMock = vi.fn(() => ({ run: runMock, close: closeMock }));
    const neo4jDriver = { session: neo4jSessionMock };

    service = new StorageService(db, neo4jDriver);

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({ _id: specimenId, barcode: 'BC-9', storageLocation: null });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result.success).toBe(true);
    expect(result.graphPersisted).toBe(true);
    expect(neo4jSessionMock).toHaveBeenCalled();
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock.mock.calls[0][1]).toMatchObject({
      specimenId: specimenId.toString(),
      boxId: boxId.toString(),
      coordinate: 'A1'
    });
    expect(closeMock).toHaveBeenCalled();
  });

  it('rolls back the Mongo allocation when the Neo4j sync fails, and surfaces the Neo4j error', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();
    const neo4jError = new Error('neo4j unreachable');
    const runMock = vi.fn().mockRejectedValue(neo4jError);
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const neo4jDriver = { session: vi.fn(() => ({ run: runMock, close: closeMock })) };

    const rollbackBoxUpdate = vi.fn().mockResolvedValue({});
    const rollbackSampleUpdate = vi.fn().mockResolvedValue({});
    // Second startSession() call (rollback) needs its own session object.
    const rollbackSession = makeSession();
    let sessionCallCount = 0;
    db.getMongo = vi.fn(() => ({
      startSession: vi.fn(() => {
        sessionCallCount += 1;
        return sessionCallCount === 1 ? makeSession() : rollbackSession;
      })
    }));
    // Route updateOne calls made during rollback to dedicated spies while keeping
    // the original allocation-phase updateOne behavior for the first calls.
    boxesUpdateOne.mockImplementation((...args) => {
      if (args[1]?.$unset) return rollbackBoxUpdate(...args);
      return Promise.resolve({ matchedCount: 1 });
    });
    samplesUpdateOne.mockImplementation((...args) => {
      if (args[1]?.$unset) return rollbackSampleUpdate(...args);
      return Promise.resolve({ matchedCount: 1 });
    });

    service = new StorageService(db, neo4jDriver);

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({ _id: specimenId, barcode: 'BC-9', storageLocation: null });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result.success).toBe(false);
    expect(result.error).toBe('AUTO_ASSIGNMENT_ERROR');
    expect(result.message).toBe('neo4j unreachable');
    expect(rollbackBoxUpdate).toHaveBeenCalledTimes(1);
    expect(rollbackSampleUpdate).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalled();
  });
});

describe('StorageService.releaseSampleFromPosition', () => {
  let samplesFindOne;
  let samplesUpdateOne;
  let boxesUpdateOne;
  let movements;
  let db;
  let service;

  beforeEach(() => {
    samplesFindOne = vi.fn();
    samplesUpdateOne = vi.fn().mockResolvedValue({});
    boxesUpdateOne = vi.fn().mockResolvedValue({});
    movements = makeMovementsCollection();

    db = makeDb({
      collection: vi.fn((name) => {
        if (name === 'samples') return { findOne: samplesFindOne, updateOne: samplesUpdateOne };
        if (name === 'storageBoxes') return { updateOne: boxesUpdateOne };
        if (name === 'sample_movements') return movements;
        if (name === 'counters') return makeCountersCollection();
        if (name === 'storageAssignments') return { updateOne: vi.fn().mockResolvedValue({}) };
        throw new Error(`unexpected collection: ${name}`);
      })
    });
    service = new StorageService(db);
  });

  it('happy path: clears the box occupancy entry and the sample storageLocation', async () => {
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();

    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(sampleId),
      barcode: 'BC-5',
      quantity: 2,
      unit: 'mL',
      storageLocation: { boxId, position: 'C3' }
    });

    const result = await service.releaseSampleFromPosition(sampleId);

    expect(result.success).toBe(true);
    expect(result.releasedFrom).toEqual({ specimenId: sampleId, boxId, position: 'C3' });

    const boxUpdateCall = boxesUpdateOne.mock.calls[0];
    expect(boxUpdateCall[1].$unset[`occupancyGrid.C3`]).toBe('');

    const sampleUpdateCall = samplesUpdateOne.mock.calls[0];
    expect(sampleUpdateCall[1].$unset).toHaveProperty('storageLocation');
  });

  it('returns NO_STORAGE_LOCATION when the sample is not currently allocated anywhere', async () => {
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      storageLocation: null
    });

    const result = await service.releaseSampleFromPosition(new ObjectId().toString());

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_STORAGE_LOCATION');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('returns SAMPLE_NOT_FOUND when the sample does not exist', async () => {
    samplesFindOne.mockResolvedValue(null);
    const result = await service.releaseSampleFromPosition(new ObjectId().toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('SAMPLE_NOT_FOUND');
  });

  it('returns RELEASE_ERROR when the box update rejects', async () => {
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      storageLocation: { boxId: new ObjectId().toString(), position: 'A1' }
    });
    boxesUpdateOne.mockRejectedValue(new Error('db down'));

    const result = await service.releaseSampleFromPosition(new ObjectId().toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('RELEASE_ERROR');
    expect(result.message).toBe('db down');
  });

  it('falls back to the raw specimenId when ObjectId.isValid throws while converting it', async () => {
    const isValidSpy = vi.spyOn(ObjectId, 'isValid').mockImplementationOnce(() => {
      throw new Error('isValid boom');
    });
    samplesFindOne.mockResolvedValue(null);

    const result = await service.releaseSampleFromPosition('some-specimen-id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('SAMPLE_NOT_FOUND');
    isValidSpy.mockRestore();
  });

  it('falls back to the raw storageLocation.boxId when `new ObjectId()` throws on an unparseable value', async () => {
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      barcode: 'BC-7',
      quantity: 1,
      storageLocation: { boxId: 'not-a-valid-object-id', position: 'A1' }
    });

    const result = await service.releaseSampleFromPosition(new ObjectId().toString());
    expect(result.success).toBe(true);
    expect(boxesUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'not-a-valid-object-id' }),
      expect.anything(),
      expect.anything()
    );
  });
});

describe('StorageService error-handling branches (generic catch clauses)', () => {
  it('findAvailablePosition returns SEARCH_ERROR when the query throws', async () => {
    const db = makeDb({
      collection: vi.fn(() => ({ findOne: vi.fn().mockRejectedValue(new Error('boom')) }))
    });
    const service = new StorageService(db);
    const result = await service.findAvailablePosition(new ObjectId().toString());
    expect(result.found).toBe(false);
    expect(result.error).toBe('SEARCH_ERROR');
    expect(result.message).toBe('boom');
  });

  it('getSampleStorage returns QUERY_ERROR when the query throws', async () => {
    const db = makeDb({
      collection: vi.fn(() => ({ findOne: vi.fn().mockRejectedValue(new Error('boom')) }))
    });
    const service = new StorageService(db);
    const result = await service.getSampleStorage(new ObjectId().toString());
    expect(result.found).toBe(false);
    expect(result.error).toBe('QUERY_ERROR');
    expect(result.message).toBe('boom');
  });

  it('verifyBoxIntegrity returns INTEGRITY_CHECK_ERROR when the query throws', async () => {
    const db = makeDb({
      collection: vi.fn(() => ({ findOne: vi.fn().mockRejectedValue(new Error('boom')) }))
    });
    const service = new StorageService(db);
    const result = await service.verifyBoxIntegrity(new ObjectId().toString());
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INTEGRITY_CHECK_ERROR');
    expect(result.message).toBe('boom');
  });

  it('getFreezerOccupancyStats returns STATS_ERROR when the aggregation throws', async () => {
    const db = makeDb({
      collection: vi.fn((name) => {
        if (name === 'storageContainers') {
          return { findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), containerType: 'FREEZER' }) };
        }
        if (name === 'storageBoxes') {
          return { aggregate: () => ({ toArray: vi.fn().mockRejectedValue(new Error('boom')) }) };
        }
        throw new Error(`unexpected collection: ${name}`);
      })
    });
    const service = new StorageService(db);
    const result = await service.getFreezerOccupancyStats(new ObjectId().toString());
    expect(result.stats).toBeNull();
    expect(result.error).toBe('STATS_ERROR');
    expect(result.message).toBe('boom');
  });
});
