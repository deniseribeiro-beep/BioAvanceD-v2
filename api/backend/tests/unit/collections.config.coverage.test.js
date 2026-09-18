import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const env = require('../../src/config/env');
const collectionsPath = require.resolve('../../src/config/collections');

const overrideKeys = [
  'COLL_PATIENTS',
  'COLL_SAMPLES',
  'COLL_CONSENTS',
  'COLL_CONSENT_TEMPLATES',
  'COLL_SAMPLE_MOVEMENTS',
  'COLL_BIOMARKER_OBSERVATIONS',
  'COLL_CIDS',
  'COLL_CLINICAL_UNITS',
  'COLL_ORGANIZATIONS',
  'COLL_DISEASE_DICTIONARY',
  'COLL_MEDICATION_DICTIONARY',
  'COLL_REFERENCE_SEED_RUNS',
  'COLL_FOUNDATION_DATA_RUNS',
  'COLL_PARTICIPANT_IDENTITIES',
  'COLL_RCS_ASSESSMENTS',
  'COLL_ENCOUNTERS',
  'COLL_CONDITIONS',
  'COLL_PHENOTYPE_OBSERVATIONS',
  'COLL_CLINICAL_OBSERVATIONS',
  'COLL_CLINICAL_OUTCOMES',
  'COLL_DERIVED_SCORES',
  'COLL_ALLERGY_INTOLERANCES',
  'COLL_FAMILY_HISTORIES',
  'COLL_MEDICATION_EXPOSURES',
  'COLL_PROCEDURES',
  'COLL_SPECIMEN_PREANALYTICS',
  'COLL_QUARANTINE_ACTIONS',
  'COLL_REFERENCE_DATASET_RELEASES',
  'COLL_REFERENCE_IMPORT_RUNS',
  'COLL_REFERENCE_IMPORT_ISSUES',
  'COLL_REFERENCE_IMPORT_STAGING',
  'COLL_TERMINOLOGY_CONCEPTS',
  'COLL_TERMINOLOGY_RELATIONS',
  'COLL_ROLES',
  'COLL_PERMISSIONS',
  'COLL_USER_ROLE_ASSIGNMENTS',
  'COLL_RETENTION_POLICIES',
  'COLL_NOTIFICATION_RULES',
  'COLL_NOTIFICATIONS',
  'COLL_LABEL_GENERATIONS',
  'COLL_ACCESS_REQUESTS',
  'COLL_REAGENT_LOTS',
  'COLL_NONCONFORMANCES',
  'COLL_LEGAL_HOLDS',
  'COLL_DISPOSITION_ACTIONS',
  'COLL_INGESTION_IDEMPOTENCY_KEYS',
  'COLL_INGESTION_QUARANTINE_RECORDS',
];

const originalEnvValues = Object.fromEntries(overrideKeys.map((key) => [key, env[key]]));
const originalProcessConsent = process.env.COLL_CONSENTS;

function freshCollections() {
  delete require.cache[collectionsPath];
  return require(collectionsPath).CANONICAL_COLLECTIONS;
}

afterEach(() => {
  for (const key of overrideKeys) {
    env[key] = originalEnvValues[key];
  }
  if (originalProcessConsent === undefined) delete process.env.COLL_CONSENTS;
  else process.env.COLL_CONSENTS = originalProcessConsent;
  delete require.cache[collectionsPath];
});

describe('canonical collection configuration item 8 coverage', () => {
  it('takes every configured collection override branch', () => {
    for (const key of overrideKeys) {
      env[key] = `override_${key.toLowerCase()}`;
    }
    process.env.COLL_CONSENTS = 'configured';

    const collections = freshCollections();

    expect(collections.patients).toBe('override_coll_patients');
    expect(collections.samples).toBe('override_coll_samples');
    expect(collections.consents).toBe('override_coll_consents');
    expect(collections.consentTemplates).toBe('override_coll_consent_templates');
    expect(collections.sampleMovements).toBe('override_coll_sample_movements');
    expect(collections.biomarkerObservations).toBe('override_coll_biomarker_observations');
    expect(collections.cids).toBe('override_coll_cids');
    expect(collections.clinicalUnits).toBe('override_coll_clinical_units');
    expect(collections.organizations).toBe('override_coll_organizations');
    expect(collections.diseaseDictionary).toBe('override_coll_disease_dictionary');
    expect(collections.medicationDictionary).toBe('override_coll_medication_dictionary');
    expect(collections.referenceSeedRuns).toBe('override_coll_reference_seed_runs');
    expect(collections.foundationDataRuns).toBe('override_coll_foundation_data_runs');
    expect(collections.participantIdentities).toBe('override_coll_participant_identities');
    expect(collections.rcsAssessments).toBe('override_coll_rcs_assessments');
    expect(collections.encounters).toBe('override_coll_encounters');
    expect(collections.conditions).toBe('override_coll_conditions');
    expect(collections.phenotypeObservations).toBe('override_coll_phenotype_observations');
    expect(collections.clinicalObservations).toBe('override_coll_clinical_observations');
    expect(collections.clinicalOutcomes).toBe('override_coll_clinical_outcomes');
    expect(collections.derivedScores).toBe('override_coll_derived_scores');
    expect(collections.allergyIntolerances).toBe('override_coll_allergy_intolerances');
    expect(collections.familyHistories).toBe('override_coll_family_histories');
    expect(collections.medicationExposures).toBe('override_coll_medication_exposures');
    expect(collections.procedures).toBe('override_coll_procedures');
    expect(collections.specimenPreanalytics).toBe('override_coll_specimen_preanalytics');
    expect(collections.quarantineActions).toBe('override_coll_quarantine_actions');
    expect(collections.referenceDatasetReleases).toBe('override_coll_reference_dataset_releases');
    expect(collections.referenceImportRuns).toBe('override_coll_reference_import_runs');
    expect(collections.referenceImportIssues).toBe('override_coll_reference_import_issues');
    expect(collections.referenceImportStaging).toBe('override_coll_reference_import_staging');
    expect(collections.terminologyConcepts).toBe('override_coll_terminology_concepts');
    expect(collections.terminologyRelations).toBe('override_coll_terminology_relations');
    expect(collections.roles).toBe('override_coll_roles');
    expect(collections.permissions).toBe('override_coll_permissions');
    expect(collections.userRoleAssignments).toBe('override_coll_user_role_assignments');
    expect(collections.retentionPolicies).toBe('override_coll_retention_policies');
    expect(collections.notificationRules).toBe('override_coll_notification_rules');
    expect(collections.notifications).toBe('override_coll_notifications');
    expect(collections.labelGenerations).toBe('override_coll_label_generations');
    expect(collections.accessRequests).toBe('override_coll_access_requests');
    expect(collections.reagentLots).toBe('override_coll_reagent_lots');
    expect(collections.nonconformances).toBe('override_coll_nonconformances');
    expect(collections.legalHolds).toBe('override_coll_legal_holds');
    expect(collections.dispositionActions).toBe('override_coll_disposition_actions');
    expect(collections.ingestionIdempotencyKeys).toBe('override_coll_ingestion_idempotency_keys');
    expect(collections.ingestionQuarantineRecords).toBe('override_coll_ingestion_quarantine_records');
  });

  it('keeps the canonical consent default when the operator did not explicitly configure COLL_CONSENTS', () => {
    env.COLL_CONSENTS = 'legacy_patientConsents_value';
    delete process.env.COLL_CONSENTS;

    const collections = freshCollections();

    expect(collections.consents).toBe('consents');
  });
});
