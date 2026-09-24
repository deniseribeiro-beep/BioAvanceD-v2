import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sensorService = require('../../src/services/sensor.service');

// #1126: sensor.service.js destructures ensureSensorMetadataIndexes at require
// time, so a spy installed after load is never seen. Spy first, then reload.
const SENSOR_SERVICE_PATH = require.resolve('../../src/services/sensor.service');
const storageIndexes = require('../../src/utils/storageIndexes');

function reloadSensorService() {
  delete require.cache[SENSOR_SERVICE_PATH];
  return require(SENSOR_SERVICE_PATH);
}

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

    // #634: organizationId, when provided, must resolve to a real
    // Organization -- same write-time validation shape as
    // sample.service.js's createSample#collectionSite check.
    it('throws a 404 when organizationId does not resolve to a real Organization', async () => {
      const { db } = makeDb();
      const organizationsCollection = { findOne: vi.fn().mockResolvedValue(null) };
      const sensorsCollection = { insertOne: vi.fn() };
      db.collection = vi.fn((name) => (name === 'organizations' ? organizationsCollection : sensorsCollection));

      const err = await sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        organizationId: 'org-inexistente'
      }).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('org-inexistente');
      expect(err.statusCode).toBe(404);
      expect(organizationsCollection.findOne).toHaveBeenCalledWith({ organizationId: 'org-inexistente' });
      expect(sensorsCollection.insertOne).not.toHaveBeenCalled();
    });

    it('creates a sensor with organizationId when it resolves to a real Organization', async () => {
      const { db } = makeDb();
      const organizationsCollection = { findOne: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) };
      const sensorsCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'abc123' }) };
      db.collection = vi.fn((name) => (name === 'organizations' ? organizationsCollection : sensorsCollection));

      const result = await sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        organizationId: 'org-1'
      });

      expect(result.organizationId).toBe('org-1');
    });

    it('leaves organizationId null when not provided (no backfill, unscoped/legacy by default)', async () => {
      const { db, collection } = makeDb();
      collection.insertOne.mockResolvedValue({ insertedId: 'abc123' });

      const result = await sensorService.createSensor(db, { sensorId: 'S-1', sensorType: 'temperature' });

      expect(result.organizationId).toBeNull();
    });

    // #1126: utils/storageIndexes.js's two helpers had their own behaviour
    // pinned by storageIndexes.unit.test.js and NOTHING asserted either was
    // ever CALLED -- so deleting this call site left the whole suite green.
    // That is #941's own defect one level up: a fix that is written, tested,
    // and never reached is indistinguishable from an unbuilt Schema.index()
    // declaration, which is the thing #941 exists to close.
    //
    // createSensor -> linkSensorMetadata is the ONLY production path to this
    // helper, so this assertion is the whole wiring guarantee.
    it('#1126: ensures the sensorMetadata indexes on the write path', async () => {
      const ensureSpy = vi
        .spyOn(storageIndexes, 'ensureSensorMetadataIndexes')
        .mockImplementation(() => {});
      const freshSensorService = reloadSensorService();

      const { db, collection } = makeDb();
      collection.insertOne.mockResolvedValue({ insertedId: 'abc123' });
      collection.updateOne.mockResolvedValue({ acknowledged: true });

      await freshSensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        macAddress: 'AA:BB:CC:DD:EE:FF'
      });

      expect(ensureSpy).toHaveBeenCalledTimes(1);
      // The sensorMetadata collection handle, not the sensors one.
      expect(ensureSpy.mock.calls[0][0]).toBe(collection);

      ensureSpy.mockRestore();
    });

    it('does not touch sensorMetadata when no macAddress is provided (back-compat)', async () => {
      const { db, collection } = makeDb();
      collection.insertOne.mockResolvedValue({ insertedId: 'abc123' });

      await sensorService.createSensor(db, { sensorId: 'S-1', sensorType: 'temperature' });

      expect(db.collection).not.toHaveBeenCalledWith('sensorMetadata');
    });

    it('upserts a linked sensorMetadata doc (with storageContainer) when macAddress is provided', async () => {
      const { db } = makeDb();
      const sensorsCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'abc123' }) };
      const sensorMetadataCollection = { updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }) };
      db.collection = vi.fn((name) => (name === 'sensorMetadata' ? sensorMetadataCollection : sensorsCollection));

      const storageContainerId = '507f1f77bcf86cd799439099';
      const result = await sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        macAddress: 'AA:BB:CC:00:00:01',
        storageContainer: storageContainerId
      });

      expect(sensorMetadataCollection.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update, options] = sensorMetadataCollection.updateOne.mock.calls[0];
      expect(filter).toEqual({ sensorId: 'S-1' });
      expect(update.$set.macAddress).toBe('AA:BB:CC:00:00:01');
      expect(update.$set.storageContainer.toString()).toBe(storageContainerId);
      expect(options).toEqual({ upsert: true });
      expect(result.metadataLinked).toBe(true);
    });

    // #1140: SensorMetadata.temperaturePolicy had no writer anywhere in
    // src/ -- linkSensorMetadata pinned it null in $setOnInsert and nothing
    // ever set it, so the only real values in the tracked tree came from the
    // e2e fixture helper. Two live consumers read it and both degrade
    // silently: TelemetryMonitor's per-sensor minimumDuration (#688) falls
    // back to the global threshold for every sensor, and
    // iot.controller#resolveTemperaturePolicy gates its whole threshold
    // check on the populated value, so machine ingest compared nothing.
    //
    // Direction 1: bind at registration, exactly as #311 did for the sibling
    // storageContainer field in be435d6c. Same function, same conditional
    // $set, same ObjectId coercion.
    it('#1140: binds temperaturePolicy from the request when provided', async () => {
      const { db } = makeDb();
      const sensorsCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'abc123' }) };
      const sensorMetadataCollection = { updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }) };
      // #1179: createSensor now checks the policy exists before writing.
      const temperaturePoliciesCollection = { findOne: vi.fn().mockResolvedValue({ _id: 'p' }) };
      db.collection = vi.fn((name) => {
        if (name === 'sensorMetadata') return sensorMetadataCollection;
        if (name === 'temperaturePolicies') return temperaturePoliciesCollection;
        return sensorsCollection;
      });

      const temperaturePolicyId = '507f1f77bcf86cd799439088';
      const result = await sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        macAddress: 'AA:BB:CC:00:00:01',
        temperaturePolicy: temperaturePolicyId
      });

      expect(sensorMetadataCollection.updateOne).toHaveBeenCalledTimes(1);
      const [, update] = sensorMetadataCollection.updateOne.mock.calls[0];
      expect(update.$set.temperaturePolicy.toString()).toBe(temperaturePolicyId);
      expect(result.metadataLinked).toBe(true);
    });

    // #1145: the binding lives on SensorMetadata, and that row is only
    // created when a macAddress is given. A policy without one used to be
    // dropped silently -- a sensor that looked governed and was not -- so it
    // is refused before anything is written.
    it('#1145: refuses temperaturePolicy without macAddress, writing nothing', async () => {
      const { db } = makeDb();
      const sensorsCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'abc123' }) };
      const sensorMetadataCollection = { updateOne: vi.fn() };
      db.collection = vi.fn((name) => (name === 'sensorMetadata' ? sensorMetadataCollection : sensorsCollection));

      await expect(sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        temperaturePolicy: '507f1f77bcf86cd799439088'
      })).rejects.toThrow(/temperaturePolicy exige macAddress/);

      expect(sensorsCollection.insertOne).not.toHaveBeenCalled();
      expect(sensorMetadataCollection.updateOne).not.toHaveBeenCalled();
    });

    it('#1179: refuses storageContainer without macAddress, writing nothing', async () => {
      const { db } = makeDb();
      const sensorsCollection = { insertOne: vi.fn() };
      db.collection = vi.fn(() => sensorsCollection);

      await expect(sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        storageContainer: '507f1f77bcf86cd799439099'
      })).rejects.toThrow(/storageContainer exige macAddress/);

      expect(sensorsCollection.insertOne).not.toHaveBeenCalled();
    });

    // #1179: a dangling policy reference used to bind silently, and the
    // telemetry path then resolved null and checked nothing.
    it('#1179: refuses a temperaturePolicy that names no policy, writing nothing', async () => {
      const { db } = makeDb();
      const sensorsCollection = { insertOne: vi.fn() };
      const sensorMetadataCollection = { updateOne: vi.fn() };
      const temperaturePoliciesCollection = { findOne: vi.fn().mockResolvedValue(null) };
      db.collection = vi.fn((name) => {
        if (name === 'sensorMetadata') return sensorMetadataCollection;
        if (name === 'temperaturePolicies') return temperaturePoliciesCollection;
        return sensorsCollection;
      });

      await expect(sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        macAddress: 'AA:BB:CC:00:00:01',
        temperaturePolicy: '507f1f77bcf86cd799439088'
      })).rejects.toThrow(/temperaturePolicy não encontrada/);

      expect(sensorsCollection.insertOne).not.toHaveBeenCalled();
      expect(sensorMetadataCollection.updateOne).not.toHaveBeenCalled();
    });

    // This one is not cosmetic and the mock cannot catch it on its own:
    // MongoDB REJECTS an update naming the same field in both $set and
    // $setOnInsert. temperaturePolicy is already in $setOnInsert, unlike
    // storageContainer, so the sibling pattern is not safe to copy verbatim
    // -- the null default has to drop out whenever a value is supplied.
    it('#1140: drops the $setOnInsert null when temperaturePolicy is supplied', async () => {
      const { db } = makeDb();
      const sensorsCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'abc123' }) };
      const sensorMetadataCollection = { updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }) };
      const temperaturePoliciesCollection = { findOne: vi.fn().mockResolvedValue({ _id: 'p' }) };
      db.collection = vi.fn((name) => {
        if (name === 'sensorMetadata') return sensorMetadataCollection;
        if (name === 'temperaturePolicies') return temperaturePoliciesCollection;
        return sensorsCollection;
      });

      await sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        macAddress: 'AA:BB:CC:00:00:01',
        temperaturePolicy: '507f1f77bcf86cd799439088'
      });

      const [, update] = sensorMetadataCollection.updateOne.mock.calls[0];
      expect(update.$set).toHaveProperty('temperaturePolicy');
      expect(update.$setOnInsert).not.toHaveProperty('temperaturePolicy');
    });

    // CONTROL: green before and after. The null default must still be there
    // for a sensor registered without a policy, or an existing binding would
    // be the only thing distinguishing the two paths.
    it('CONTROL: keeps the $setOnInsert null when no temperaturePolicy is supplied', async () => {
      const { db } = makeDb();
      const sensorsCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'abc123' }) };
      const sensorMetadataCollection = { updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }) };
      db.collection = vi.fn((name) => (name === 'sensorMetadata' ? sensorMetadataCollection : sensorsCollection));

      await sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        macAddress: 'AA:BB:CC:00:00:01'
      });

      const [, update] = sensorMetadataCollection.updateOne.mock.calls[0];
      expect(update.$setOnInsert).toHaveProperty('temperaturePolicy', null);
      expect(update.$set).not.toHaveProperty('temperaturePolicy');
    });

    it('does not throw when the sensorMetadata upsert fails, but surfaces metadataLinked: false (#313)', async () => {
      const { db } = makeDb();
      const sensorsCollection = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'abc123' }) };
      const sensorMetadataCollection = { updateOne: vi.fn().mockRejectedValue(new Error('E11000 duplicate key')) };
      db.collection = vi.fn((name) => (name === 'sensorMetadata' ? sensorMetadataCollection : sensorsCollection));

      const result = await sensorService.createSensor(db, {
        sensorId: 'S-1',
        sensorType: 'temperature',
        macAddress: 'AA:BB:CC:00:00:01'
      });

      expect(result._id).toBe('abc123');
      expect(result.metadataLinked).toBe(false);
    });
  });

  describe('getSensor', () => {
    it('queries with $or across sensorId/sensorID/_id and returns the found document', async () => {
      const { db, collection } = makeDb();
      const found = { sensorId: 'S-1', sensorType: 'temperature' };
      collection.findOne.mockResolvedValue(found);

      const result = await sensorService.getSensor(db, 'S-1');

      expect(collection.findOne).toHaveBeenCalledWith({
        $or: [{ sensorId: 'S-1' }, { _id: 'S-1' }]
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
      const sort = vi.fn(() => ({ limit }));
      return { find: vi.fn(() => ({ sort })), sort, limit, skip, toArray };
    }

    it('returns all sensors with default limit/skip when no filters given', async () => {
      const { db, collection } = makeDb();
      const chain = makeFindChain([{ sensorId: 'S-1' }]);
      collection.find = chain.find;
      collection.countDocuments.mockResolvedValue(1);
      const sensorMetadata = { find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) };
      db.collection = vi.fn((name) => (name === 'sensorMetadata' ? sensorMetadata : collection));

      const result = await sensorService.listSensors(db, {});

      expect(chain.find).toHaveBeenCalledWith({});
      // #645: newest-first so a just-created sensor always lands on page 1.
      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(chain.limit).toHaveBeenCalledWith(50);
      expect(chain.skip).toHaveBeenCalledWith(0);
      expect(result).toEqual({ sensors: [{ sensorId: 'S-1' }], total: 1, limit: 50, skip: 0 });
    });

    // #1179: the edit form pre-fills the freezer and policy, which live on
    // SensorMetadata -- one batched read for the page, stringified refs.
    it('#1179: attaches each sensor\'s SensorMetadata bindings in one batched read', async () => {
      const { db, collection } = makeDb();
      const chain = makeFindChain([{ sensorId: 'S-1' }, { sensorId: 'S-2' }]);
      collection.find = chain.find;
      collection.countDocuments.mockResolvedValue(2);
      const metadataFind = vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue([
          { sensorId: 'S-1', storageContainer: 'freezer-1', temperaturePolicy: 'policy-1' }
        ])
      }));
      db.collection = vi.fn((name) => (name === 'sensorMetadata' ? { find: metadataFind } : collection));

      const result = await sensorService.listSensors(db, {});

      expect(metadataFind).toHaveBeenCalledTimes(1);
      expect(metadataFind.mock.calls[0][0]).toEqual({ sensorId: { $in: ['S-1', 'S-2'] } });
      expect(result.sensors[0]).toMatchObject({ storageContainer: 'freezer-1', temperaturePolicy: 'policy-1' });
      expect(result.sensors[1]).not.toHaveProperty('temperaturePolicy');
    });

    it('builds a locationId $or/$in query when locationId filter given', async () => {
      const { db, collection } = makeDb();
      const chain = makeFindChain([]);
      collection.find = chain.find;
      collection.countDocuments.mockResolvedValue(0);

      await sensorService.listSensors(db, { locationId: 'LOC-1' });

      expect(chain.find).toHaveBeenCalledWith({
        $or: [
          { locationId: { $in: ['LOC-1'] } },
          { locationID: { $in: ['LOC-1'] } }
        ]
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

    // #634 (F3-G09): an organization-scoped caller must only see sensors
    // whose organizationId is one of their scoped organizations -- a null
    // organizationId (unscoped/legacy sensor) must not be exposed.
    it('applies an organizationId $in filter for an organization-scoped caller', async () => {
      const { db, collection } = makeDb();
      const chain = makeFindChain([]);
      collection.find = chain.find;
      collection.countDocuments.mockResolvedValue(0);

      await sensorService.listSensors(db, {
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });

      expect(chain.find).toHaveBeenCalledWith({ organizationId: { $in: ['org-1'] } });
    });

    it('does not filter by organizationId for a global-scope caller (Administrador)', async () => {
      const { db, collection } = makeDb();
      const chain = makeFindChain([]);
      collection.find = chain.find;
      collection.countDocuments.mockResolvedValue(0);

      await sensorService.listSensors(db, { organizationScope: { scope: 'global' } });

      expect(chain.find).toHaveBeenCalledWith({});
    });

    // #645: real-backend Playwright run against compose.test.yml
    // (e2e fixtures accumulate across sessions in the named
    // volumes) hit exactly this shape -- 51 pre-existing sensors, no sort
    // applied, default limit 50 -- and the just-created sensor from a real
    // UI submission silently never appeared in the list, misread as a
    // flaky Playwright locator timeout rather than a deterministic
    // pagination bug. This mock honors Mongo's real find().sort().limit()
    // .skip() ordering semantics (unlike makeFindChain's canned array
    // above) so the assertion actually proves ordering, not just call shape.
    it('surfaces a just-created sensor on page 1 even when the collection already holds >limit older sensors (natural/insertion order)', async () => {
      const older = Array.from({ length: 51 }, (_, i) => ({
        sensorId: `old-${i}`,
        createdAt: new Date(2026, 0, 1, 0, 0, i)
      }));
      const newest = { sensorId: 'just-created', createdAt: new Date(2026, 0, 2) };
      // Natural/insertion order: oldest first, newest appended last --
      // exactly how a real Mongo collection with no explicit sort behaves.
      const naturalOrderDocs = [...older, newest];

      const makeRealCursor = (docs) => {
        let current = [...docs];
        const cursor = {
          sort: vi.fn((criteria) => {
            const [[field, direction]] = Object.entries(criteria);
            current = [...current].sort((a, b) => (direction >= 0 ? 1 : -1) * (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0));
            return cursor;
          }),
          limit: vi.fn((n) => { current = current.slice(0, n); return cursor; }),
          skip: vi.fn((n) => { current = current.slice(n); return cursor; }),
          toArray: vi.fn(async () => current)
        };
        return cursor;
      };

      const { db, collection } = makeDb();
      collection.find = vi.fn(() => makeRealCursor(naturalOrderDocs));
      collection.countDocuments.mockResolvedValue(naturalOrderDocs.length);

      const result = await sensorService.listSensors(db, {});

      expect(result.sensors.map((s) => s.sensorId)).toContain('just-created');
      expect(result.sensors[0].sensorId).toBe('just-created');
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

    it('throws a 404 when updateData.organizationId does not resolve to a real Organization', async () => {
      const { db } = makeDb();
      const organizationsCollection = { findOne: vi.fn().mockResolvedValue(null) };
      const sensorsCollection = { findOne: vi.fn().mockResolvedValue({ sensorId: 'S-1' }), updateOne: vi.fn() };
      db.collection = vi.fn((name) => (name === 'organizations' ? organizationsCollection : sensorsCollection));

      const err = await sensorService.updateSensor(db, 'S-1', { organizationId: 'org-inexistente' }).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('org-inexistente');
      expect(err.statusCode).toBe(404);
      expect(sensorsCollection.updateOne).not.toHaveBeenCalled();
    });

    it('updates via updateOne (no transaction) and returns triggered:false when not a quarantine status', async () => {
      const { db, collection } = makeDb();
      const existing = { sensorId: 'S-1', maintenanceStatus: 'operational' };
      collection.findOne.mockResolvedValue(existing);
      collection.updateOne.mockResolvedValue({ matchedCount: 1 });

      const result = await sensorService.updateSensor(db, 'S-1', { sensorModel: 'new-model' });

      expect(collection.updateOne).toHaveBeenCalledWith(
        { $or: [{ sensorId: 'S-1' }, { _id: 'S-1' }] },
        { $set: expect.objectContaining({ sensorModel: 'new-model', updatedAt: expect.any(Date) }) }
      );
      expect(result).toEqual({ success: true, quarantine: { triggered: false } });
    });

    // #1179: the freezer and policy bindings live on SensorMetadata, which
    // updateSensor never wrote, so the edit modal saved nothing for them.
    describe('#1179: rebinding SensorMetadata on edit', () => {
      const POLICY = '507f1f77bcf86cd799439088';
      const FREEZER = '507f1f77bcf86cd799439099';

      function routedDb({ metadataRow = { _id: 'm1' }, policy = { _id: POLICY } } = {}) {
        const sensors = {
          findOne: vi.fn().mockResolvedValue({ sensorId: 'S-1', maintenanceStatus: 'operational' }),
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
        };
        const sensorMetadata = {
          findOne: vi.fn().mockResolvedValue(metadataRow),
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
        };
        const temperaturePolicies = { findOne: vi.fn().mockResolvedValue(policy) };
        const db = {
          collection: vi.fn((name) => {
            if (name === 'sensorMetadata') return sensorMetadata;
            if (name === 'temperaturePolicies') return temperaturePolicies;
            return sensors;
          })
        };
        return { db, sensors, sensorMetadata, temperaturePolicies };
      }

      it('sets storageContainer and temperaturePolicy on the SensorMetadata row, as ObjectIds', async () => {
        const { db, sensorMetadata } = routedDb();

        await sensorService.updateSensor(db, 'S-1', { storageContainer: FREEZER, temperaturePolicy: POLICY });

        expect(sensorMetadata.updateOne).toHaveBeenCalledTimes(1);
        const [filter, update] = sensorMetadata.updateOne.mock.calls[0];
        expect(filter).toEqual({ sensorId: 'S-1' });
        expect(update.$set.storageContainer.toString()).toBe(FREEZER);
        expect(update.$set.temperaturePolicy.toString()).toBe(POLICY);
      });

      it('an empty temperaturePolicy unbinds it (null), without a policy lookup', async () => {
        const { db, sensorMetadata, temperaturePolicies } = routedDb();

        await sensorService.updateSensor(db, 'S-1', { temperaturePolicy: '' });

        expect(temperaturePolicies.findOne).not.toHaveBeenCalled();
        const [, update] = sensorMetadata.updateOne.mock.calls[0];
        expect(update.$set.temperaturePolicy).toBeNull();
        expect(update.$set).not.toHaveProperty('storageContainer');
      });

      it('an edit naming neither field never touches SensorMetadata', async () => {
        const { db, sensorMetadata } = routedDb();

        await sensorService.updateSensor(db, 'S-1', { sensorModel: 'm2' });

        expect(sensorMetadata.findOne).not.toHaveBeenCalled();
        expect(sensorMetadata.updateOne).not.toHaveBeenCalled();
      });

      it('refuses when the sensor has no SensorMetadata row, before writing either collection', async () => {
        const { db, sensors, sensorMetadata } = routedDb({ metadataRow: null });

        await expect(sensorService.updateSensor(db, 'S-1', { sensorModel: 'm2', storageContainer: FREEZER }))
          .rejects.toThrow(/sem SensorMetadata/);
        expect(sensors.updateOne).not.toHaveBeenCalled();
        expect(sensorMetadata.updateOne).not.toHaveBeenCalled();
      });

      it('refuses a policy that does not exist, before writing either collection', async () => {
        const { db, sensors, sensorMetadata } = routedDb({ policy: null });

        await expect(sensorService.updateSensor(db, 'S-1', { temperaturePolicy: POLICY }))
          .rejects.toThrow(/temperaturePolicy não encontrada/);
        expect(sensors.updateOne).not.toHaveBeenCalled();
        expect(sensorMetadata.updateOne).not.toHaveBeenCalled();
      });
    });

    // #875: updateSensor used to $set the caller's updateData verbatim --
    // an unfiltered or under-filtered body could inject arbitrary keys or
    // overwrite identity fields. Only Sensor.create()'s own fields (minus
    // sensorId/sensorID, which are identity and part of the lookup query)
    // may reach $set.
    it('#875: filters $set to the SensorModel allowlist, dropping injected/identity keys', async () => {
      const { db, collection } = makeDb();
      const existing = { sensorId: 'S-1', maintenanceStatus: 'operational' };
      collection.findOne.mockResolvedValue(existing);
      collection.updateOne.mockResolvedValue({ matchedCount: 1 });

      await sensorService.updateSensor(db, 'S-1', {
        sensorModel: 'new-model',
        injected: 'x',
        sensorId: 'ignored'
      });

      const setArg = collection.updateOne.mock.calls[0][1].$set;
      expect(setArg).toEqual(expect.objectContaining({ sensorModel: 'new-model', updatedAt: expect.any(Date) }));
      expect(setArg).not.toHaveProperty('injected');
      expect(setArg).not.toHaveProperty('sensorId');
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
        $or: [{ sensorId: 'S-1' }, { _id: 'S-1' }]
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

  describe('error paths (catch blocks log and rethrow)', () => {
    it('createSensor rethrows when insertOne rejects', async () => {
      const { db, collection } = makeDb();
      collection.insertOne.mockRejectedValue(new Error('insert failed'));

      await expect(
        sensorService.createSensor(db, { sensorId: 'S-1', sensorType: 'temperature' })
      ).rejects.toThrow('insert failed');
    });

    it('getSensor rethrows when findOne rejects', async () => {
      const { db, collection } = makeDb();
      collection.findOne.mockRejectedValue(new Error('find failed'));

      await expect(sensorService.getSensor(db, 'S-1')).rejects.toThrow('find failed');
    });

    it('listSensors rethrows when countDocuments rejects', async () => {
      const { db, collection } = makeDb();
      const toArray = vi.fn().mockResolvedValue([]);
      const skip = vi.fn(() => ({ toArray }));
      const limit = vi.fn(() => ({ skip }));
      const sort = vi.fn(() => ({ limit }));
      collection.find = vi.fn(() => ({ sort }));
      collection.countDocuments.mockRejectedValue(new Error('count failed'));

      await expect(sensorService.listSensors(db, {})).rejects.toThrow('count failed');
    });

    it('updateSensor rethrows when findOne rejects', async () => {
      const { db, collection } = makeDb();
      collection.findOne.mockRejectedValue(new Error('lookup failed'));

      await expect(
        sensorService.updateSensor(db, 'S-1', { status: 'maintenance' })
      ).rejects.toThrow('lookup failed');
    });

    it('collectReading rethrows when getSensor lookup fails', async () => {
      const { db, collection } = makeDb();
      collection.findOne.mockRejectedValue(new Error('reading lookup failed'));

      await expect(sensorService.collectReading(db, 'S-1')).rejects.toThrow('reading lookup failed');
    });

    it('deleteSensor rethrows when deleteOne rejects', async () => {
      const { db, collection } = makeDb();
      collection.deleteOne.mockRejectedValue(new Error('delete failed'));

      await expect(sensorService.deleteSensor(db, 'S-1')).rejects.toThrow('delete failed');
    });
  });

  describe('updateSensor quarantine trigger without transaction support', () => {
    it('calls quarantineBySensorStatus without a session when db.client.startSession is unavailable', async () => {
      const { db, collection } = makeDb();
      const existing = { sensorId: 'S-1', maintenanceStatus: 'operational' };
      collection.findOne.mockResolvedValue(existing);
      collection.updateOne.mockResolvedValue({ matchedCount: 1 });

      const quarantineBySensorStatus = vi.fn().mockResolvedValue({
        triggered: true,
        matched: 1,
        quarantined: 1,
        movements: 1,
        reason: 'status:offline'
      });
      sensorService.setQuarantineService({
        isQuarantineTriggerStatus: vi.fn(() => true),
        quarantineBySensorStatus
      });

      const result = await sensorService.updateSensor(db, 'S-1', { maintenanceStatus: 'offline' });

      expect(collection.updateOne).toHaveBeenCalledWith(
        { $or: [{ sensorId: 'S-1' }, { _id: 'S-1' }] },
        { $set: expect.objectContaining({ maintenanceStatus: 'offline' }) }
      );
      expect(quarantineBySensorStatus).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ maintenanceStatus: 'offline' }),
        'offline',
        expect.objectContaining({ updateData: expect.objectContaining({ maintenanceStatus: 'offline' }) })
      );
      expect(quarantineBySensorStatus.mock.calls[0][3]).not.toHaveProperty('session');
      expect(result.quarantine).toEqual({
        triggered: true,
        matched: 1,
        quarantined: 1,
        movements: 1,
        reason: 'status:offline'
      });
    });

    // #951: `typeof client.startSession === 'function'` is true on a real
    // MongoClient against a standalone mongod too -- it is not sufficient
    // to gate transaction use. This client exposes startSession (like a
    // real MongoClient would) but `hello` answers standalone, so
    // isTransactionCapable must resolve false and the sequential fallback
    // must run without ever calling startSession.
    it('falls back to the sequential write when db.client.startSession exists but the topology is standalone', async () => {
      const { db, collection } = makeDb();
      const existing = { sensorId: 'S-1', maintenanceStatus: 'operational' };
      collection.findOne.mockResolvedValue(existing);
      collection.updateOne.mockResolvedValue({ matchedCount: 1 });

      const startSession = vi.fn();
      const helloCommand = vi.fn().mockResolvedValue({});
      db.client = { startSession, db: vi.fn(() => ({ command: helloCommand })) };

      const quarantineBySensorStatus = vi.fn().mockResolvedValue({
        triggered: true,
        matched: 1,
        quarantined: 1,
        movements: 1,
        reason: 'status:offline'
      });
      sensorService.setQuarantineService({
        isQuarantineTriggerStatus: vi.fn(() => true),
        quarantineBySensorStatus
      });

      const result = await sensorService.updateSensor(db, 'S-1', { maintenanceStatus: 'offline' });

      expect(startSession).not.toHaveBeenCalled();
      expect(collection.updateOne).toHaveBeenCalledWith(
        { $or: [{ sensorId: 'S-1' }, { _id: 'S-1' }] },
        { $set: expect.objectContaining({ maintenanceStatus: 'offline' }) }
      );
      expect(quarantineBySensorStatus).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ maintenanceStatus: 'offline' }),
        'offline',
        expect.objectContaining({ updateData: expect.objectContaining({ maintenanceStatus: 'offline' }) })
      );
      expect(quarantineBySensorStatus.mock.calls[0][3]).not.toHaveProperty('session');
      expect(result.quarantine.triggered).toBe(true);
    });
  });
});
