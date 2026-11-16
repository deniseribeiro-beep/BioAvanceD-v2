/**
 * RF022 AC2, RNF031 C2 (Foundation plan F1.4): the Foundation job builds
 * every model index before the APIs start, and reports a failed build,
 * instead of leaving each one to the first request that touches its
 * collection (#941 proved every declared index has such a lazy build).
 *
 * The helpers below swallow their own errors by design, since their request
 * path must keep serving without a performance index. So each helper gets a
 * collection whose `createIndex` is recorded: the job learns every key spec
 * the helper asked for and whether the build succeeded, without changing
 * the helpers. `verifyFoundationIndexes` then reads the indexes back.
 */
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { ensureConfigurationReleaseIndexes } = require('../utils/configurationReleaseIndexes');
const {
  ensureCanonicalModelReleaseIndexes,
  ensureGovernanceInvariantCatalogIndexes,
  ensureConfigurationValidationRunIndexes,
} = require('../utils/governanceRegistryIndexes');
const {
  ensureContainerIndexes,
  ensureSpecimenContainerAssignmentIndexes,
  ensureContainerPositionAssignmentIndexes,
  ensureRackLocationAssignmentIndexes,
  ensureStorageLocationIndexes,
  ensureLabelIdentifierIndexes,
  ensureScanEventIndexes,
} = require('../utils/physicalChainIndexes');
const { ensureParticipantIdentityIndexes } = require('../utils/participantIdentityIndexes');
const { ensureSampleIndexes } = require('../utils/sampleIndexes');
const { ensurePatientLookupIndexes } = require('../utils/patientIndexes');
const { ensureSessionIndexes } = require('../utils/sessionIndexes');
const { ensureStagingImportIndexes } = require('../utils/stagingImportIndexes');
const { ensureTelemetryExposureSummaryIndexes } = require('../utils/telemetryExposureSummaryIndexes');
const {
  ensureStorageContainerIndexes,
  ensureStorageBoxIndexes,
  ensureSensorMetadataIndexes,
} = require('../utils/storageIndexes');
const { ensureBiomarkerAssociationIndexes } = require('../utils/biomarkerAssociationIndexes');
const { COLLECTION: BIOMARKER_ASSOCIATIONS } = require('../services/biomarkerAssociation.service');
const { ensureWorkflowRunIndexes } = require('../utils/workflowRunIndexes');
const { ensureTerminologyConceptIndexes, ensureTerminologyRelationIndexes } = require('../utils/terminologyIndexes');
const { WORKFLOW_RUN_COLLECTION } = require('../services/workflowRun.service');

// Collection names as each helper's own callers resolve them.
const INDEX_TARGETS = [
  { collection: CANONICAL_COLLECTIONS.participantIdentities, ensure: ensureParticipantIdentityIndexes },
  { collection: CANONICAL_COLLECTIONS.samples, ensure: ensureSampleIndexes },
  { collection: CANONICAL_COLLECTIONS.patients, ensure: ensurePatientLookupIndexes },
  { collection: 'sessions', ensure: ensureSessionIndexes },
  { collection: 'stagingImports', ensure: ensureStagingImportIndexes },
  { collection: 'storageContainers', ensure: ensureStorageContainerIndexes },
  { collection: 'storageBoxes', ensure: ensureStorageBoxIndexes },
  { collection: 'sensorMetadata', ensure: ensureSensorMetadataIndexes },
  { collection: CANONICAL_COLLECTIONS.configurationReleases, ensure: ensureConfigurationReleaseIndexes },
  { collection: CANONICAL_COLLECTIONS.canonicalModelReleases, ensure: ensureCanonicalModelReleaseIndexes },
  { collection: CANONICAL_COLLECTIONS.governanceInvariantCatalogs, ensure: ensureGovernanceInvariantCatalogIndexes },
  { collection: CANONICAL_COLLECTIONS.configurationValidationRuns, ensure: ensureConfigurationValidationRunIndexes },
  { collection: CANONICAL_COLLECTIONS.containers, ensure: ensureContainerIndexes },
  { collection: CANONICAL_COLLECTIONS.specimenContainerAssignments, ensure: ensureSpecimenContainerAssignmentIndexes },
  { collection: CANONICAL_COLLECTIONS.containerPositionAssignments, ensure: ensureContainerPositionAssignmentIndexes },
  { collection: CANONICAL_COLLECTIONS.rackLocationAssignments, ensure: ensureRackLocationAssignmentIndexes },
  { collection: CANONICAL_COLLECTIONS.storageLocations, ensure: ensureStorageLocationIndexes },
  { collection: CANONICAL_COLLECTIONS.labelIdentifiers, ensure: ensureLabelIdentifierIndexes },
  { collection: CANONICAL_COLLECTIONS.scanEvents, ensure: ensureScanEventIndexes },
  { collection: CANONICAL_COLLECTIONS.telemetryExposureSummaries, ensure: ensureTelemetryExposureSummaryIndexes },
  { collection: BIOMARKER_ASSOCIATIONS, ensure: ensureBiomarkerAssociationIndexes },
  { collection: WORKFLOW_RUN_COLLECTION, ensure: ensureWorkflowRunIndexes },
  { collection: CANONICAL_COLLECTIONS.terminologyConcepts, ensure: ensureTerminologyConceptIndexes },
  { collection: CANONICAL_COLLECTIONS.terminologyRelations, ensure: ensureTerminologyRelationIndexes },
];

function recordingCollection(collection, builds, collectionName) {
  return new Proxy(collection, {
    get(target, prop) {
      if (prop === 'createIndex') {
        return (keys, options = {}) => {
          const build = { collection: collectionName, keys, name: options.name || null, unique: options.unique === true, ok: null, error: null };
          builds.push(build);
          const pending = Promise.resolve().then(() => target.createIndex(keys, options));
          build.settled = pending.then(() => { build.ok = true; }, (error) => {
            build.ok = false;
            build.error = String(error?.message || error).slice(0, 300);
          });
          return pending;
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Runs every index helper against `db` and returns one record per
 * `createIndex` call: collection, keys, name, unique, ok, error.
 */
async function buildFoundationIndexes(db, targets = INDEX_TARGETS) {
  const builds = [];
  for (const target of targets) {
    const collection = recordingCollection(db.collection(target.collection), builds, target.collection);
    try {
      await target.ensure(collection);
    } catch (error) {
      // A helper that awaits its builds and throws (the configuration
      // release constraint does) has its failure on the build record
      // already; the job reports it rather than dying on it.
      // #1561: a helper that refuses a build before its createIndex (the
      // terminology natural keys, over duplicate rows) names that build on
      // the error, and it is recorded as failed with the helper's reason.
      if (error && error.indexBuild) {
        builds.push({
          collection: target.collection, ...error.indexBuild, ok: false, error: String(error.message), settled: Promise.resolve(),
        });
      }
    }
  }
  // A helper may fire a build without awaiting it; wait for every one.
  await Promise.all(builds.map((build) => build.settled));
  return builds.map(({ settled, ...build }) => build);
}

function sameKeys(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Reads each collection's indexes back and returns the builds whose key
 * spec is not present. An empty list is the postcondition.
 */
async function verifyFoundationIndexes(db, builds) {
  const missing = [];
  const byCollection = new Map();
  for (const build of builds) {
    if (!byCollection.has(build.collection)) {
      byCollection.set(build.collection, await db.collection(build.collection).listIndexes().toArray());
    }
    const present = byCollection.get(build.collection);
    if (!present.some((index) => sameKeys(index.key, build.keys))) missing.push(build);
  }
  return missing;
}

module.exports = { INDEX_TARGETS, buildFoundationIndexes, verifyFoundationIndexes, recordingCollection };
