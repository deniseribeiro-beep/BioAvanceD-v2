const { getCanonicalCollectionName } = require('../config/canonicalEntityCollections.v2');
const { enforceAppendOnlyCollection } = require('./sampleMovementLedger');

const LOCAL_COLLECTIONS = Object.freeze({
  consents: 'consents',
  consentTemplates: 'consentTemplates',
  sampleMovements: 'sampleMovements',
  clinicalUnits: 'clinicalUnits',
  organizations: 'organizations',
  roles: 'roles',
  permissions: 'permissions',
  userRoleAssignments: 'userRoleAssignments',
  participantIdentities: 'participantIdentities',
  terminologyConcepts: 'terminologyConcepts',
  referenceDatasetReleases: 'referenceDatasetReleases',
  referenceImportRuns: 'referenceImportRuns',
  referenceImportIssues: 'referenceImportIssues',
  referenceImportStaging: 'referenceImportStaging',
  nonconformances: 'nonconformances',
  phenotypeObservations: 'phenotypeObservations',
  procedures: 'procedures',
  quarantineActions: 'quarantineActions',
  retentionPolicies: 'retentionPolicies',
  specimenPreanalytics: 'specimenPreanalytics',
  clinicalObservations: 'clinicalObservations',
  clinicalOutcomes: 'clinicalOutcomes',
  conditions: 'conditions',
  encounters: 'encounters',
  allergyIntolerances: 'allergyIntolerances',
  familyHistories: 'familyHistories',
  medicationExposures: 'medicationExposures',
  derivedScores: 'derivedScores',
  rcsAssessments: 'rcsAssessments',
  accessRequests: 'accessRequests',
  reagentLots: 'reagentLots',
  dispositionActions: 'dispositionActions',
  notificationRules: 'notificationRules',
  notifications: 'notifications',
  labelGenerations: 'labelGenerations',
  legalHolds: 'legalHolds',
  cids: 'cids',
  referenceSeedRuns: 'referenceSeedRuns',
  ingestionIdempotencyKeys: 'ingestionIdempotencyKeys',
  ingestionQuarantineRecords: 'ingestionQuarantineRecords',
});

function resolveCollectionName(_db, key) {
  if (key === 'Participant' || key === 'Specimen') return getCanonicalCollectionName(key);
  const name = LOCAL_COLLECTIONS[key];
  if (!name) throw new Error(`Collection key inválida: ${key}`);
  return name;
}

function getCollection(db, key) {
  const name = resolveCollectionName(db, key);
  const collection = db.collection(name);
  if (key === 'sampleMovements') enforceAppendOnlyCollection(collection, name);
  return collection;
}

module.exports = { resolveCollectionName, getCollection };
