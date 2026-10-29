/**
 * RF014 AC2, plano §4 F1.2 ("Uma release ativa por ambiente"): the
 * `configurationReleases` indexes.
 *
 * - `configurationReleases_active_profile_v1` is a correctness constraint,
 *   not a performance index: unique on profileId over the `active` rows
 *   only, so two concurrent saves cannot both leave an active release.
 *   Unlike the lookup helpers, its build is awaited and a failure is
 *   thrown, because a write that relies on it must not run without it.
 * - `{profileId:1, createdAt:-1, _id:-1}` serves the release history newest
 *   first, ties in insertion order.
 *
 * Built by the Foundation job (src/foundation/indexes.js) and ensured again
 * before the first release write in a process.
 */
const RELEASE_INDEXES = [
  [{ profileId: 1 }, { name: 'configurationReleases_active_profile_v1', unique: true, partialFilterExpression: { status: 'active' } }],
  [{ profileId: 1, createdAt: -1, _id: -1 }, { name: 'configurationReleases_profileId_createdAt_v1' }],
];

// Keyed by collection name: `db.collection()` returns a fresh handle per call.
const ensured = new Set();

async function ensureConfigurationReleaseIndexes(collection) {
  const name = collection.collectionName || collection.name;
  if (ensured.has(name)) return;
  for (const [keys, options] of RELEASE_INDEXES) {
    await collection.createIndex(keys, options);
  }
  ensured.add(name);
}

function resetConfigurationReleaseIndexLatch() {
  ensured.clear();
}

module.exports = { RELEASE_INDEXES, ensureConfigurationReleaseIndexes, resetConfigurationReleaseIndexLatch };
