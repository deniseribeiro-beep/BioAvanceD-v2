const env = require('./env');

const CANONICAL_COLLECTIONS = Object.freeze({
  patients: env.COLL_PATIENTS || 'patients',
  samples: env.COLL_SAMPLES || 'samples',
  consents: env.COLL_CONSENTS || 'patientConsents',
  consentTemplates: env.COLL_CONSENT_TEMPLATES || 'consent_templates',
  sampleMovements: env.COLL_SAMPLE_MOVEMENTS || 'sample_movements',
  biomarkerObservations: env.COLL_BIOMARKER_OBSERVATIONS || 'biomarker_observations',
  cids: env.COLL_CIDS || 'cids',
  clinicalUnits: env.COLL_CLINICAL_UNITS || 'clinical_units',
  organizations: env.COLL_ORGANIZATIONS || 'organizations',
  diseaseDictionary: env.COLL_DISEASE_DICTIONARY || 'disease_dictionary',
  medicationDictionary: env.COLL_MEDICATION_DICTIONARY || 'medication_dictionary',
  referenceSeedRuns: env.COLL_REFERENCE_SEED_RUNS || 'referenceSeedRuns',
  foundationDataRuns: env.COLL_FOUNDATION_DATA_RUNS || 'foundationDataRuns',
  participantIdentities: env.COLL_PARTICIPANT_IDENTITIES || 'participantIdentities',
  referenceDatasetReleases: env.COLL_REFERENCE_DATASET_RELEASES || 'referenceDatasetReleases',
  referenceImportRuns: env.COLL_REFERENCE_IMPORT_RUNS || 'referenceImportRuns',
  referenceImportIssues: env.COLL_REFERENCE_IMPORT_ISSUES || 'referenceImportIssues',
  referenceImportStaging: env.COLL_REFERENCE_IMPORT_STAGING || 'referenceImportStaging',
  terminologyConcepts: env.COLL_TERMINOLOGY_CONCEPTS || 'terminologyConcepts',
  terminologyRelations: env.COLL_TERMINOLOGY_RELATIONS || 'terminologyRelations'
});

module.exports = {
  CANONICAL_COLLECTIONS
};
