const env = require('./env');

const CANONICAL_COLLECTIONS = {
  patients: env.COLL_PATIENTS || 'patients',
  samples: env.COLL_SAMPLES || 'samples',
  consents: env.COLL_CONSENTS || 'patientConsents',
  consentTemplates: env.COLL_CONSENT_TEMPLATES || 'consent_templates',
  sampleMovements: env.COLL_SAMPLE_MOVEMENTS || 'sample_movements'
};

const COLLECTION_ALIASES = {
  patients: ['pacientes'],
  samples: ['amostras'],
  consents: ['patient_consents'],
  consentTemplates: [],
  sampleMovements: []
};

module.exports = {
  CANONICAL_COLLECTIONS,
  COLLECTION_ALIASES
};
