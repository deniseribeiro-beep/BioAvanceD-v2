const logger = require('./logger');

/**
 * #941 / #830: the `stagingImports.jobId` unique index and native collection
 * accessor. StagingImport is reached only through the native driver (no
 * Mongoose model) so the import path shares one connection concept with
 * import_batches / import_staging_records.
 *
 * ## Why this one is the LOOKUP index first and the constraint second
 *
 * `jobId` is a `uuidv4()` minted in `createStagingImport`, the collection's
 * only writer, so a collision is not a real failure mode and the `unique` half
 * guards little on its own. The reads are the point -- keyed operations
 * resolve a staging import by `jobId`.
 *
 * ## Failure posture and the latch
 *
 * Best-effort and self-latched. It logs rather than swallowing: the failure
 * that matters is an `E11000`, meaning duplicate `jobId`s are already stored
 * and need a repair migration before the constraint can hold.
 */
const stagingImportsIndexed = new Set();

const STAGING_IMPORTS_COLLECTION = 'stagingImports';

/**
 * #830: native-driver handle for the stagingImports collection.
 * @param {import('mongodb').Db} db
 */
function getStagingImportsCollection(db) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('getStagingImportsCollection requires a native MongoDB Db');
  }
  return db.collection(STAGING_IMPORTS_COLLECTION);
}

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

module.exports = {
  ensureStagingImportIndexes,
  getStagingImportsCollection,
  STAGING_IMPORTS_COLLECTION,
};
