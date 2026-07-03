import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sensorService = require('../../src/services/sensor.service');

function makeDb(collectionOverrides = {}) {
  const collection = {
    insertOne: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    updateOne: vi.fn(),
    deleteOne: vi.fn(),
    countDocuments: vi.fn(),
    ...collectionOverrides
  };
  return {
    db: { collection: vi.fn(() => collection) },
    collection
  };
}

describe('sensor.service (non-quarantine paths)', () => {
  beforeEach(() => {
    sensorService.setQuarantineService(null); // reset to default between tests
  });

  describe('createSensor', () => {
    it('throws joined validation errors for invalid sensorData', async () => {
      const { db } = makeDb();
      await expect(sensorService.createSensor(db, {})).rejects.toThrow(
        'sensorId é obrigatório, sensorType é obrigatório e deve ser string'
      );
    });

    it('inserts a valid sensor and returns it with the inserted _id', async () => {
      const { db, collection } = makeDb();
      collection.insertOne.mockResolvedValue({ insertedId: 'abc123' });

      const result = await sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature'
      });

      expect(collection.insertOne).toHaveBeenCalledTimes(1);
      expect(result._id).toBe('abc123');
      expect(result.sensorId).toBe('S-1');
      expect(result.sensorType).toBe('temperature');
      expect(result.maintenanceStatus).toBe('operational');
    });
  });

  describe('getSensor', () => {
    it('queries with $or across sensorId/sensorID/_id and returns the found document', async () => {
      const { db, collection } = makeDb();
      const found = { sensorId: 'S-1', sensorType: 'temperature' };
      collection.findOne.mockResolvedValue(found);

      const result = await sensorService.getSensor(db, 'S-1');

      expect(collection.findOne).toHaveBeenCalledWith({
        $or: [{ sensorId: 'S-1' }, { sensorID: 'S-1' }, { _id: 'S-1' }]
      });
      expect(result).toBe(found);
    });

    it('returns null when no sensor matches', async () => {
      const { db, collection } = makeDb();
      collection.findOne.mockResolvedValue(null);

      const result = await sensorService.getSensor(db, 'missing');

      expect(result).toBeNull();
    });
  });

  describe('listSensors', () => {
    function makeFindChain(items) {
      const toArray = vi.fn().mockResolvedValue(items);
      const skip = vi.fn(() => ({ toArray }));
      const limit = vi.fn(() => ({ skip }));
      return { find: vi.fn(() => ({ limit })), limit, skip, toArray };
    }

    it('returns all sensors with default limit/skip when no filters given', async () => {
      const { db, collection } = makeDb();
      const chain = makeFindChain([{ sensorId: 'S-1' }]);
      collection.find = chain.find;
      collection.countDocuments.mockResolvedValue(1);

      const result = await sensorService.listSensors(db, {});

      expect(chain.find).toHaveBeenCalledWith({});
      expect(chain.limit).toHaveBeenCalledWith(50);
      expect(chain.skip).toHaveBeenCalledWith(0);
      expect(result).toEqual({ sensors: [{ sensorId: 'S-1' }], total: 1, limit: 50, skip: 0 });
    });

    it('builds a locationId $or query when locationId filter given', async () => {
      const { db, collection } = makeDb();
      const chain = makeFindChain([]);
      collection.find = chain.find;
      collection.countDocuments.mockResolvedValue(0);

      await sensorService.listSensors(db, { locationId: 'LOC-1' });

      expect(chain.find).toHaveBeenCalledWith({
        $or: [{ locationId: 'LOC-1' }, { locationID: 'LOC-1' }]
      });
    });

    it('applies maintenanceStatus filter directly on the query', async () => {
      const { db, collection } = makeDb();
      const chain = makeFindChain([]);
      collection.find = chain.find;
      collection.countDocuments.mockResolvedValue(0);

      await sensorService.listSensors(db, { maintenanceStatus: 'error' });

      expect(chain.find).toHaveBeenCalledWith({ maintenanceStatus: 'error' });
    });

    it('honors custom limit/skip values', async () => {
      const { db, collection } = makeDb();
      const chain = makeFindChain([]);
      collection.find = chain.find;
      collection.countDocuments.mockResolvedValue(0);

      const result = await sensorService.listSensors(db, { limit: 10, skip: 20 });

      expect(chain.limit).toHaveBeenCalledWith(10);
      expect(chain.skip).toHaveBeenCalledWith(20);
      expect(result.limit).toBe(10);
      expect(result.skip).toBe(20);
    });
  });

  describe('updateSensor (non-quarantine path)', () => {
    beforeEach(() => {
      sensorService.setQuarantineService({
        isQuarantineTriggerStatus: vi.fn(() => false),
        quarantineBySensorStatus: vi.fn()
      });
    });

    it('throws "Sensor não encontrado" when findOne returns falsy', async () => {
      const { db, collection } = makeDb();
      collection.findOne.mockResolvedValue(null);

      await expect(sensorService.updateSensor(db, 'S-404', { status: 'maintenance' }))
        .rejects.toThrow('Sensor não encontrado');
      expect(collection.updateOne).not.toHaveBeenCalled();
    });

    it('throws "Sensor não encontrado" when updateOne reports matchedCount 0', async () => {
      const { db, collection } = makeDb();
      collection.findOne.mockResolvedValue({ sensorId: 'S-1', maintenanceStatus: 'operational' });
      collection.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(sensorService.updateSensor(db, 'S-1', { status: 'maintenance' }))
        .rejects.toThrow('Sensor não encontrado');
    });

    it('updates via updateOne (no transaction) and returns triggered:false when not a quarantine status', async () => {
      const { db, collection } = makeDb();
      const existing = { sensorId: 'S-1', maintenanceStatus: 'operational' };
      collection.findOne.mockResolvedValue(existing);
      collection.updateOne.mockResolvedValue({ matchedCount: 1 });

      const result = await sensorService.updateSensor(db, 'S-1', { sensorModel: 'new-model' });

      expect(collection.updateOne).toHaveBeenCalledWith(
        { $or: [{ sensorId: 'S-1' }, { sensorID: 'S-1' }, { _id: 'S-1' }] },
        { $set: expect.objectContaining({ sensorModel: 'new-model', updatedAt: expect.any(Date) }) }
      );
      expect(result).toEqual({ success: true, quarantine: { triggered: false } });
    });
  });

  describe('collectReading', () => {
    it('throws "Sensor não encontrado" when the sensor does not exist', async () => {
      const { db, collection } = makeDb();
      collection.findOne.mockResolvedValue(null);

      await expect(sensorService.collectReading(db, 'missing')).rejects.toThrow('Sensor não encontrado');
    });

    it('returns a shaped reading object with ready:true and fallback fields resolved', async () => {
      const { db, collection } = makeDb();
      collection.findOne.mockResolvedValue({
        sensorID: 'S-9',
        sensorType: 'humidity',
        locationID: 'LOC-5',
        policyId: 'POL-1'
      });

      const reading = await sensorService.collectReading(db, 'S-9');

      expect(reading).toEqual({
        sensorId: 'S-9',
        sensorType: 'humidity',
        locationId: 'LOC-5',
        policyId: 'POL-1',
        ready: true
      });
    });
  });

  describe('deleteSensor', () => {
    it('returns true when deletedCount > 0', async () => {
      const { db, collection } = makeDb();
      collection.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await sensorService.deleteSensor(db, 'S-1');

      expect(collection.deleteOne).toHaveBeenCalledWith({
        $or: [{ sensorId: 'S-1' }, { sensorID: 'S-1' }, { _id: 'S-1' }]
      });
      expect(result).toBe(true);
    });

    it('returns false when deletedCount is 0 (nothing matched)', async () => {
      const { db, collection } = makeDb();
      collection.deleteOne.mockResolvedValue({ deletedCount: 0 });

      const result = await sensorService.deleteSensor(db, 'missing');

      expect(result).toBe(false);
    });
  });
});
