/**
 * #941: the storageContainers.containerID and sensorMetadata.sensorId
 * unique indexes, and their (self-contained) latching.
 *
 * `StorageContainer.js` and `SensorMetadata.schema.js` have declared these
 * constraints all along and neither declaration ever reaches Mongo — the
 * mongoose connection is opened with `autoIndex: false` and nothing calls
 * `syncIndexes()`/`createIndexes()` anywhere in `api/`. So a schema-level
 * `unique: true` would have been a no-op that reads as a fix, which is the
 * trap these cases exist to keep shut. See `tests/unit/sampleIndexes.unit.test.js`
 * for the precedent this is modelled on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const modulePath = require.resolve('../../src/utils/storageIndexes');

function freshStorageIndexes() {
  delete require.cache[modulePath];
  return require(modulePath);
}

function makeCollection(collectionName, createIndexImpl) {
  return {
    collectionName,
    createIndex: vi.fn(createIndexImpl || (async () => 'ok'))
  };
}

describe('#941 ensureStorageContainerIndexes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a partial UNIQUE index on containerID', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageContainers');

    await ensureStorageContainerIndexes(collection);

    // #941: three indexes are built here now (the containerID unique plus
    // two lookup indexes), so this case locates its own by key.
    expect(collection.createIndex).toHaveBeenCalledTimes(3);
    const containerIdCall = collection.createIndex.mock.calls.find(
      ([k]) => Object.prototype.hasOwnProperty.call(k, 'containerID')
    );
    expect(containerIdCall).toBeDefined();
    const [keys, options] = containerIdCall;
    expect(keys).toEqual({ containerID: 1 });
    expect(options.unique).toBe(true);
    expect(options.name).toBe('storage_containers_containerid_unique_v2');
  });

  // The filter is the whole design decision, so it is pinned by value.
  // `findOrCreateContainer`'s SHELF/RACK/DRAWER path never sets containerID
  // at all, so a plain unique index would collide on the second such
  // container; `$type: 'string'` indexes only the rows with a real value.
  // #1164: `$gt: ''`, not `$type: 'string'` -- the planner cannot use a
  // `$type` partial index for `{ containerID: 'X' }`, so v1 never served a
  // lookup. `$gt: ''` excludes the same missing/null rows.
  it("filters on $gt ''", async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageContainers');

    await ensureStorageContainerIndexes(collection);

    const [, options] = collection.createIndex.mock.calls[0];
    expect(options.partialFilterExpression).toEqual({ containerID: { $gt: '' } });
  });

  it('drops the superseded storage_containers_containerid_unique_v1 only AFTER building v2', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageContainers-1164-drop');
    collection.dropIndex = vi.fn(async () => {});

    await ensureStorageContainerIndexes(collection);

    expect(collection.dropIndex).toHaveBeenCalledWith('storage_containers_containerid_unique_v1');
    const buildV2 = collection.createIndex.mock.calls.findIndex(([, o]) => o.name === 'storage_containers_containerid_unique_v2');
    expect(collection.createIndex.mock.invocationCallOrder[buildV2])
      .toBeLessThan(collection.dropIndex.mock.invocationCallOrder[0]);
  });

  it('logs and does not throw when the index cannot be built', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const logger = require('../../src/utils/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = makeCollection('storageContainers', async () => {
      throw new Error('E11000 duplicate key error collection: bio.storageContainers');
    });

    await expect(ensureStorageContainerIndexes(collection)).resolves.toBeUndefined();

    // #941: one warning per index -- a shared catch would report the first
    // failure and skip the remaining builds silently.
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mock.calls.forEach(([message]) => {
      expect(message).toContain('#941');
    });

    const warned = warn.mock.calls.map(([message]) => message);
    const uniqueWarning = warned.find((m) => m.includes('storage_containers_containerid_unique_v2'));
    expect(uniqueWarning).toContain('E11000');

    // A lookup-index failure costs performance and nothing else, so its
    // message must not read as a data problem the way the unique one does.
    // Asserted on the message's OWN framing, not on the appended error text:
    // this fixture throws one error object for every build, so the error
    // string is identical in all three warnings and says nothing about which
    // wording the helper chose.
    const lookupWarnings = warned.filter((m) => m.includes('_idx_v1'));
    expect(lookupWarnings).toHaveLength(2);
    lookupWarnings.forEach((m) => {
      expect(m).toContain('desempenho');
      expect(m).not.toContain('unicidade');
      expect(m).not.toContain('duplicados');
    });
    expect(uniqueWarning).toContain('duplicados');
  });

  it('is a no-op for a collection handle that cannot create indexes', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    await expect(ensureStorageContainerIndexes(null)).resolves.toBeUndefined();
    await expect(ensureStorageContainerIndexes({})).resolves.toBeUndefined();
  });

  it('latches per resolved collection name -- calling it twice for the same collection issues createIndex once', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageContainers');

    await ensureStorageContainerIndexes(collection);
    await ensureStorageContainerIndexes(collection);
    await ensureStorageContainerIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledTimes(3);
  });

  // #941: the two lookup indexes below are BUILD decisions taken from the
  // planner rather than by inference. Measured on mongo:7 against a scratch
  // tree (1 freezer / 5 shelves / 25 racks / 250 boxes) using the query
  // shapes that actually exist in src/: both are the winning plan, and the
  // topology walks go from a collection scan to examined == returned.
  it('builds the { containerType, status } lookup index', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageContainers');

    await ensureStorageContainerIndexes(collection);

    const call = collection.createIndex.mock.calls.find(
      ([k]) => k.containerType === 1 && k.status === 1
    );
    expect(call).toBeDefined();
    // listOperationalFreezers: find({containerType:'FREEZER',status:'OPERATIONAL'})
    expect(call[1].unique).toBeUndefined();
  });

  it('builds the { parent_id, containerType } lookup index', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageContainers');

    await ensureStorageContainerIndexes(collection);

    const call = collection.createIndex.mock.calls.find(
      ([k]) => k.parent_id === 1 && k.containerType === 1
    );
    expect(call).toBeDefined();
    // The shelf/rack walk in MongoStorageTopologyReadRepository, TelemetryMonitor
    // and equipment-sensor-quarantine.service all issue exactly this shape.
    expect(call[1].unique).toBeUndefined();
  });

  // #941: pins a DELETE decision, so it cannot quietly come back.
  // StorageContainer.js declared a standalone { name: 1 }. Measured: it is
  // never the winning plan for any query shape in src/, because every
  // .sort({name:1}) there follows a SELECTIVE filter -- the planner takes
  // the compound index and sorts the already-small result in memory.
  it('does NOT build a standalone { name: 1 } index', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageContainers');

    await ensureStorageContainerIndexes(collection);

    const nameOnly = collection.createIndex.mock.calls.find(
      ([k]) => Object.keys(k).length === 1 && k.name === 1
    );
    expect(nameOnly).toBeUndefined();
  });
});

describe('#941 ensureStorageBoxIndexes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // #941: measured as the winning plan for BOTH storageBoxes query shapes
  // in src/ -- the topology walk's find({parent_id}).sort({name:1}) and
  // TelemetryMonitor's find({parent_id:{$in:rackIds}}). The status suffix
  // costs nothing for those, since a compound index serves its own prefix.
  it('builds the { parent_id, status } lookup index', async () => {
    const { ensureStorageBoxIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageBoxes');

    await ensureStorageBoxIndexes(collection);

    const call = collection.createIndex.mock.calls.find(
      ([k]) => k.parent_id === 1 && k.status === 1
    );
    expect(call).toBeDefined();
    expect(call[1].unique).toBeUndefined();
  });

  // #941: the second DELETE. StorageBox.js declared a standalone { name: 1 }
  // and the planner never picks it, for the same reason as the container one.
  it('does NOT build a standalone { name: 1 } index', async () => {
    const { ensureStorageBoxIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageBoxes');

    await ensureStorageBoxIndexes(collection);

    const nameOnly = collection.createIndex.mock.calls.find(
      ([k]) => Object.keys(k).length === 1 && k.name === 1
    );
    expect(nameOnly).toBeUndefined();
  });

  it('logs and does not throw when the index cannot be built', async () => {
    const { ensureStorageBoxIndexes } = freshStorageIndexes();
    const logger = require('../../src/utils/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = makeCollection('storageBoxes', async () => {
      throw new Error('boom');
    });

    await expect(ensureStorageBoxIndexes(collection)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('#941');
  });

  it('is a no-op for a collection handle that cannot create indexes', async () => {
    const { ensureStorageBoxIndexes } = freshStorageIndexes();
    await expect(ensureStorageBoxIndexes(null)).resolves.toBeUndefined();
    await expect(ensureStorageBoxIndexes({})).resolves.toBeUndefined();
  });

  it('latches per resolved collection name', async () => {
    const { ensureStorageBoxIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageBoxes');

    await ensureStorageBoxIndexes(collection);
    const afterFirst = collection.createIndex.mock.calls.length;
    await ensureStorageBoxIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledTimes(afterFirst);
  });
});

describe('#941 ensureSensorMetadataIndexes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a UNIQUE index on sensorId with no partial filter', async () => {
    const { ensureSensorMetadataIndexes } = freshStorageIndexes();
    const collection = makeCollection('sensorMetadata');

    await ensureSensorMetadataIndexes(collection);

    // #941: two indexes are built here now (sensorId and macAddress), so
    // this case locates its own by key rather than by call position.
    expect(collection.createIndex).toHaveBeenCalledTimes(2);
    const sensorIdCall = collection.createIndex.mock.calls.find(
      ([k]) => Object.prototype.hasOwnProperty.call(k, 'sensorId')
    );
    expect(sensorIdCall).toBeDefined();
    const [keys, options] = sensorIdCall;
    expect(keys).toEqual({ sensorId: 1 });
    expect(options).toEqual({
      name: 'sensor_metadata_sensorid_unique_v1',
      unique: true
    });
    expect(options.partialFilterExpression).toBeUndefined();
  });

  // #941: macAddress was declared unique on the schema alongside sensorId
  // and, unlike sensorId, was never materialised -- `ensureSensorMetadataIndexes`
  // built only the sensorId index. So `sensor.service.js`'s documented
  // "macAddress duplicado" failure was an E11000 the database could not
  // produce: the upsert filter is {sensorId}, so two sensors could carry one MAC.
  //
  // The partial filter is the design decision, so it is pinned by value.
  // Unlike sensorId -- which IS the upsert filter key and so structurally
  // exists on every row -- macAddress only reaches the document through
  // $set, behind a truthiness guard in the CALLER (`createSensor`), not in
  // linkSensorMetadata's own contract. A plain unique index would therefore
  // reject the second row that legitimately lacks one; `$type: 'string'`
  // constrains exactly the rows that carry a real value, the same shape and
  // the same reason as containerID above and samples.barcode in #936.
  it('creates a partial UNIQUE index on macAddress', async () => {
    const { ensureSensorMetadataIndexes } = freshStorageIndexes();
    const collection = makeCollection('sensorMetadata');

    await ensureSensorMetadataIndexes(collection);

    const macCall = collection.createIndex.mock.calls.find(
      ([keys]) => Object.prototype.hasOwnProperty.call(keys, 'macAddress')
    );
    expect(macCall).toBeDefined();

    const [keys, options] = macCall;
    expect(keys).toEqual({ macAddress: 1 });
    expect(options.unique).toBe(true);
    expect(options.name).toBe('sensor_metadata_macaddress_unique_v2');
    // #1164: `$gt: ''`, not `$type: 'string'`, so the index can serve lookups.
    expect(options.partialFilterExpression).toEqual({ macAddress: { $gt: '' } });
  });

  // #1164: a failed replacement build must keep the old constraint.
  it.each([
    ['ensureStorageContainerIndexes', 'containerID', 'storageContainers-1164-keep'],
    ['ensureSensorMetadataIndexes', 'macAddress', 'sensorMetadata-1164-keep'],
  ])('%s keeps the v1 %s index when building v2 fails', async (fn, field, collectionName) => {
    const logger = require('../../src/utils/logger');
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const helpers = freshStorageIndexes();
    const collection = makeCollection(collectionName, async (keys) => {
      if (Object.prototype.hasOwnProperty.call(keys, field)) throw new Error('boom');
      return 'ok';
    });
    collection.dropIndex = vi.fn(async () => {});

    await helpers[fn](collection);

    expect(collection.dropIndex).not.toHaveBeenCalled();
  });

  it('drops the superseded sensor_metadata_macaddress_unique_v1 only AFTER building v2', async () => {
    const { ensureSensorMetadataIndexes } = freshStorageIndexes();
    const collection = makeCollection('sensorMetadata-1164-drop');
    collection.dropIndex = vi.fn(async () => {});

    await ensureSensorMetadataIndexes(collection);

    expect(collection.dropIndex).toHaveBeenCalledWith('sensor_metadata_macaddress_unique_v1');
    const buildV2 = collection.createIndex.mock.calls.findIndex(([, o]) => o.name === 'sensor_metadata_macaddress_unique_v2');
    expect(collection.createIndex.mock.invocationCallOrder[buildV2])
      .toBeLessThan(collection.dropIndex.mock.invocationCallOrder[0]);
  });

  it('logs and does not throw when the index cannot be built', async () => {
    const { ensureSensorMetadataIndexes } = freshStorageIndexes();
    const logger = require('../../src/utils/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = makeCollection('sensorMetadata', async () => {
      throw new Error('E11000 duplicate key error collection: bio.sensorMetadata index: sensor_metadata_sensorid_unique_v1');
    });

    await expect(ensureSensorMetadataIndexes(collection)).resolves.toBeUndefined();

    // #941: one warning per index. A shared catch would report the first
    // failure and silently skip the second build, so the count IS the
    // assertion that the two builds are independent.
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mock.calls.forEach(([message]) => {
      expect(message).toContain('E11000');
      expect(message).toContain('#941');
    });
    const warned = warn.mock.calls.map(([message]) => message).join('\n');
    expect(warned).toContain('sensor_metadata_sensorid_unique_v1');
    expect(warned).toContain('sensor_metadata_macaddress_unique_v2');
  });

  it('is a no-op for a collection handle that cannot create indexes', async () => {
    const { ensureSensorMetadataIndexes } = freshStorageIndexes();
    await expect(ensureSensorMetadataIndexes(null)).resolves.toBeUndefined();
    await expect(ensureSensorMetadataIndexes({})).resolves.toBeUndefined();
  });

  it('latches per resolved collection name -- calling it twice for the same collection issues createIndex once', async () => {
    const { ensureSensorMetadataIndexes } = freshStorageIndexes();
    const collection = makeCollection('sensorMetadata');

    await ensureSensorMetadataIndexes(collection);
    await ensureSensorMetadataIndexes(collection);

    // #941: the latch still admits the collection exactly once -- two
    // createIndex calls for the two indexes, not four for two passes.
    expect(collection.createIndex).toHaveBeenCalledTimes(2);
  });

  it('does not let the storageContainers latch and the sensorMetadata latch shadow each other', async () => {
    const { ensureStorageContainerIndexes, ensureSensorMetadataIndexes } = freshStorageIndexes();
    const storageCollection = makeCollection('storageContainers');
    const sensorCollection = makeCollection('sensorMetadata');

    await ensureStorageContainerIndexes(storageCollection);
    await ensureSensorMetadataIndexes(sensorCollection);

    expect(storageCollection.createIndex).toHaveBeenCalledTimes(3);
    expect(sensorCollection.createIndex).toHaveBeenCalledTimes(2);
  });
});
