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
  diseaseDictionary: env.COLL_DISEASE_DICTIONARY || 'disease_dictionary',
  medicationDictionary: env.COLL_MEDICATION_DICTIONARY || 'medication_dictionary'
});

module.exports = {
  CANONICAL_COLLECTIONS
};
