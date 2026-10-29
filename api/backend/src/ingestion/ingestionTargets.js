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
 * `collectionSite`. It brought three keys: `organizationField` names the
 * #1192 tenancy field stamped from the in-scope `scopeField` value,
 * `generateId` assigns the mount's 7-digit specimenId instead of a uuid, and
 * `appendProjection`, which Consent also carries, appends SPECIMEN_UPSERTED and
 * LINEAGE_REGISTERED in the insert's transaction (#1313,
 * docs/decisions/2026-10-23-ingestion-specimen-target.md).
 *
 * Participant is the seventh, stored in patients through the participant
 * mount's model. Its `validateReferences` runs the mount's clinical unit,
 * deceased and consent template gates, `scopeField` and `organizationField`
 * are both `clinicalUnitId`, and `generateId` assigns the mount's 8-digit
 * participantId. Its `missingnessFields` are empty: every field outside
 * `required` is refused, required by the model or the scope gate, or
 * defaulted by PatientModel.create. `identityFields`, which Consent also
 * carries, names the civil identity fields that live on ParticipantIdentity
 * alone (#575): a record holding one is refused, never quarantined as sent
 * (docs/decisions/2026-10-24-ingestion-participant-target.md).
 *
 * Consent is the eighth, stored in patientConsents through the consent
 * mount's model, with the mount's uuid consentId. Its `validateReferences`
 * runs the mount's participant, template, validity and responses gates, then
 * requires a granted consent, a past decision time within the term's
 * validity, and no consent of the participant in force unless the record
 * names the one in force. It brought three keys:
 * `prepareDocument` stores the decision's evidence and builds its permission
 * rows before the write, and `removeProjection` removes those rows and its
 * decision event when the idempotency race is lost; its `appendProjection`
 * writes them with CONSENT_UPSERTED in the insert's transaction. Its
 * `appendAfterAccept` supersedes the consent in force the record names, and
 * runs only once the record has won its idempotency key, in the insert's
 * transaction where there is one, never on a lost race
 * (docs/decisions/2026-10-25-ingestion-consent-supersession.md). Its
 * `missingnessFields` are empty, and its `identityFields` add the signer's
 * name and image to Participant's, so neither is ever quarantined as sent
 * (docs/decisions/2026-10-24-ingestion-consent-target.md).
 *
 * TelemetryReading is named, not a target (OTHER_STORE_ENTITY_TYPES): its
 * store is InfluxDB (RF029 AC4), a quarantine would write its fields to
 * MongoDB, and the route's transaction has no InfluxDB part. It is refused
 * 422 INGESTION_STORE_UNSUPPORTED naming the telemetry route, and each entry's
 * `record` is the noun the refusal tells the caller to register there
 * (docs/decisions/2026-10-24-ingestion-telemetry-reading-refused.md).
 *
 * DataFile and DataFileVersion are named the same way: their binary's store
 * is Object Storage (RF007 AC2, RF029 AC4), and this route carries no bytes,
 * so a row written from the payload would claim a URI, checksum and size for
 * an object the server never received. Each is refused naming the trusted
 * upload or replace routes, which scan, encrypt and write the object
 * (docs/decisions/2026-10-24-ingestion-data-file-refused.md).
 */
const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { LEGACY_PATIENT_IDENTITY_FIELDS, PARTICIPANT_IDENTITY_ONLY_FIELDS } = require('../utils/legacyPatientIdentityFields');
const { generateSpecimenId, validateSpecimenReferences, appendSpecimenProjection } = require('./specimenTarget');
const { generateParticipantId, validateParticipantReferences } = require('./participantTarget');
const {
  validateConsentReferences,
  prepareConsentDocument,
  appendConsentProjection,
  removeConsentProjection,
  supersedeConsentInForce,
} = require('./consentTarget');

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
    // RULE-012 (#1318): a label value carrying personal data is refused 422, never quarantined.
    labelFields: Object.freeze(['barcode']),
  }),
  Participant: Object.freeze({
    schemaId: 'canonical.v1.participant',
    store: 'mongodb',
    collection: CANONICAL_COLLECTIONS.patients,
    idField: 'participantId',
    model: require('../models/Patient'),
    missingnessFields: Object.freeze([]),
    validateReferences: validateParticipantReferences,
    scopeField: 'clinicalUnitId',
    organizationField: 'clinicalUnitId',
    generateId: generateParticipantId,
    identityFields: Object.freeze([...LEGACY_PATIENT_IDENTITY_FIELDS, ...PARTICIPANT_IDENTITY_ONLY_FIELDS]),
  }),
  Consent: Object.freeze({
    schemaId: 'canonical.v1.consent',
    store: 'mongodb',
    collection: CANONICAL_COLLECTIONS.consents,
    idField: 'consentId',
    model: require('../models/PatientConsent'),
    missingnessFields: Object.freeze([]),
    validateReferences: validateConsentReferences,
    prepareDocument: prepareConsentDocument,
    appendProjection: appendConsentProjection,
    removeProjection: removeConsentProjection,
    appendAfterAccept: supersedeConsentInForce,
    // signatureBase64 is the mount's alias for signatureImageBase64.
    identityFields: Object.freeze([...LEGACY_PATIENT_IDENTITY_FIELDS, ...PARTICIPANT_IDENTITY_ONLY_FIELDS, 'signatureName', 'signatureImageBase64', 'signatureBase64']),
  }),
});

/** The target for `entityType`, or null: an own-property check, so `__proto__` or `toString` names nothing. */
function resolveIngestionTarget(entityType) {
  if (typeof entityType !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(INGESTION_TARGETS, entityType) ? INGESTION_TARGETS[entityType] : null;
}

// RF029 AC4: entity types stored outside MongoDB, each with the trusted
// route that does write it. The ingestion route refuses them by name.
const OTHER_STORE_ENTITY_TYPES = Object.freeze({
  TelemetryReading: Object.freeze({ store: 'influxdb', route: 'POST /api/temperature/reading', record: 'a leitura' }),
  DataFile: Object.freeze({
    store: 'objectStorage',
    route: 'POST /api/samples/:specimenId/files/upload, POST /api/assays/:assayId/files/upload ou POST /api/datasets/:datasetId/files/upload',
    record: 'o arquivo',
  }),
  DataFileVersion: Object.freeze({
    store: 'objectStorage',
    route: 'PUT /api/samples/:specimenId/files/:fileID/replace, PUT /api/assays/:assayId/files/:fileID/replace ou PUT /api/datasets/:datasetId/files/:fileID/replace',
    record: 'a nova versão do arquivo',
  }),
});

/** The other-store entry for `entityType`, or null, by the same own-property check. */
function resolveOtherStoreEntityType(entityType) {
  if (typeof entityType !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(OTHER_STORE_ENTITY_TYPES, entityType) ? OTHER_STORE_ENTITY_TYPES[entityType] : null;
}

module.exports = { INGESTION_TARGETS, OTHER_STORE_ENTITY_TYPES, resolveIngestionTarget, resolveOtherStoreEntityType };
