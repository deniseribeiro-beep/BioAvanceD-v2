import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getCanonicalCollectionName } = require('../../../src/config/canonicalEntityCollections.v2');

const EXPECTED = Object.freeze({
  patients: getCanonicalCollectionName('Participant'),
  samples: getCanonicalCollectionName('Specimen'),
  consents: 'consents',
  consentTemplates: 'consentTemplates',
  consentPermissions: 'consentPermissions',
  consentDecisionEvents: 'consentDecisionEvents',
  consentRevocations: 'consentRevocations',
  consentAuthorizationDecisions: 'consentAuthorizationDecisions',
  consentCommunicationEvents: 'consentCommunicationEvents',
  sampleMovements: 'sampleMovements',
  biomarkerObservations: 'biomarkerObservations',
  cids: 'cids',
  clinicalUnits: 'clinicalUnits',
  organizations: 'organizations',
  diseaseDictionary: 'diseaseDictionary',
  medicationDictionary: 'medicationDictionary',
  referenceSeedRuns: 'referenceSeedRuns',
  foundationDataRuns: getCanonicalCollectionName('FoundationDataRun'),
  canonicalModelReleases: getCanonicalCollectionName('CanonicalModelRelease'),
  governanceInvariantCatalogs: getCanonicalCollectionName('GovernanceInvariantCatalog'),
  configurationValidationRuns: getCanonicalCollectionName('ConfigurationValidationRun'),
  readinessReports: getCanonicalCollectionName('ReadinessReport'),
  graphProjectionCheckpoints: getCanonicalCollectionName('GraphProjectionCheckpoint'),
  participantIdentities: getCanonicalCollectionName('ParticipantIdentity'),
  rcsAssessments: 'rcsAssessments',
  encounters: 'encounters',
  conditions: 'conditions',
  phenotypeObservations: 'phenotypeObservations',
  clinicalObservations: 'clinicalObservations',
  clinicalOutcomes: 'clinicalOutcomes',
  derivedScores: 'derivedScores',
  allergyIntolerances: 'allergyIntolerances',
  familyHistories: 'familyHistories',
  medicationExposures: 'medicationExposures',
  procedures: 'procedures',
  specimenPreanalytics: 'specimenPreanalytics',
  quarantineActions: 'quarantineActions',
  referenceDatasetReleases: getCanonicalCollectionName('ReferenceDatasetRelease'),
  referenceImportRuns: getCanonicalCollectionName('ReferenceImportRun'),
  referenceImportIssues: getCanonicalCollectionName('ReferenceImportIssue'),
  referenceImportStaging: 'referenceImportStaging',
  terminologyConcepts: getCanonicalCollectionName('TerminologyConcept'),
  terminologyRelations: getCanonicalCollectionName('TerminologyRelation'),
  roles: getCanonicalCollectionName('Role'),
  permissions: getCanonicalCollectionName('Permission'),
  userRoleAssignments: getCanonicalCollectionName('UserRoleAssignment'),
  retentionPolicies: 'retentionPolicies',
  notificationRules: 'notificationRules',
  notifications: 'notifications',
  labelGenerations: 'labelGenerations',
  accessRequests: 'accessRequests',
  reagentLots: 'reagentLots',
  nonconformances: 'nonconformances',
  legalHolds: 'legalHolds',
  dispositionActions: 'dispositionActions',
  ingestionIdempotencyKeys: 'ingestionIdempotencyKeys',
  ingestionQuarantineRecords: 'ingestionQuarantineRecords',
});

const COLLECTIONS_PATH = require.resolve('../../../src/config/collections');

describe('config/collections', () => {
  beforeEach(() => {
    vi.resetModules();
    delete require.cache[COLLECTIONS_PATH];
  });

  it('exposes Stage 2E canonical collection names from the workbook registry', () => {
    const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
    expect(CANONICAL_COLLECTIONS).toEqual(EXPECTED);
  });

  it('maps legacy patients/samples keys to Participant and Specimen collections', () => {
    const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
    expect(CANONICAL_COLLECTIONS.patients).toBe('participants');
    expect(CANONICAL_COLLECTIONS.samples).toBe('specimens');
    expect(CANONICAL_COLLECTIONS.consentTemplates).toBe('consentTemplates');
    expect(CANONICAL_COLLECTIONS.sampleMovements).toBe('sampleMovements');
  });

  it('ignores retired COLL_* process.env overrides', () => {
    process.env.COLL_PATIENTS = 'should-not-apply';
    process.env.COLL_SAMPLES = 'should-not-apply';
    delete require.cache[COLLECTIONS_PATH];
    const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
    expect(CANONICAL_COLLECTIONS.patients).toBe('participants');
    expect(CANONICAL_COLLECTIONS.samples).toBe('specimens');
    delete process.env.COLL_PATIENTS;
    delete process.env.COLL_SAMPLES;
  });
});
