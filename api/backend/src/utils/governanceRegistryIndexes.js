/**
 * #1304 (plano §4 F1.2, F1.10): the indexes of the governance registry.
 *
 * - `canonicalModelReleases_id_v1` and
 *   `governanceInvariantCatalogs_release_version_v1` are constraints: one
 *   record per release id, one catalog per release and catalog version, so
 *   two Foundation runs cannot register the same release twice.
 * - `configurationValidationRuns_releaseId_executedAt_v1` serves "the
 *   newest validation run of this release", which activation and the
 *   Foundation `configuration` gate read.
 *
 * Their builds are awaited and a failure is thrown, like the configuration
 * release constraint, because the writes that rely on them must not run
 * without them. Built by the Foundation job (src/foundation/indexes.js) and
 * ensured again before the first write in a process.
 */
const CANONICAL_MODEL_RELEASE_INDEXES = [
  [{ canonicalModelReleaseId: 1 }, { name: 'canonicalModelReleases_id_v1', unique: true }],
];
const GOVERNANCE_INVARIANT_CATALOG_INDEXES = [
  [{ canonicalModelReleaseId: 1, semanticVersion: 1 }, { name: 'governanceInvariantCatalogs_release_version_v1', unique: true }],
];
const CONFIGURATION_VALIDATION_RUN_INDEXES = [
  [{ releaseId: 1, executedAt: -1 }, { name: 'configurationValidationRuns_releaseId_executedAt_v1' }],
];

// Keyed by collection name: `db.collection()` returns a fresh handle per call.
const ensured = new Set();

function ensurer(specs) {
  return async function ensure(collection) {
    const name = collection.collectionName || collection.name;
    if (ensured.has(name)) return;
    for (const [keys, options] of specs) {
      await collection.createIndex(keys, options);
    }
    ensured.add(name);
  };
}

function resetGovernanceRegistryIndexLatch() {
  ensured.clear();
}

module.exports = {
  CANONICAL_MODEL_RELEASE_INDEXES,
  GOVERNANCE_INVARIANT_CATALOG_INDEXES,
  CONFIGURATION_VALIDATION_RUN_INDEXES,
  ensureCanonicalModelReleaseIndexes: ensurer(CANONICAL_MODEL_RELEASE_INDEXES),
  ensureGovernanceInvariantCatalogIndexes: ensurer(GOVERNANCE_INVARIANT_CATALOG_INDEXES),
  ensureConfigurationValidationRunIndexes: ensurer(CONFIGURATION_VALIDATION_RUN_INDEXES),
  resetGovernanceRegistryIndexLatch,
};
