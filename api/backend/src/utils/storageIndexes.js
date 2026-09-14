const logger = require('./logger');

const storageContainersIndexed = new Set();
const storageBoxesIndexed = new Set();
const sensorMetadataIndexed = new Set();
const facilityRoomIndexed = new Set();

async function createIndexesBestEffort(collection, definitions, label) {
  if (!collection || typeof collection.createIndex !== 'function') return;
  for (const [keys, options] of definitions) {
    try {
      await collection.createIndex(keys, options);
    } catch (error) {
      logger.warn(`[${label}][INDEX] Não foi possível criar ${options.name} (#941): ${error?.message || error}`);
    }
  }
}

async function ensureStorageContainerIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;
  const name = collection.collectionName || 'storageContainers';
  if (storageContainersIndexed.has(name)) return;
  storageContainersIndexed.add(name);

  await createIndexesBestEffort(collection, [
    [
      { containerID: 1 },
      {
        name: 'storage_containers_containerid_unique_v1',
        unique: true,
        partialFilterExpression: { containerID: { $type: 'string' } }
      }
    ],
    [
      { containerType: 1, status: 1, name: 1 },
      { name: 'storage_containers_type_status_name_v1' }
    ],
    [
      { parent_id: 1, containerType: 1, name: 1 },
      { name: 'storage_containers_parent_type_name_v1' }
    ]
  ], 'STORAGE');
}

async function ensureStorageBoxIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;
  const name = collection.collectionName || 'storageBoxes';
  if (storageBoxesIndexed.has(name)) return;
  storageBoxesIndexed.add(name);

  // The live tree query filters by parent_id and sorts by name. The old
  // Mongoose declarations ({parent_id,status} and {name}) matched neither
  // operation as a compound access path.
  await createIndexesBestEffort(collection, [
    [
      { parent_id: 1, name: 1 },
      { name: 'storage_boxes_parent_name_v1' }
    ]
  ], 'STORAGE_BOX');
}

async function ensureSensorMetadataIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;
  const name = collection.collectionName || 'sensorMetadata';
  if (sensorMetadataIndexed.has(name)) return;
  sensorMetadataIndexed.add(name);

  // sensorId is the actual upsert identity. macAddress is metadata, not an
  // identity key in any runtime read/write path, so no uniqueness constraint
  // is invented for it.
  await createIndexesBestEffort(collection, [
    [
      { sensorId: 1 },
      {
        name: 'sensor_metadata_sensorid_unique_v1',
        unique: true
      }
    ]
  ], 'SENSOR_METADATA');
}

async function ensureFacilityRoomIndexes(db) {
  if (!db || typeof db.collection !== 'function') return;
  const dbName = db.databaseName || 'default';
  if (facilityRoomIndexed.has(dbName)) return;
  facilityRoomIndexed.add(dbName);

  await createIndexesBestEffort(db.collection('facilities'), [
    [{ deletedAt: 1, name: 1 }, { name: 'facilities_active_name_v1' }]
  ], 'FACILITY');
  await createIndexesBestEffort(db.collection('rooms'), [
    [{ facilityId: 1, deletedAt: 1, name: 1 }, { name: 'rooms_facility_active_name_v1' }]
  ], 'ROOM');
}

async function ensureStorageConfigurationIndexes(db) {
  if (!db || typeof db.collection !== 'function') return;
  await Promise.all([
    ensureStorageContainerIndexes(db.collection('storageContainers')),
    ensureStorageBoxIndexes(db.collection('storageBoxes')),
    ensureFacilityRoomIndexes(db)
  ]);
}

module.exports = {
  ensureStorageContainerIndexes,
  ensureStorageBoxIndexes,
  ensureSensorMetadataIndexes,
  ensureFacilityRoomIndexes,
  ensureStorageConfigurationIndexes
};
