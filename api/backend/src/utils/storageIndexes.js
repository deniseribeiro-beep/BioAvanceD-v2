const logger = require('./logger');
const { buildLookupIndex } = require('./lookupIndex');
const { dropLegacyIndex } = require('./legacyIndex');

/**
 * #941: unique indexes on `storageContainers.containerID`,
 * `sensorMetadata.sensorId` and `sensorMetadata.macAddress`.
 *
 * `StorageContainer.js` and `SensorMetadata.schema.js` have declared these
 * constraints all along (`containerID: { unique: true, sparse: true }` and
 * `SensorMetadataSchema.index({ sensorId: 1 }, { unique: true })`) and
 * neither declaration ever reaches Mongo:
 * `infrastructure/database/mongodb/connection.js:26` connects with
 * `autoIndex: false`, and nothing anywhere calls `syncIndexes()` or
 * `createIndexes()` on a mongoose model. So a schema-level `unique: true`
 * would have been a no-op that reads as a fix. This is the native-driver
 * equivalent, wired at the write path -- see `utils/sampleIndexes.js` for
 * the precedent this copies.
 *
 * ## Why `storageContainers.containerID` needs `$type: 'string'`
 *
 * `findOrCreateFreezer` in `location-storage-backfill.service.js` writes a
 * real `containerID`, but the SHELF/RACK/DRAWER path in `findOrCreateContainer`
 * in the same file never sets the field at all. A plain unique index would
 * collide on the second container created without one. `$type: 'string'`
 * indexes only the rows that carry a real `containerID`, the same shape
 * `sampleIndexes.js` uses on `samples.barcode` and for the same reason.
 *
 * ## Why `sensorMetadata.sensorId` needs no partial filter
 *
 * `sensorId` is `required: true` on `SensorMetadata.schema.js` -- every row
 * has one, so a plain unique index is correct. It is also the upsert FILTER
 * key in `linkSensorMetadata`, so it structurally cannot be absent.
 *
 * ## Why `sensorMetadata.macAddress` DOES need one
 *
 * `macAddress` is `required: true` on the schema too, but that is a mongoose
 * validator and every write to this collection goes through the NATIVE
 * driver (`updateOne` on the raw collection), which never runs it. Unlike
 * `sensorId` it is not the upsert filter key either -- it reaches the
 * document only through `$set`, behind an `if (sensor.macAddress)` guard
 * that lives in the CALLER (`createSensor`), not in `linkSensorMetadata`'s
 * own contract. So a row without one is a shape the schema forbids and the
 * database permits, and a plain unique index would reject the second such
 * row. `$type: 'string'` constrains exactly the rows carrying a real value.
 *
 * ## Failure posture
 *
 * Best-effort, like `ensureSampleIndexes` -- a failed index build must not
 * take down storage-container or sensor-metadata writes. But it **logs**
 * rather than swallowing: the one failure that matters is `E11000` on an
 * already-duplicated `containerID`/`sensorId`, which would mean a live
 * unguarded check-then-insert (storage containers) or upsert race (sensor
 * metadata) already produced a duplicate that needs a repair migration
 * before the constraint can hold. A silent catch would make that invisible.
 *
 * ## The latch
 *
 * Unlike `ensureSampleIndexes`, which is latched externally by
 * `collectionResolver.js` (these two collections never pass through that
 * resolver -- see the module-level doc comment on this file's caller side),
 * each function here latches itself, keyed by `collection.collectionName`
 * (the resolved name, mirroring `collectionResolver.js`'s `samplesIndexed`
 * Set), so both call sites stay a single, un-awaited line.
 */
// #941: collection names whose indexes have already been ensured this
// process, one Set per collection kind so a storageContainers name and a
// sensorMetadata name never shadow one another.
const storageContainersIndexed = new Set();
const sensorMetadataIndexed = new Set();
const storageBoxesIndexed = new Set();

// #941: `buildLookupIndex` moved to utils/lookupIndex.js when
// facilityIndexes.js needed the same builder -- one copy, because the
// failure MESSAGE is the part that matters and a second copy would drift.

async function ensureStorageContainerIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;

  const name = collection.collectionName;
  if (storageContainersIndexed.has(name)) return;
  storageContainersIndexed.add(name);

  // #1164: `$gt: ''`, not `$type: 'string'`. Both keep missing/null rows
  // out (comparisons are type-bracketed, so `$gt: ''` means "a non-empty
  // string"), but the planner cannot prove a plain equality implies a
  // `$type` filter, so the `$type` version enforced uniqueness while never
  // serving a single lookup. The new name is built FIRST, then the
  // superseded one dropped, so the constraint never has a gap.
  try {
    await collection.createIndex(
      { containerID: 1 },
      {
        name: 'storage_containers_containerid_unique_v2',
        unique: true,
        partialFilterExpression: { containerID: { $gt: '' } }
      }
    );
    // Only once the replacement exists: a failed build keeps the old constraint.
    await dropLegacyIndex(collection, 'storage_containers_containerid_unique_v1', 'STORAGE');
  } catch (error) {
    logger.warn(
      '[STORAGE][INDEX] Não foi possível criar storage_containers_containerid_unique_v2 (#941). '
        + 'Um E11000 aqui significa containerID duplicados já gravados -- '
        + 'a unicidade segue apenas em nível de aplicação até que sejam corrigidos: '
        + (error?.message || error)
    );
  }

  // #941: BUILD, taken from the planner. `listOperationalFreezers` issues
  // find({containerType:'FREEZER',status:'OPERATIONAL'}) verbatim.
  await buildLookupIndex(
    collection, { containerType: 1, status: 1 },
    'storage_containers_type_status_idx_v1', 'STORAGE'
  );

  // #941: BUILD. The shelf/rack tree walk -- MongoStorageTopologyReadRepository,
  // TelemetryMonitor and equipment-sensor-quarantine.service all issue
  // find({parent_id, containerType}), the second of them per reading.
  await buildLookupIndex(
    collection, { parent_id: 1, containerType: 1 },
    'storage_containers_parent_type_idx_v1', 'STORAGE'
  );
}

/**
 * #941: the storageBoxes lookup index.
 *
 * No unique constraint here -- `StorageBox.js` declares none at HEAD (its
 * former boxID unique+sparse line is gone). This exists for the one lookup
 * the planner measurably uses, so the helper is deliberately not modelled on
 * the unique ones above.
 */
async function ensureStorageBoxIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;

  const name = collection.collectionName;
  if (storageBoxesIndexed.has(name)) return;
  storageBoxesIndexed.add(name);

  // #941: BUILD. Winning plan for BOTH storageBoxes shapes in src/ --
  // the topology walk's find({parent_id}).sort({name:1}) and
  // TelemetryMonitor's find({parent_id:{$in:rackIds}}). A compound index
  // serves its own prefix, so the status suffix costs those nothing.
  await buildLookupIndex(
    collection, { parent_id: 1, status: 1 },
    'storage_boxes_parent_status_idx_v1', 'STORAGE'
  );
}

async function ensureSensorMetadataIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;

  const name = collection.collectionName;
  if (sensorMetadataIndexed.has(name)) return;
  sensorMetadataIndexed.add(name);

  try {
    await collection.createIndex(
      { sensorId: 1 },
      {
        name: 'sensor_metadata_sensorid_unique_v1',
        unique: true
      }
    );
  } catch (error) {
    logger.warn(
      '[SENSOR_METADATA][INDEX] Não foi possível criar sensor_metadata_sensorid_unique_v1 (#941). '
        + 'Um E11000 aqui significa sensorId duplicados já gravados -- '
        + 'a unicidade segue apenas em nível de aplicação (upsert) até que sejam corrigidos: '
        + (error?.message || error)
    );
  }

  // #941: macAddress carries its OWN try/catch rather than sharing the one
  // above. A single catch around both builds would let a failure on the
  // first index skip the second silently -- the exact shape #1027 corrected
  // in create-db.js, where one throw cost 46 index builds.
  // #1164: `$gt: ''`, not `$type: 'string'`. Both keep missing/null rows
  // out (comparisons are type-bracketed, so `$gt: ''` means "a non-empty
  // string"), but the planner cannot prove a plain equality implies a
  // `$type` filter, so the `$type` version enforced uniqueness while never
  // serving a single lookup. The new name is built FIRST, then the
  // superseded one dropped, so the constraint never has a gap.
  try {
    await collection.createIndex(
      { macAddress: 1 },
      {
        name: 'sensor_metadata_macaddress_unique_v2',
        unique: true,
        partialFilterExpression: { macAddress: { $gt: '' } }
      }
    );
    // Only once the replacement exists: a failed build keeps the old constraint.
    await dropLegacyIndex(collection, 'sensor_metadata_macaddress_unique_v1', 'SENSOR_METADATA');
  } catch (error) {
    logger.warn(
      '[SENSOR_METADATA][INDEX] Não foi possível criar sensor_metadata_macaddress_unique_v2 (#941). '
        + 'Um E11000 aqui significa macAddress duplicados já gravados -- '
        + 'o erro "macAddress duplicado" que sensor.service.js documenta segue '
        + 'impossível de produzir até que sejam corrigidos: '
        + (error?.message || error)
    );
  }
}

module.exports = {
  ensureStorageContainerIndexes,
  ensureStorageBoxIndexes,
  ensureSensorMetadataIndexes
};
