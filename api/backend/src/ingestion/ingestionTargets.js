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
 * OmicsRun is the fifth, for its MongoDB modalities only. Its `otherStore`
 * key names the field and the values whose v2 entity is stored elsewhere
 * (TranscriptomicsRun, ProteomicsRun and MetabolomicsRun in Object
 * Storage): such a record is refused, never written to MongoDB (RF029 AC4,
 * docs/decisions/2026-10-23-ingestion-omics-run-target.md).
 *
 * Specimen is the sixth, stored in samples. Its `validateReferences` runs the
 * sample mount's participant, consent, site, parent and barcode gates, the
 * consent one failing closed (RF029 AC2), and `scopeField` is
 * `collectionSite`. Three keys only it carries: `organizationField` names the
 * #1192 tenancy field stamped from the in-scope `scopeField` value,
 * `generateId` assigns the mount's 7-digit specimenId instead of a uuid, and
 * `appendProjection` appends SPECIMEN_UPSERTED and LINEAGE_REGISTERED in the
 * insert's transaction (#1313,
 * docs/decisions/2026-10-23-ingestion-specimen-target.md).
 *
 * Telemetry and binaries are deliberately absent: they have their own stores
 * and paths, and a later slice names them in the refusal.
 */
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { generateSpecimenId, validateSpecimenReferences, appendSpecimenProjection } = require('./specimenTarget');

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
  OmicsRun: Object.freeze({
    schemaId: 'canonical.v1.omicsRun',
    store: 'mongodb',
    collection: 'omicsRuns',
    idField: 'omicsRunId',
    model: require('../models/OmicsRun'),
    missingnessFields: Object.freeze(['referenceAssembly', 'mixsChecklist', 'fileLinks']),
    otherStore: Object.freeze({ field: 'modality', values: Object.freeze(['transcriptomics', 'proteomics', 'metabolomics']), store: 'objectStorage' }),
  }),
  Specimen: Object.freeze({
    schemaId: 'canonical.v1.specimen',
    store: 'mongodb',
    collection: CANONICAL_COLLECTIONS.samples,
    idField: 'specimenId',
    model: require('../models/Sample').SampleModel,
    missingnessFields: Object.freeze(['barcode', 'linkedProject', 'parentSpecimenIds', 'merkleRoot', 'sprec']),
    validateReferences: validateSpecimenReferences,
    scopeField: 'collectionSite',
    organizationField: 'organizationId',
    generateId: generateSpecimenId,
    appendProjection: appendSpecimenProjection,
  }),
});

/** The target for `entityType`, or null: an own-property check, so `__proto__` or `toString` names nothing. */
function resolveIngestionTarget(entityType) {
  if (typeof entityType !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(INGESTION_TARGETS, entityType) ? INGESTION_TARGETS[entityType] : null;
}

module.exports = { INGESTION_TARGETS, resolveIngestionTarget };
