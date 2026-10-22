/**
 * RF029 (#1318): the entity types the production ingestion route persists,
 * keyed by `entityType`. Each names the canonical schema the gateway
 * validates against, the store and collection an accepted record lands in,
 * its id field and the model whose validate()/create() it goes through.
 * `missingnessFields` are the fields outside the schema's `required`, less
 * the id field: an absent one gets a MissingDataReason (RF029 AC7,
 * missingness.js).
 *
 * Telemetry and binaries are deliberately absent: they have their own stores
 * and paths, and a later slice names them in the refusal.
 */
const INGESTION_TARGETS = Object.freeze({
  Dataset: Object.freeze({
    schemaId: 'canonical.v1.dataset',
    store: 'mongodb',
    collection: 'datasets',
    idField: 'datasetId',
    model: require('../models/Dataset'),
    missingnessFields: Object.freeze(['doi', 'distributionFiles', 'roCrateManifest']),
  }),
  WorkflowRun: Object.freeze({
    schemaId: 'canonical.v1.workflow',
    store: 'mongodb',
    collection: 'workflowRuns',
    idField: 'workflowRunId',
    model: require('../models/WorkflowRun'),
    missingnessFields: Object.freeze(['containerImageDigest', 'softwareDependencies', 'parameters', 'inputFileIds', 'outputFileIds', 'completedAt', 'randomSeed', 'datasetSnapshotId']),
  }),
});

/** The target for `entityType`, or null: an own-property check, so `__proto__` or `toString` names nothing. */
function resolveIngestionTarget(entityType) {
  if (typeof entityType !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(INGESTION_TARGETS, entityType) ? INGESTION_TARGETS[entityType] : null;
}

module.exports = { INGESTION_TARGETS, resolveIngestionTarget };
