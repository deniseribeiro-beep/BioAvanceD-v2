const { ObjectId } = require('mongodb');
const MongoStorageTopologyReadRepository = require('../../src/infrastructure/persistence/mongo/MongoStorageTopologyReadRepository');

function makeCollection() {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    aggregate: vi.fn()
  };
}

function makeFindChain(result) {
  return {
    sort: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(result)
  };
}

function makeAggregateChain(result) {
  return {
    toArray: vi.fn().mockResolvedValue(result)
  };
}

function makeDb(collections) {
  return {
    collection: vi.fn((name) => collections[name])
  };
}

describe('MongoStorageTopologyReadRepository', () => {
  describe('listOperationalFreezers', () => {
    it('queries storageContainers for operational freezers, sorted by name', async () => {
      const freezers = [{ _id: 'f1', name: 'Freezer A' }];
      const findChain = makeFindChain(freezers);
      const storageContainers = makeCollection();
      storageContainers.find.mockReturnValue(findChain);
      const db = makeDb({ storageContainers });

      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.listOperationalFreezers();

      expect(storageContainers.find).toHaveBeenCalledWith({
        containerType: 'FREEZER',
        status: 'OPERATIONAL'
      });
      expect(findChain.sort).toHaveBeenCalledWith({ name: 1 });
      expect(result).toBe(freezers);
    });
  });

  describe('getFreezerOccupancyStats', () => {
    it('returns FREEZER_NOT_FOUND when the freezer does not exist', async () => {
      const storageContainers = makeCollection();
      storageContainers.findOne.mockResolvedValue(null);
      const storageBoxes = makeCollection();
      const db = makeDb({ storageContainers, storageBoxes });

      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.getFreezerOccupancyStats({ freezerId: new ObjectId().toString() });

      expect(result).toEqual({ stats: null, error: 'FREEZER_NOT_FOUND' });
    });

    it('computes rack occupancy stats and aggregate percent when capacity > 0', async () => {
      const freezerId = new ObjectId();
      const freezer = { _id: freezerId, name: 'Freezer A', temperature: -80 };
      const storageContainers = makeCollection();
      storageContainers.findOne.mockResolvedValue(freezer);

      const rackStats = [
        { _id: 'rack1', rackName: 'Rack 1', totalCapacity: 100, totalOccupied: 25 },
        { _id: 'rack2', rackName: 'Rack 2', totalCapacity: 50, totalOccupied: 25 }
      ];
      const storageBoxes = makeCollection();
      storageBoxes.aggregate.mockReturnValue(makeAggregateChain(rackStats));

      const db = makeDb({ storageContainers, storageBoxes });
      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.getFreezerOccupancyStats({ freezerId: freezerId.toString() });

      expect(result.error).toBeUndefined();
      expect(result.stats.freezerId).toBe(freezerId);
      expect(result.stats.freezerName).toBe('Freezer A');
      expect(result.stats.temperature).toBe(-80);
      expect(result.stats.rackStats).toBe(rackStats);
      expect(result.stats.aggregate).toEqual({
        totalCapacity: 150,
        totalOccupied: 50,
        totalAvailable: 100,
        occupancyPercent: 33
      });
    });

    it('guards against division by zero when total capacity is 0', async () => {
      const freezerId = new ObjectId();
      const storageContainers = makeCollection();
      storageContainers.findOne.mockResolvedValue({ _id: freezerId, name: 'Empty Freezer' });

      const storageBoxes = makeCollection();
      storageBoxes.aggregate.mockReturnValue(makeAggregateChain([]));

      const db = makeDb({ storageContainers, storageBoxes });
      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.getFreezerOccupancyStats({ freezerId: freezerId.toString() });

      expect(result.stats.aggregate).toEqual({
        totalCapacity: 0,
        totalOccupied: 0,
        totalAvailable: 0,
        occupancyPercent: 0
      });
    });
  });

  describe('getFreezerTree', () => {
    it('returns null when the freezer does not exist', async () => {
      const storageContainers = makeCollection();
      storageContainers.findOne.mockResolvedValue(null);
      const storageBoxes = makeCollection();
      const db = makeDb({ storageContainers, storageBoxes });

      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.getFreezerTree({ freezerId: new ObjectId().toString() });

      expect(result).toBeNull();
    });

    it('builds a full freezer -> shelf -> rack -> box tree with stats', async () => {
      const freezerId = new ObjectId();
      const shelfId = new ObjectId();
      const rackId = new ObjectId();

      const freezer = {
        _id: freezerId,
        name: 'Freezer A',
        temperature: -20,
        temperatureUnit: 'C',
        status: 'OPERATIONAL'
      };
      const shelf = { _id: shelfId, name: 'Shelf 1' };
      const rack = { _id: rackId, name: 'Rack 1' };
      const box1 = {
        _id: new ObjectId(),
        name: 'Box 1',
        boxID: 'B1',
        dimension: { rows: 10, cols: 10 },
        currentOccupancy: 25,
        status: 'ACTIVE'
      };
      const box2 = {
        _id: new ObjectId(),
        name: 'Box 2',
        boxID: 'B2',
        dimension: { rows: 0, cols: 0 },
        currentOccupancy: 0,
        status: 'ACTIVE'
      };

      const storageContainers = makeCollection();
      storageContainers.findOne.mockResolvedValue(freezer);
      storageContainers.find.mockImplementation((query) => {
        if (query.containerType === 'SHELF') return makeFindChain([shelf]);
        if (query.containerType === 'RACK') return makeFindChain([rack]);
        return makeFindChain([]);
      });

      const storageBoxes = makeCollection();
      storageBoxes.find.mockReturnValue(makeFindChain([box1, box2]));

      const db = makeDb({ storageContainers, storageBoxes });
      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.getFreezerTree({ freezerId: freezerId.toString() });

      expect(result.freezerId).toBe(freezerId);
      expect(result.freezerName).toBe('Freezer A');
      expect(result.shelves).toHaveLength(1);

      const shelfResult = result.shelves[0];
      expect(shelfResult.shelfId).toBe(shelfId);
      expect(shelfResult.racks).toHaveLength(1);

      const rackResult = shelfResult.racks[0];
      expect(rackResult.rackId).toBe(rackId);
      expect(rackResult.boxes).toHaveLength(2);

      const box1Result = rackResult.boxes.find((b) => b.boxID === 'B1');
      expect(box1Result.stats).toEqual({
        capacity: 100,
        occupied: 25,
        available: 75,
        occupancyPercent: 25
      });

      const box2Result = rackResult.boxes.find((b) => b.boxID === 'B2');
      expect(box2Result.stats).toEqual({
        capacity: 0,
        occupied: 0,
        available: 0,
        occupancyPercent: 0
      });

      expect(rackResult.stats).toEqual({
        boxes: 2,
        totalCapacity: 100,
        totalOccupied: 25
      });

      expect(shelfResult.stats).toEqual({
        racks: 1,
        boxes: 2,
        totalCapacity: 100,
        totalOccupied: 25
      });

      expect(result.aggregateStats).toEqual({
        totalShelves: 1,
        totalRacks: 1,
        totalBoxes: 2,
        totalCapacity: 100,
        totalOccupied: 25,
        totalAvailable: 75,
        occupancyPercent: 25
      });
    });

    it('returns empty tree stats when the freezer has no shelves', async () => {
      const freezerId = new ObjectId();
      const storageContainers = makeCollection();
      storageContainers.findOne.mockResolvedValue({ _id: freezerId, name: 'Empty' });
      storageContainers.find.mockReturnValue(makeFindChain([]));
      const storageBoxes = makeCollection();

      const db = makeDb({ storageContainers, storageBoxes });
      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.getFreezerTree({ freezerId: freezerId.toString() });

      expect(result.shelves).toEqual([]);
      expect(result.aggregateStats).toEqual({
        totalShelves: 0,
        totalRacks: 0,
        totalBoxes: 0,
        totalCapacity: 0,
        totalOccupied: 0,
        totalAvailable: 0,
        occupancyPercent: 0
      });
    });
  });

  describe('checkBoxIntegrity', () => {
    it('returns BOX_NOT_FOUND when the box does not exist', async () => {
      const storageBoxes = makeCollection();
      storageBoxes.findOne.mockResolvedValue(null);
      const samples = makeCollection();
      const db = makeDb({ storageBoxes, samples });

      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.checkBoxIntegrity({ boxId: new ObjectId().toString() });

      expect(result).toEqual({ valid: false, error: 'BOX_NOT_FOUND' });
    });

    it('returns valid=true with no errors when everything is consistent', async () => {
      const boxId = new ObjectId();
      const sampleId = new ObjectId();
      const box = {
        _id: boxId,
        dimension: { rows: 5, cols: 5 },
        currentOccupancy: 1,
        occupancyGrid: { A1: sampleId.toString() }
      };
      const sample = {
        _id: sampleId,
        storageLocation: { boxId: boxId, position: 'A1' }
      };

      const storageBoxes = makeCollection();
      storageBoxes.findOne.mockResolvedValue(box);
      const samples = makeCollection();
      samples.findOne.mockResolvedValue(sample);

      const db = makeDb({ storageBoxes, samples });
      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.checkBoxIntegrity({ boxId: boxId.toString() });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
      expect(result.stats).toEqual({
        boxId,
        dimension: { rows: 5, cols: 5 },
        capacity: 25,
        currentOccupancy: 1,
        actualOccupancy: 1
      });
    });

    it('flags an orphan sample reference', async () => {
      const boxId = new ObjectId();
      const missingSampleId = new ObjectId();
      const box = {
        _id: boxId,
        dimension: { rows: 5, cols: 5 },
        currentOccupancy: 1,
        occupancyGrid: { A1: missingSampleId.toString() }
      };

      const storageBoxes = makeCollection();
      storageBoxes.findOne.mockResolvedValue(box);
      const samples = makeCollection();
      samples.findOne.mockResolvedValue(null);

      const db = makeDb({ storageBoxes, samples });
      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.checkBoxIntegrity({ boxId: boxId.toString() });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Orfão');
      expect(result.errors[0]).toContain('A1');
      expect(result.errors[0]).toContain(missingSampleId.toString());
    });

    it('flags an inconsistent location when the sample points elsewhere', async () => {
      const boxId = new ObjectId();
      const otherBoxId = new ObjectId();
      const sampleId = new ObjectId();
      const box = {
        _id: boxId,
        dimension: { rows: 5, cols: 5 },
        currentOccupancy: 1,
        occupancyGrid: { A1: sampleId.toString() }
      };
      const sample = {
        _id: sampleId,
        storageLocation: { boxId: otherBoxId, position: 'B2' }
      };

      const storageBoxes = makeCollection();
      storageBoxes.findOne.mockResolvedValue(box);
      const samples = makeCollection();
      samples.findOne.mockResolvedValue(sample);

      const db = makeDb({ storageBoxes, samples });
      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.checkBoxIntegrity({ boxId: boxId.toString() });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Inconsistência');
      expect(result.errors[0]).toContain(otherBoxId.toString());
      expect(result.errors[0]).toContain('B2');
    });

    it('flags a currentOccupancy mismatch against actual occupied positions', async () => {
      const boxId = new ObjectId();
      const box = {
        _id: boxId,
        dimension: { rows: 5, cols: 5 },
        currentOccupancy: 3,
        occupancyGrid: {}
      };

      const storageBoxes = makeCollection();
      storageBoxes.findOne.mockResolvedValue(box);
      const samples = makeCollection();

      const db = makeDb({ storageBoxes, samples });
      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.checkBoxIntegrity({ boxId: boxId.toString() });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Contagem incorreta');
      expect(result.errors[0]).toContain('currentOccupancy=3');
      expect(result.errors[0]).toContain('ocupação real=0');
      expect(result.stats.actualOccupancy).toBe(0);
      expect(result.stats.currentOccupancy).toBe(3);
    });

    it('skips falsy occupancyGrid entries without querying samples', async () => {
      const boxId = new ObjectId();
      const box = {
        _id: boxId,
        dimension: { rows: 5, cols: 5 },
        currentOccupancy: 0,
        occupancyGrid: { A1: null, A2: '' }
      };

      const storageBoxes = makeCollection();
      storageBoxes.findOne.mockResolvedValue(box);
      const samples = makeCollection();

      const db = makeDb({ storageBoxes, samples });
      const repo = new MongoStorageTopologyReadRepository(db);
      const result = await repo.checkBoxIntegrity({ boxId: boxId.toString() });

      expect(samples.findOne).not.toHaveBeenCalled();
      expect(result.valid).toBe(true);
    });
  });

  describe('toObjectId', () => {
    it('returns the same instance when given an ObjectId', () => {
      const db = makeDb({});
      const repo = new MongoStorageTopologyReadRepository(db);
      const id = new ObjectId();
      expect(repo.toObjectId(id)).toBe(id);
    });

    it('converts a valid ObjectId string into an ObjectId instance', () => {
      const db = makeDb({});
      const repo = new MongoStorageTopologyReadRepository(db);
      const idStr = new ObjectId().toString();
      const result = repo.toObjectId(idStr);
      expect(result).toBeInstanceOf(ObjectId);
      expect(result.toString()).toBe(idStr);
    });

    it('returns the raw value unchanged when given an invalid string', () => {
      const db = makeDb({});
      const repo = new MongoStorageTopologyReadRepository(db);
      const result = repo.toObjectId('not-a-valid-object-id');
      expect(result).toBe('not-a-valid-object-id');
    });
  });
});
