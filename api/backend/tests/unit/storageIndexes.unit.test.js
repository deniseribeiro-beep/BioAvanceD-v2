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

describe('#941 executable native index policy', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('materializes the freezer identity and the two live storageContainer query shapes', async () => {
    const { ensureStorageContainerIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageContainers');

    await ensureStorageContainerIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledTimes(3);
    expect(collection.createIndex).toHaveBeenNthCalledWith(1,
      { containerID: 1 },
      expect.objectContaining({ name: 'storage_containers_containerid_unique_v1', unique: true })
    );
    expect(collection.createIndex).toHaveBeenNthCalledWith(2,
      { containerType: 1, status: 1, name: 1 },
      { name: 'storage_containers_type_status_name_v1' }
    );
    expect(collection.createIndex).toHaveBeenNthCalledWith(3,
      { parent_id: 1, containerType: 1, name: 1 },
      { name: 'storage_containers_parent_type_name_v1' }
    );
  });

  it('materializes the storageBox parent+name tree access path', async () => {
    const { ensureStorageBoxIndexes } = freshStorageIndexes();
    const collection = makeCollection('storageBoxes');

    await ensureStorageBoxIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledOnce();
    expect(collection.createIndex).toHaveBeenCalledWith(
      { parent_id: 1, name: 1 },
      { name: 'storage_boxes_parent_name_v1' }
    );
  });

  it('materializes only sensorId as unique identity, never macAddress', async () => {
    const { ensureSensorMetadataIndexes } = freshStorageIndexes();
    const collection = makeCollection('sensorMetadata');

    await ensureSensorMetadataIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledOnce();
    expect(collection.createIndex).toHaveBeenCalledWith(
      { sensorId: 1 },
      { name: 'sensor_metadata_sensorid_unique_v1', unique: true }
    );
    expect(JSON.stringify(collection.createIndex.mock.calls)).not.toContain('macAddress');
  });

  it('materializes Facility/Room indexes that match active-list and scoped-room queries', async () => {
    const { ensureFacilityRoomIndexes } = freshStorageIndexes();
    const facilities = makeCollection('facilities');
    const rooms = makeCollection('rooms');
    const db = {
      databaseName: 'bioavanced_test',
      collection: vi.fn((name) => name === 'facilities' ? facilities : rooms)
    };

    await ensureFacilityRoomIndexes(db);

    expect(facilities.createIndex).toHaveBeenCalledWith(
      { deletedAt: 1, name: 1 },
      { name: 'facilities_active_name_v1' }
    );
    expect(rooms.createIndex).toHaveBeenCalledWith(
      { facilityId: 1, deletedAt: 1, name: 1 },
      { name: 'rooms_facility_active_name_v1' }
    );
  });

  it('latches each collection so repeated calls do not rebuild indexes', async () => {
    const { ensureStorageContainerIndexes, ensureStorageBoxIndexes, ensureSensorMetadataIndexes } = freshStorageIndexes();
    const containers = makeCollection('storageContainers');
    const boxes = makeCollection('storageBoxes');
    const sensors = makeCollection('sensorMetadata');

    await ensureStorageContainerIndexes(containers);
    await ensureStorageContainerIndexes(containers);
    await ensureStorageBoxIndexes(boxes);
    await ensureStorageBoxIndexes(boxes);
    await ensureSensorMetadataIndexes(sensors);
    await ensureSensorMetadataIndexes(sensors);

    expect(containers.createIndex).toHaveBeenCalledTimes(3);
    expect(boxes.createIndex).toHaveBeenCalledTimes(1);
    expect(sensors.createIndex).toHaveBeenCalledTimes(1);
  });

  it('logs failures instead of silently swallowing index build problems', async () => {
    const { ensureSensorMetadataIndexes } = freshStorageIndexes();
    const logger = require('../../src/utils/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const sensors = makeCollection('sensorMetadata', async () => { throw new Error('E11000 duplicate key'); });

    await expect(ensureSensorMetadataIndexes(sensors)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('#941');
  });
});
