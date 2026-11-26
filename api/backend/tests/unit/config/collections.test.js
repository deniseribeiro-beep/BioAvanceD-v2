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
  'COLL_REFERENCE_SEED_RUNS',
  'COLL_READINESS_REPORTS',
  'COLL_CONFIGURATION_PROFILES',
  'COLL_CONFIGURATION_RELEASES',
  'COLL_CONFIGURATION_CHANGE_EVENTS',
  'COLL_CONFIGURATION_VALIDATION_RUNS',
  'COLL_CANONICAL_MODEL_RELEASES',
  'COLL_GOVERNANCE_INVARIANT_CATALOGS',
  'COLL_RCS_INPUT_SNAPSHOTS',
  'COLL_RCS_GOVERNANCE_EVIDENCE_SNAPSHOTS',
  'COLL_RCS_RULE_PACKAGES'
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
  organizations: 'organizations',
  diseaseDictionary: 'disease_dictionary',
  medicationDictionary: 'medication_dictionary',
  referenceSeedRuns: 'referenceSeedRuns',
  foundationDataRuns: 'foundationDataRuns',
  readinessReports: 'readinessReports',
  configurationProfiles: 'configurationProfiles',
  configurationReleases: 'configurationReleases',
  configurationChangeEvents: 'configurationChangeEvents',
  configurationValidationRuns: 'configurationValidationRuns',
  canonicalModelReleases: 'canonicalModelReleases',
  governanceInvariantCatalogs: 'governanceInvariantCatalogs',
  invariantViolations: 'invariantViolations',
  participantIdentities: 'participantIdentities',
  rcsAssessments: 'rcsAssessments',
  rcsInputSnapshots: 'rcsInputSnapshots',
  rcsGovernanceEvidenceSnapshots: 'rcsGovernanceEvidenceSnapshots',
  rcsRulePackages: 'rcsRulePackages',
  encounters: 'encounters',
  conditions: 'conditions',
  phenotypeObservations: 'phenotypeObservations',
  clinicalObservations: 'clinicalObservations',
  diagnosticReports: 'diagnosticReports',
  clinicalOutcomes: 'clinicalOutcomes',
  derivedScores: 'derivedScores',
  allergyIntolerances: 'allergyIntolerances',
  familyHistories: 'familyHistories',
  medicationExposures: 'medicationExposures',
  procedures: 'procedures',
  specimenPreanalytics: 'specimenPreanalytics',
  quarantineActions: 'quarantineActions',
  containers: 'containers',
  specimenContainerAssignments: 'specimenContainerAssignments',
  containerPositionAssignments: 'containerPositionAssignments',
  rackLocationAssignments: 'rackLocationAssignments',
  telemetryExposureSummaries: 'telemetryExposureSummaries',
  storageLocations: 'storageLocations',
  storageRacks: 'storageRacks',
  storagePositions: 'storagePositions',
  operationalStateDecisions: 'operationalStateDecisions',
  labelIdentifiers: 'labelIdentifiers',
  scanEvents: 'scanEvents',
  physicalIdentificationValidationProtocols: 'physicalIdentificationValidationProtocols',
  custodianshipAssignments: 'custodianshipAssignments',
  shipments: 'shipments',
  devices: 'devices',
  deviceLifecycleEvents: 'deviceLifecycleEvents',
  deviceRegistrations: 'deviceRegistrations',
  telemetryDatastreams: 'telemetryDatastreams',
  referenceDatasetReleases: 'referenceDatasetReleases',
  referenceImportRuns: 'referenceImportRuns',
  referenceImportIssues: 'referenceImportIssues',
  referenceImportStaging: 'referenceImportStaging',
  terminologyConcepts: 'terminologyConcepts',
  terminologyRelations: 'terminologyRelations',
  roles: 'roles',
  permissions: 'permissions',
  userRoleAssignments: 'userRoleAssignments',
  retentionPolicies: 'retentionPolicies',
  notificationRules: 'notificationRules',
  notifications: 'notifications',
  labelGenerations: 'labelGenerations',
  accessRequests: 'accessRequests',
  accessPolicies: 'accessPolicies',
  collectionGovernanceApprovals: 'collectionGovernanceApprovals',
  collectionGovernanceEvents: 'collectionGovernanceEvents',
  consentDecisionEvents: 'consentDecisionEvents',
  consentRevocations: 'consentRevocations',
  consentAuthorizationDecisions: 'consentAuthorizationDecisions',
  consentPermissions: 'consentPermissions',
  consentCommunicationEvents: 'consentCommunicationEvents',
  reagentLots: 'reagentLots',
  nonconformances: 'nonconformances',
  legalHolds: 'legalHolds',
  dispositionActions: 'dispositionActions',
  dataFileVersions: 'dataFileVersions',
  ingestionIdempotencyKeys: 'ingestionIdempotencyKeys',
  ingestionQuarantineRecords: 'ingestionQuarantineRecords',
  missingDataReasons: 'missingDataReasons',
  dataQualityAssessments: 'dataQualityAssessments',
  referenceCoverageManifests: 'referenceCoverageManifests'
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
      // These five used to expect the hardcoded default here, with a
      // comment explaining that env.js "never reads these COLL_* vars".
      // That was true, and it was the bug: #863 found env.js declared 6 of
      // the 47 COLL_* keys collections.js reads, so 41 were undefined
      // forever and the `env.X ||` fallback always won. The declaration
      // gap and this assertion were vouching for each other -- exactly the
      // mutually-reinforcing pattern #778/#784 describe -- while this
      // test's own name promised the opposite of what it asserted.
      // Now that env.js declares all 47, every key in ENV_KEYS is honoured.
      cids: 'custom_coll_cids',
      clinicalUnits: 'custom_coll_clinical_units',
      // organizations stays defaulted: COLL_ORGANIZATIONS is genuinely not
      // in ENV_KEYS, so customEnv never sets it.
      organizations: 'organizations',
      diseaseDictionary: 'custom_coll_disease_dictionary',
      medicationDictionary: 'custom_coll_medication_dictionary',
      referenceSeedRuns: 'custom_coll_reference_seed_runs',
      foundationDataRuns: 'foundationDataRuns',
      readinessReports: 'custom_coll_readiness_reports',
      configurationProfiles: 'custom_coll_configuration_profiles',
      configurationReleases: 'custom_coll_configuration_releases',
      configurationChangeEvents: 'custom_coll_configuration_change_events',
      configurationValidationRuns: 'custom_coll_configuration_validation_runs',
      canonicalModelReleases: 'custom_coll_canonical_model_releases',
      governanceInvariantCatalogs: 'custom_coll_governance_invariant_catalogs',
      invariantViolations: 'invariantViolations',
      participantIdentities: 'participantIdentities',
      rcsAssessments: 'rcsAssessments',
      rcsInputSnapshots: 'custom_coll_rcs_input_snapshots',
      rcsGovernanceEvidenceSnapshots: 'custom_coll_rcs_governance_evidence_snapshots',
      rcsRulePackages: 'custom_coll_rcs_rule_packages',
      // COLL_ENCOUNTERS/COLL_CONDITIONS/COLL_PHENOTYPE_OBSERVATIONS/
      // COLL_CLINICAL_OBSERVATIONS/COLL_CLINICAL_OUTCOMES/
      // COLL_DERIVED_SCORES/COLL_ALLERGY_INTOLERANCES/
      // COLL_FAMILY_HISTORIES/COLL_MEDICATION_EXPOSURES/COLL_PROCEDURES
      // aren't in ENV_KEYS/read by env.js either, same hardcoded-default
      // reasoning as cids/etc. above.
      encounters: 'encounters',
      conditions: 'conditions',
      phenotypeObservations: 'phenotypeObservations',
      clinicalObservations: 'clinicalObservations',
      diagnosticReports: 'diagnosticReports',
      clinicalOutcomes: 'clinicalOutcomes',
      derivedScores: 'derivedScores',
      allergyIntolerances: 'allergyIntolerances',
      familyHistories: 'familyHistories',
      medicationExposures: 'medicationExposures',
      procedures: 'procedures',
      specimenPreanalytics: 'specimenPreanalytics',
      quarantineActions: 'quarantineActions',
      containers: 'containers',
      specimenContainerAssignments: 'specimenContainerAssignments',
      containerPositionAssignments: 'containerPositionAssignments',
      rackLocationAssignments: 'rackLocationAssignments',
      telemetryExposureSummaries: 'telemetryExposureSummaries',
      storageLocations: 'storageLocations',
      storageRacks: 'storageRacks',
      storagePositions: 'storagePositions',
      operationalStateDecisions: 'operationalStateDecisions',
      labelIdentifiers: 'labelIdentifiers',
      scanEvents: 'scanEvents',
      physicalIdentificationValidationProtocols: 'physicalIdentificationValidationProtocols',
      custodianshipAssignments: 'custodianshipAssignments',
      shipments: 'shipments',
      devices: 'devices',
      deviceLifecycleEvents: 'deviceLifecycleEvents',
      deviceRegistrations: 'deviceRegistrations',
      telemetryDatastreams: 'telemetryDatastreams',
      referenceDatasetReleases: 'referenceDatasetReleases',
      referenceImportRuns: 'referenceImportRuns',
      referenceImportIssues: 'referenceImportIssues',
      referenceImportStaging: 'referenceImportStaging',
      terminologyConcepts: 'terminologyConcepts',
      terminologyRelations: 'terminologyRelations',
      roles: 'roles',
      permissions: 'permissions',
      userRoleAssignments: 'userRoleAssignments',
      // COLL_RETENTION_POLICIES isn't in ENV_KEYS/read by env.js either, same
      // hardcoded-default reasoning as cids/clinicalUnits/etc. above.
      retentionPolicies: 'retentionPolicies',
      notificationRules: 'notificationRules',
      notifications: 'notifications',
      labelGenerations: 'labelGenerations',
      accessRequests: 'accessRequests',
      accessPolicies: 'accessPolicies',
      collectionGovernanceApprovals: 'collectionGovernanceApprovals',
      collectionGovernanceEvents: 'collectionGovernanceEvents',
      consentDecisionEvents: 'consentDecisionEvents',
      consentRevocations: 'consentRevocations',
      consentAuthorizationDecisions: 'consentAuthorizationDecisions',
      consentPermissions: 'consentPermissions',
      consentCommunicationEvents: 'consentCommunicationEvents',
      // COLL_REAGENT_LOTS/COLL_NONCONFORMANCES/COLL_LEGAL_HOLDS/
      // COLL_DISPOSITION_ACTIONS aren't in ENV_KEYS/read by env.js either,
      // same hardcoded-default reasoning as cids/etc. above.
      reagentLots: 'reagentLots',
      nonconformances: 'nonconformances',
      legalHolds: 'legalHolds',
      dispositionActions: 'dispositionActions',
      dataFileVersions: 'dataFileVersions',
      // COLL_INGESTION_IDEMPOTENCY_KEYS/COLL_INGESTION_QUARANTINE_RECORDS/
      // COLL_MISSING_DATA_REASONS/COLL_DATA_QUALITY_ASSESSMENTS/
      // COLL_REFERENCE_COVERAGE_MANIFESTS aren't in ENV_KEYS/read by env.js
      // either, same reasoning.
      ingestionIdempotencyKeys: 'ingestionIdempotencyKeys',
      ingestionQuarantineRecords: 'ingestionQuarantineRecords',
      missingDataReasons: 'missingDataReasons',
      dataQualityAssessments: 'dataQualityAssessments',
      referenceCoverageManifests: 'referenceCoverageManifests'
    });
  });

  // env.js gives every COLL_* key its own default, so the `||` fallbacks in
  // collections.js only answer when the env module lacks a key. Load
  // collections.js against an env module that carries none.
  it('falls back to its own default for every key when the env module carries no COLL_* value', () => {
    const realEnvEntry = require.cache[ENV_PATH];
    delete require.cache[COLLECTIONS_PATH];
    require.cache[ENV_PATH] = { id: ENV_PATH, filename: ENV_PATH, loaded: true, exports: {}, children: [] };
    try {
      const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
      expect(CANONICAL_COLLECTIONS).toEqual(DEFAULTS);
    } finally {
      if (realEnvEntry) {
        require.cache[ENV_PATH] = realEnvEntry;
      } else {
        delete require.cache[ENV_PATH];
      }
      delete require.cache[COLLECTIONS_PATH];
    }
  });

  it('freezes the CANONICAL_COLLECTIONS object', () => {
    const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
    expect(Object.isFrozen(CANONICAL_COLLECTIONS)).toBe(true);
    expect(() => {
      CANONICAL_COLLECTIONS.patients = 'mutated';
    }).toThrow();
  });
});
