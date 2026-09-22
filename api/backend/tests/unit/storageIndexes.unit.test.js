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

    expect(collection.createIndex).toHaveBeenCalledTimes(1);
    const [keys, options] = collection.createIndex.mock.calls[0];
    expect(keys).toEqual({ containerID: 1 });
    expect(options.unique).toBe(true);
    expect(options.name).toBe('storage_containers_containerid_unique_v1');
  });

  // The filter is the whole design decision, so it is pinned by value.
  // `findOrCreateContainer`'s SHELF/RACK/DRAWER path never sets containerID
  // at all, so a plain unique index would collide on the second such
  // container; `$type: 'string'` indexes only the rows with a real value.
  it('filters on $type string', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageContainers');

    await ensureStorageContainerIndexes(collection);

    const [, options] = collection.createIndex.mock.calls[0];
    expect(options.partialFilterExpression).toEqual({ containerID: { $type: 'string' } });
  });

  it('logs and does not throw when the index cannot be built', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const logger = require('../../src/utils/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = makeCollection('storageContainers', async () => {
      throw new Error('E11000 duplicate key error collection: bio.storageContainers index: storage_containers_containerid_unique_v1');
    });

    await expect(ensureStorageContainerIndexes(collection)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('E11000');
    expect(warn.mock.calls[0][0]).toContain('#941');
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

    expect(collection.createIndex).toHaveBeenCalledTimes(1);
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
    expect(options.name).toBe('sensor_metadata_macaddress_unique_v1');
    expect(options.partialFilterExpression).toEqual({ macAddress: { $type: 'string' } });
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
    expect(warned).toContain('sensor_metadata_macaddress_unique_v1');
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

    expect(storageCollection.createIndex).toHaveBeenCalledTimes(1);
    expect(sensorCollection.createIndex).toHaveBeenCalledTimes(2);
  });
});
