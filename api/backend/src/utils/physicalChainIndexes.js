/**
 * #1314: the indexes of the normalized physical chain and of StorageLocation,
 * one helper per collection, each taking the collection, like
 * `utils/storageIndexes.js`.
 *
 * The partial unique indexes refuse two OPEN assignments on one key
 * (RF017 AC4, RULE-030, RULE-035) even where no transaction runs.
 *
 * ## Why these helpers neither latch nor catch
 *
 * `ensurePhysicalChainIndexes` and `ensureLocationIndexes` latch per db and
 * log one warning for a failed build; they call these helpers in order and
 * keep both, so their behaviour is what it was. A caller that writes the
 * chain inside a transaction (`legacyPlacementChain.service.js`) never
 * builds an index there: an index build next to an open transaction is a
 * write conflict. It runs these helpers before it opens the transaction.
 */
const OPEN = { assignmentStatus: 'active' };

function canIndex(collection) {
  return Boolean(collection) && typeof collection.createIndex === 'function';
}

async function ensureContainerIndexes(collection) {
  if (!canIndex(collection)) return;
  await collection.createIndex({ containerId: 1 }, { unique: true, name: 'uniq_containerId' });
}

async function ensureSpecimenContainerAssignmentIndexes(collection) {
  if (!canIndex(collection)) return;
  await collection.createIndex({ specimenId: 1 }, { unique: true, name: 'uniq_open_specimen', partialFilterExpression: OPEN });
  await collection.createIndex({ containerId: 1 });
}

async function ensureContainerPositionAssignmentIndexes(collection) {
  if (!canIndex(collection)) return;
  await collection.createIndex({ containerId: 1 }, { unique: true, name: 'uniq_open_container', partialFilterExpression: OPEN });
  await collection.createIndex({ storagePositionId: 1 }, { unique: true, name: 'uniq_open_position', partialFilterExpression: OPEN });
}

async function ensureRackLocationAssignmentIndexes(collection) {
  if (!canIndex(collection)) return;
  await collection.createIndex({ storageRackId: 1 }, { unique: true, name: 'uniq_open_rack', partialFilterExpression: OPEN });
}

async function ensureStorageLocationIndexes(collection) {
  if (!canIndex(collection)) return;
  await collection.createIndex({ storageLocationId: 1 }, { unique: true, name: 'uniq_storageLocationId' });
  await collection.createIndex({ organizationId: 1 });
}

module.exports = {
  ensureContainerIndexes,
  ensureSpecimenContainerAssignmentIndexes,
  ensureContainerPositionAssignmentIndexes,
  ensureRackLocationAssignmentIndexes,
  ensureStorageLocationIndexes,
};
