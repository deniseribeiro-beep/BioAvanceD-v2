/**
 * #1561 (RF028): the natural-key indexes of TerminologyConcept
 * (systemUri + code + version) and TerminologyRelation (sourceConceptId +
 * targetConceptId + relationType + relationVersion), the keys
 * referenceRelease.service.js's promotion looks each record up by. Helpers
 * taking the collection, like `utils/workflowRunIndexes.js`. They neither
 * latch nor catch: the Foundation job builds them before the APIs start,
 * and promoteRelease builds them again before its first record write.
 */
function canIndex(collection) {
  return Boolean(collection) && typeof collection.createIndex === 'function';
}

// How many duplicate natural keys a refused build names.
const DUPLICATE_KEY_REPORT_LIMIT = 5;

/**
 * A unique build over rows that already share a key fails with a bare
 * duplicate-key error. Before the build, this groups the collection on the
 * index's keys and, where any group holds more than one row, throws an
 * error naming up to DUPLICATE_KEY_REPORT_LIMIT of those keys with their
 * row counts, and the runbook section that removes them. A collection
 * without `aggregate` is not checked.
 */
async function refuseDuplicateKeys(collection, keys, name) {
  if (typeof collection.aggregate !== 'function') return;
  const fields = Object.keys(keys);
  const duplicates = await collection.aggregate([
    { $group: { _id: Object.fromEntries(fields.map((field) => [field, `$${field}`])), count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: DUPLICATE_KEY_REPORT_LIMIT },
  ], { allowDiskUse: true }).toArray();
  if (duplicates.length === 0) return;
  const listed = duplicates.map((group) => `${JSON.stringify(group._id)} x${group.count}`).join('; ');
  const error = new Error(
    `${name} not built: rows share its natural key (${fields.join(', ')}), first ${duplicates.length}: ${listed}. ` +
    'Keep one row per key, as docs/operations/troubleshooting-runbook.md section 1.4 shows, and re-run.',
  );
  error.code = 'DUPLICATE_NATURAL_KEY';
  throw error;
}

// MongoDB answers listIndexes on a collection that does not exist yet with
// NamespaceNotFound (code 26): it has no index.
const NAMESPACE_NOT_FOUND = 26;

/**
 * Whether the collection already holds a unique index on exactly `keys`.
 * Rows cannot then share a key, so neither the duplicate scan nor the build
 * is needed. A collection without `listIndexes` reads as having none.
 */
async function hasUniqueIndex(collection, keys) {
  if (typeof collection.listIndexes !== 'function') return false;
  let present;
  try {
    present = await collection.listIndexes().toArray();
  } catch (error) {
    if (error && error.code === NAMESPACE_NOT_FOUND) return false;
    throw error;
  }
  const wanted = JSON.stringify(keys);
  return present.some((index) => index.unique === true && JSON.stringify(index.key) === wanted);
}

/**
 * Builds the unique index unless it is already there, refusing over
 * duplicate rows first. Any error before createIndex (the duplicate refusal,
 * or the index read or the scan failing) carries the build it stopped
 * (`indexBuild`), so the Foundation job records a failed unique build with
 * that error's message rather than no build at all.
 */
async function ensureUniqueNaturalKey(collection, keys, name) {
  if (!canIndex(collection)) return;
  try {
    if (await hasUniqueIndex(collection, keys)) return;
    await refuseDuplicateKeys(collection, keys, name);
  } catch (error) {
    if (error && typeof error === 'object' && !error.indexBuild) error.indexBuild = { keys, name, unique: true };
    throw error;
  }
  await collection.createIndex(keys, { unique: true, name });
}

async function ensureTerminologyConceptIndexes(collection) {
  await ensureUniqueNaturalKey(collection, { systemUri: 1, code: 1, version: 1 }, 'uniq_terminologyConcept_systemUri_code_version');
}

async function ensureTerminologyRelationIndexes(collection) {
  await ensureUniqueNaturalKey(
    collection,
    { sourceConceptId: 1, targetConceptId: 1, relationType: 1, relationVersion: 1 },
    'uniq_terminologyRelation_source_target_type_version',
  );
}

module.exports = { ensureTerminologyConceptIndexes, ensureTerminologyRelationIndexes, DUPLICATE_KEY_REPORT_LIMIT };
