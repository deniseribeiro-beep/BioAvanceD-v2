/**
 * RF029 (#1318): the entity types the production ingestion route persists,
 * keyed by `entityType`. Each names the canonical schema the gateway
 * validates against, the store and collection an accepted record lands in,
 * its id field and the model whose validate()/create() it goes through.
 * `missingnessFields` are the fields outside the schema's `required`, less
 * the id field: an absent one gets a MissingDataReason (RF029 AC7,
 * missingness.js).
 *
 * OmicsQualification is the third target, a MongoDB entity like the other
 * two (docs/decisions/2026-10-23-ingestion-omics-qualification-target.md).
 *
 * Assay is the fourth, and the one target with gates of its own, the two its
 * master-data mount enforces (app.js `/api/assays`): `validateReferences`
 * resolves its references before the write (#1219, RF019), and `scopeField`
 * names the field #1182 organization scope reads
 * (docs/decisions/2026-10-23-ingestion-assay-target.md).
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
  OmicsQualification: Object.freeze({
    schemaId: 'canonical.v1.omicsQualification',
    store: 'mongodb',
    collection: 'omicsQualifications',
    idField: 'omicsQualificationId',
    model: require('../models/OmicsQualification'),
    missingnessFields: Object.freeze(['limitations']),
  }),
  Assay: Object.freeze({
    schemaId: 'canonical.v1.assay',
    store: 'mongodb',
    collection: 'assays',
    idField: 'assayId',
    model: require('../models/Assay'),
    missingnessFields: Object.freeze(['omicsDomain', 'assayBatchId', 'controls', 'reagentLotIds', 'equipmentIds']),
    validateReferences: require('../services/assayReferenceValidator').validateAssayReferences,
    scopeField: 'laboratoryId',
  }),
});

/** The target for `entityType`, or null: an own-property check, so `__proto__` or `toString` names nothing. */
function resolveIngestionTarget(entityType) {
  if (typeof entityType !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(INGESTION_TARGETS, entityType) ? INGESTION_TARGETS[entityType] : null;
}

module.exports = { INGESTION_TARGETS, resolveIngestionTarget };
