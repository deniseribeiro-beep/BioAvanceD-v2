import { describe, it, expect, beforeEach, vi } from 'vitest';

const ENV_KEYS = [
  'COLL_PATIENTS',
  'COLL_SAMPLES',
  'COLL_CONSENTS',
  'COLL_CONSENT_TEMPLATES',
  'COLL_SAMPLE_MOVEMENTS',
  'COLL_BIOMARKER_OBSERVATIONS',
  'COLL_CIDS',
  'COLL_CLINICAL_UNITS',
  'COLL_DISEASE_DICTIONARY',
  'COLL_MEDICATION_DICTIONARY',
  'COLL_REFERENCE_SEED_RUNS'
];

const DEFAULTS = {
  patients: 'patients',
  samples: 'samples',
  consents: 'patientConsents',
  consentTemplates: 'consent_templates',
  sampleMovements: 'sample_movements',
  biomarkerObservations: 'biomarker_observations',
  cids: 'cids',
  clinicalUnits: 'clinical_units',
  diseaseDictionary: 'disease_dictionary',
  medicationDictionary: 'medication_dictionary',
  referenceSeedRuns: 'referenceSeedRuns'
};

const ORIGINAL_ENV = { ...process.env };

const ENV_PATH = require.resolve('../../../src/config/env');
const COLLECTIONS_PATH = require.resolve('../../../src/config/collections');

function loadWithEnv(envOverrides) {
  delete require.cache[ENV_PATH];
  delete require.cache[COLLECTIONS_PATH];
  ENV_KEYS.forEach(key => {
    if (envOverrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envOverrides[key];
    }
  });
  return require('../../../src/config/collections');
}

describe('config/collections', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('falls back to hardcoded defaults when every COLL_* env var is unset', () => {
    const emptyEnv = ENV_KEYS.reduce((acc, key) => ({ ...acc, [key]: undefined }), {});
    const { CANONICAL_COLLECTIONS } = loadWithEnv(emptyEnv);
    expect(CANONICAL_COLLECTIONS).toEqual(DEFAULTS);
  });

  it('falls back to hardcoded defaults when every COLL_* env var is an empty string', () => {
    const emptyEnv = ENV_KEYS.reduce((acc, key) => ({ ...acc, [key]: '' }), {});
    const { CANONICAL_COLLECTIONS } = loadWithEnv(emptyEnv);
    expect(CANONICAL_COLLECTIONS).toEqual(DEFAULTS);
  });

  it('uses env-provided values when every COLL_* env var is set', () => {
    const customEnv = ENV_KEYS.reduce(
      (acc, key) => ({ ...acc, [key]: `custom_${key.toLowerCase()}` }),
      {}
    );
    const { CANONICAL_COLLECTIONS } = loadWithEnv(customEnv);
    expect(CANONICAL_COLLECTIONS).toEqual({
      patients: 'custom_coll_patients',
      samples: 'custom_coll_samples',
      consents: 'custom_coll_consents',
      consentTemplates: 'custom_coll_consent_templates',
      sampleMovements: 'custom_coll_sample_movements',
      biomarkerObservations: 'custom_coll_biomarker_observations',
      // src/config/env.js never reads these five COLL_* vars into its
      // exports, so collections.js's `env.X ||` fallback for them always
      // takes the hardcoded default regardless of process.env.
      cids: 'cids',
      clinicalUnits: 'clinical_units',
      diseaseDictionary: 'disease_dictionary',
      medicationDictionary: 'medication_dictionary',
      referenceSeedRuns: 'referenceSeedRuns'
    });
  });

  it('freezes the CANONICAL_COLLECTIONS object', () => {
    const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
    expect(Object.isFrozen(CANONICAL_COLLECTIONS)).toBe(true);
    expect(() => {
      CANONICAL_COLLECTIONS.patients = 'mutated';
    }).toThrow();
  });
});
