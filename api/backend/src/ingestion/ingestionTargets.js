/**
 * RF029 (#1318): the entity types the production ingestion route persists,
 * keyed by `entityType`. Each names the canonical schema the gateway
 * validates against, the store and collection an accepted record lands in,
 * its id field and the model whose validate()/create() it goes through.
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
  }),
  WorkflowRun: Object.freeze({
    schemaId: 'canonical.v1.workflow',
    store: 'mongodb',
    collection: 'workflowRuns',
    idField: 'workflowRunId',
    model: require('../models/WorkflowRun'),
  }),
});

/** The target for `entityType`, or null: an own-property check, so `__proto__` or `toString` names nothing. */
function resolveIngestionTarget(entityType) {
  if (typeof entityType !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(INGESTION_TARGETS, entityType) ? INGESTION_TARGETS[entityType] : null;
}

module.exports = { INGESTION_TARGETS, resolveIngestionTarget };
