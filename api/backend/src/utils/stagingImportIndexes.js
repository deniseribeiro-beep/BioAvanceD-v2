const logger = require('./logger');

/**
 * #941: the `stagingImports.jobId` unique index.
 *
 * #830: the Mongoose model this header describes (`StagingImport.js`) is
 * retired. The collection is reached through `services/stagingImport.store.js`
 * on the native driver, which calls this helper on every collection handle it
 * resolves, so every reader and writer requests the index, not only
 * `createStagingImport`. The #941 reasoning below is kept as recorded.
 *
 * `StagingImport.js` has declared `jobId: { unique: true }` since the model was
 * written, and that declaration never reaches Mongo:
 * `infrastructure/database/mongodb/connection.js:26` connects with
 * `autoIndex: false` and nothing anywhere calls `syncIndexes()` or
 * `createIndexes()` on a mongoose model. So the schema-level `unique: true`
 * is a no-op that reads as a guarantee. This is the native-driver equivalent,
 * wired at the write path -- the shape `utils/sampleIndexes.js` established
 * and `utils/storageIndexes.js` copied.
 *
 * `stagingImports` is the one collection in #941's set on a genuine mongoose
 * write path: `staging-import.service.js#createStagingImport` calls
 * `StagingImport.create()`. The other two are reached through the raw driver.
 *
 * ## Why this one is the LOOKUP index first and the constraint second
 *
 * `jobId` is a `uuidv4()` minted in `createStagingImport`, the collection's
 * only writer, so a collision is not a real failure mode and the `unique` half
 * guards little on its own. The reads are the point -- four keyed operations
 * resolve a staging import by `jobId`, and every one is a collection scan
 * today:
 *
 *   - `import-batch.controller.js:131`           findOne({ jobId })
 *   - `batch-validation-engine.service.js:890`   updateOne({ jobId }, ...)
 *   - `batch-validation-engine.service.js:923`   updateOne({ jobId }, ...)
 *   - `batch-validation-engine.service.js:1076`  findOne({ jobId: stagingImportId })
 *
 * `unique: true` is kept rather than reduced to a plain lookup index because
 * the schema already declares it. An index built non-unique would leave
 * `StagingImport.js` reading as a guarantee while enforcing nothing, which is
 * the exact trap #941 exists to close -- one level down instead of up.
 *
 * ## Why no partial filter
 *
 * Unlike `storageContainers.containerID`, `jobId` is `required: true` on the
 * schema and is always set by the single writer, so every row carries one and
 * a plain unique index is correct. This is the `sensorMetadata.sensorId` case,
 * not the `samples.barcode` one.
 *
 * ## Failure posture and the latch
 *
 * Best-effort and self-latched, both per `utils/storageIndexes.js`. It logs
 * rather than swallowing: the failure that matters is an `E11000`, meaning
 * duplicate `jobId`s are already stored and need a repair migration before the
 * constraint can hold. A silent catch would make that invisible.
 *
 * `stagingImports` does not pass through `utils/collectionResolver.js` -- it is
 * absent from `CANONICAL_COLLECTIONS` and reached only through the mongoose
 * model -- so the latch lives here rather than there, the same reason
 * `storageIndexes.js` gives for its own.
 */
// #941: collection names whose indexes have already been ensured this process,
// keyed by resolved name, mirroring `collectionResolver.js`'s `samplesIndexed`.
const stagingImportsIndexed = new Set();

async function ensureStagingImportIndexes(collection) {
  if (!collection || typeof collection.createIndex !== 'function') return;

  const name = collection.collectionName;
  if (stagingImportsIndexed.has(name)) return;
  stagingImportsIndexed.add(name);

  try {
    await collection.createIndex(
      { jobId: 1 },
      {
        name: 'staging_imports_jobid_unique_v1',
        unique: true
      }
    );
  } catch (error) {
    logger.warn(
      '[STAGING_IMPORT][INDEX] Não foi possível criar staging_imports_jobid_unique_v1 (#941). '
        + 'Um E11000 aqui significa jobId duplicados já gravados -- '
        + 'as buscas por jobId seguem em collection scan até que sejam corrigidos: '
        + (error?.message || error)
    );
  }
}

module.exports = { ensureStagingImportIndexes };
