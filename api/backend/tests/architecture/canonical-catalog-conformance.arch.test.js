// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.
//
// #967: catalog.2.0.0.json (the approved v2.0.0 release, 1644 elements,
// generated from docs/extracted-v2.0.0/dict-DICIONARIO.md -- see
// canonical-dictionary/v2.js's own header) names the canonical
// field for every entity, and nothing in the repo compared those names
// against the shape the runtime code actually produces. This is that
// comparison, for 24 entities: SecurityConfiguration (a service singleton's
// getDefaultConfig()) plus 23 models exposing a pure `static fieldsOf(data =
// {})`. It must stay green while recording every drift it finds explicitly,
// in KNOWN_DRIFT -- both a new, undeclared drift and a KNOWN_DRIFT entry that
// no longer matches reality are failures (see diffEntity below for how the
// second half works).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadCanonicalDictionary } = require('../../src/reference-data/canonical-dictionary/v2');

// Recurse only into a plain nested object. `null` (`typeof null === 'object'`)
// and `Date` (`Object.entries(aDate)` is `[]`) both look like "nothing here"
// to a naive recursion and would silently vanish from the flattened path
// list -- exactly the failure this whole guard exists to catch, just moved
// one level down into its own plumbing. Both traps are live in
// SecurityConfiguration's own getDefaultConfig() output (lastUpdatedBy: null,
// lastUpdatedAt: new Date()), which is why the dedicated pinning test below
// uses that exact shape rather than a hypothetical one.
function flattenKeys(value, prefix = '') {
  const paths = [];
  for (const [key, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      paths.push(...flattenKeys(v, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

// Shape A: a service singleton, pure getDefaultConfig(). Shape B: a model's
// pure `static fieldsOf(data = {})`. Every entry below was read, not
// guessed from its filename -- RcsAssessment.js/RcsAssessmentModel is the
// concrete case where filename and canonical entity name diverge
// (catalog entity is "RCSAssessment", all-caps RCS).
const ENTITY_TARGETS = {
  SecurityConfiguration: () => require('../../src/services/security.service').getDefaultConfig(),
  AccessPolicy: () => require('../../src/models/AccessPolicy').fieldsOf(),
  CollectionGovernanceApproval: () => require('../../src/models/CollectionGovernanceApproval').fieldsOf(),
  BiorepositoryContext: () => require('../../src/models/CollectionGovernanceContext').biorepositoryFieldsOf(),
  BiobankGovernanceContext: () => require('../../src/models/CollectionGovernanceContext').biobankFieldsOf(),
  CollectionGovernanceEvent: () => require('../../src/models/CollectionGovernanceEvent').fieldsOf(),
  ConsentDecisionEvent: () => require('../../src/models/ConsentDecisionEvent').fieldsOf(),
  ConsentRevocation: () => require('../../src/models/ConsentRevocation').fieldsOf(),
  ConsentAuthorizationDecision: () => require('../../src/models/ConsentAuthorizationDecision').fieldsOf(),
  ConsentPermission: () => require('../../src/models/ConsentPermission').fieldsOf(),
  AllergyIntolerance: () => require('../../src/models/AllergyIntolerance').fieldsOf(),
  ClinicalObservation: () => require('../../src/models/ClinicalObservation').fieldsOf(),
  ConfigurationChangeEvent: () => require('../../src/models/ConfigurationChangeEvent').fieldsOf(),
  ConfigurationProfile: () => require('../../src/models/ConfigurationProfile').fieldsOf(),
  ConfigurationRelease: () => require('../../src/models/ConfigurationRelease').fieldsOf(),
  CanonicalModelRelease: () => require('../../src/models/CanonicalModelRelease').fieldsOf(),
  ConfigurationValidationRun: () => require('../../src/models/ConfigurationValidationRun').fieldsOf(),
  GovernanceInvariantCatalog: () => require('../../src/models/GovernanceInvariantCatalog').fieldsOf(),
  GovernanceInvariant: () => require('../../src/models/GovernanceInvariantCatalog').invariantFieldsOf(),
  ClinicalOutcome: () => require('../../src/models/ClinicalOutcome').fieldsOf(),
  Condition: () => require('../../src/models/Condition').fieldsOf(),
  DerivedScore: () => require('../../src/models/DerivedScore').fieldsOf(),
  Encounter: () => require('../../src/models/Encounter').fieldsOf(),
  FamilyHistory: () => require('../../src/models/FamilyHistory').fieldsOf(),
  MedicationExposure: () => require('../../src/models/MedicationExposure').fieldsOf(),
  ParticipantIdentity: () => require('../../src/models/ParticipantIdentity').fieldsOf(),
  Permission: () => require('../../src/models/Permission').fieldsOf(),
  PhenotypeObservation: () => require('../../src/models/PhenotypeObservation').fieldsOf(),
  Procedure: () => require('../../src/models/Procedure').fieldsOf(),
  QuarantineAction: () => require('../../src/models/QuarantineAction').fieldsOf(),
  RCSAssessment: () => require('../../src/models/RcsAssessment').fieldsOf(),
  Role: () => require('../../src/models/Role').fieldsOf(),
  SpecimenPreanalytics: () => require('../../src/models/SpecimenPreanalytics').fieldsOf(),
  Container: () => require('../../src/models/Container').fieldsOf(),
  SpecimenContainerAssignment: () => require('../../src/models/SpecimenContainerAssignment').fieldsOf(),
  ContainerPositionAssignment: () => require('../../src/models/ContainerPositionAssignment').fieldsOf(),
  RackLocationAssignment: () => require('../../src/models/RackLocationAssignment').fieldsOf(),
  StorageRack: () => require('../../src/models/StorageRack').fieldsOf(),
  StoragePosition: () => require('../../src/models/StoragePosition').fieldsOf(),
  LabelIdentifier: () => require('../../src/models/LabelIdentifier').fieldsOf(),
  IdentifierNamespaceRegistry: () => require('../../src/models/IdentifierNamespaceRegistry').fieldsOf(),
  IdentificationPolicy: () => require('../../src/models/IdentificationPolicy').fieldsOf(),
  ScanEvent: () => require('../../src/models/ScanEvent').fieldsOf(),
  PhysicalIdentificationValidationProtocol: () => require('../../src/models/PhysicalIdentificationValidationProtocol').fieldsOf(),
  UserRoleAssignment: () => require('../../src/models/UserRoleAssignment').fieldsOf(),
  UserAccount: () => require('../../src/models/User').fieldsOf(),
  Session: () => require('../../src/models/Session').fieldsOf(),
  RecoveryCodeSet: () => require('../../src/models/RecoveryCodeSet').fieldsOf(),
};

// Drift measured against catalog.1.3.0.json, 2026-09-02, and re-measured
// against catalog.2.0.0.json, 2026-10-07, via loadCanonicalDictionary() and
// each ENTITY_TARGETS entry above. The v2.0.0 re-measure changed only
// RCSAssessment: 16 V2E elements absent, which name the issue that builds
// them (TODO(#1320)), and two former extras (finalGrade, gradeRoute) that
// v2.0.0 made canonical. Every entry carries a one-line note of what the
// drift is, populated from what running the diff actually produced, and
// either says it is deliberate or names the issue that fixes it in a
// TODO(#N): the RCS v4 work (#1320), or the stored-name migration of the
// auth and identity documents (#1330). An entity absent from this table has zero measured
// drift. `absent` entries are canonical elementIds the code never emits;
// `extra` entries are code keys with no canonical counterpart.
const KNOWN_DRIFT = {
  SecurityConfiguration: {
    absent: [],
    extra: [
      {
        key: 'configurationReleaseId',
        note: "v2.0.0 CFG-004: every execution or decision records the configurationReleaseId it ran under. SecurityConfiguration's 49 rows carry over from v1.3.0 and name no release field, so the active release's id sits beside them."
      },
      {
        key: 'passwordRules.minLengthWithMFA',
        note: '#1257: deliberate. NIST SP 800-63B-4 section 3.1.1.2 sets two length floors, 15 for a password used as a single factor and 8 for one used with MFA, and dict-02 has one minLength (P1X-0284), which carries the single-factor floor. The MFA floor has no canonical row.'
      }
    ]
  },
  DerivedScore: {
    absent: [],
    extra: [
      {
        key: 'derivedScoreId',
        note: "Deliberate: DerivedScoreModel's own generated id, the key getDerivedScoreById looks a score up by. dict-02 gives DerivedScore no id row (ELM-0255..0259)."
      }
    ]
  },
  ParticipantIdentity: {
    absent: [
      { elementId: 'P1X-0348', field: 'participantIdentityId', note: 'TODO(#1330): 1..1 Core -- ParticipantIdentityModel has no id field of its own at all.' },
      { elementId: 'P1X-0354', field: 'identityDocumentCiphertext', note: 'TODO(#1330): 0..1 Condicional -- model stores identityDocument in the clear (see the identityDocument extra below), not as ciphertext.' },
      { elementId: 'P1X-0355', field: 'recordNumberCiphertext', note: 'TODO(#1330): 0..1 Condicional -- not emitted.' },
      { elementId: 'P1X-0356', field: 'clinicalUnitId', note: 'TODO(#1330): 0..1 Condicional -- not emitted.' },
      { elementId: 'P1X-0359', field: 'representativeIdentityDocumentCiphertext', note: 'TODO(#1330): 0..1 Condicional -- model stores representativeIdentityDocument in the clear (see the extra below), not as ciphertext.' },
      { elementId: 'P1X-0361', field: 'identityStatus', note: 'TODO(#1330): 1..1 Core -- not emitted.' },
      { elementId: 'P1X-0362', field: 'encryptionKeyVersion', note: 'TODO(#1330): 1..1 Core -- not emitted, consistent with no ciphertext field being emitted either.' },
      { elementId: 'P1X-0363', field: 'lastVerifiedAt', note: 'TODO(#1330): 0..1 Condicional -- not emitted.' },
      { elementId: 'P1X-0364', field: 'verifiedBy', note: 'TODO(#1330): 0..1 Condicional -- not emitted.' }
    ],
    extra: [
      {
        key: 'identityDocument',
        note: 'TODO(#1330): plaintext field with no canonical counterpart -- the catalog only names identityDocumentCiphertext (P1X-0354, absent above).'
      },
      {
        key: 'representativeIdentityDocument',
        note: 'TODO(#1330): plaintext field with no canonical counterpart -- the catalog only names representativeIdentityDocumentCiphertext (P1X-0359, absent above).'
      }
    ]
  },
  RCSAssessment: {
    absent: [
      { elementId: 'ELM-0160', field: 'rcsGrade', note: 'TODO(#1320): 0..1 Core -- not emitted; finalGrade is its own v2.0.0 element (V2E-0541), so it is not a rename of this one.' },
      { elementId: 'ELM-0161', field: 'rcsModelVersion', note: 'TODO(#1320): 1..1 Core -- code emits modelVersion (extra below), not this canonical name.' },
      { elementId: 'ELM-0162', field: 'sprecRcsMappingVersion', note: 'TODO(#1320): 1..1 Core -- not emitted.' },
      { elementId: 'ELM-0163', field: 'rcsAxisResults', note: 'TODO(#1320): 0..* Core -- code emits axisPenalties (extra below), not this canonical name.' },
      { elementId: 'ELM-0164', field: 'governanceGateResult', note: 'TODO(#1320): 1..1 Core -- code emits governanceStatus (extra below), not this canonical name.' },
      { elementId: 'ELM-0165', field: 'unmappedCodes', note: 'TODO(#1320): 0..* Condicional -- not emitted.' },
      { elementId: 'ELM-0166', field: 'rcsCalculatedAt', note: 'TODO(#1320): 0..1 Core -- not emitted by fieldsOf(); create() sets a separate assessedAt outside fieldsOf().' },
      { elementId: 'P1X-0060', field: 'rcsAssessmentId', note: 'TODO(#1320): 1..1 Core -- RcsAssessmentModel has no id field of its own at all.' },
      { elementId: 'P1X-0062', field: 'sprecProfileId', note: 'TODO(#1320): 1..1 Core -- not emitted; no reference back to the SpecimenPreanalytics snapshot this assessment was computed from.' },
      { elementId: 'P1X-0064', field: 'biologicalPenalty', note: 'TODO(#1320): 0..1 Condicional -- not emitted.' },
      { elementId: 'P1X-0066', field: 'decisionRoute', note: 'TODO(#1320): 1..1 Core -- not emitted; gradeRoute is its own v2.0.0 element (V2E-0542), so it is not a rename of this one.' },
      { elementId: 'P1X-0067', field: 'governanceChecks', note: 'TODO(#1320): 1..* Core -- code emits governanceRuleCodes (extra below), not this canonical name.' },
      { elementId: 'P1X-0068', field: 'governanceFailureCodes', note: 'TODO(#1320): 0..* Condicional -- code emits governanceFailureReasons (extra below), not this canonical name.' },
      { elementId: 'P1X-0069', field: 'inputSnapshotHash', note: 'TODO(#1320): 1..1 Core -- not emitted.' },
      { elementId: 'P1X-0070', field: 'evidenceRefs', note: 'TODO(#1320): 0..* Essencial -- not emitted.' },
      { elementId: 'P1X-0071', field: 'calculationStatus', note: 'TODO(#1320): 1..1 Core -- code emits calculationTrace (extra below), a free-form value, not this canonical status field.' },
      { elementId: 'V2E-0439', field: 'qualificationContext', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0440', field: 'intendedUseCode', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0441', field: 'targetAnalyte', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0442', field: 'assayFamily', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0443', field: 'workflowProtocolId', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0444', field: 'workflowProtocolVersion', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0445', field: 'rulePackageVersion', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0446', field: 'rulePackageChecksum', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0447', field: 'inputSnapshotUri', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0448', field: 'sprecVersion', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0449', field: 'executionEnvironment', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0450', field: 'justifications', note: 'TODO(#1320): 1..* Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0538', field: 'inputSnapshotId', note: 'TODO(#1320): 1..1 Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0539', field: 'preanalyticalPenalty', note: 'TODO(#1320): 0..1 Conditional -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0540', field: 'score', note: 'TODO(#1320): 0..1 Conditional -- v2.0.0 element (added), not emitted; RCS v4 builds it.' },
      { elementId: 'V2E-0543', field: 'routeReasons', note: 'TODO(#1320): 1..* Core -- v2.0.0 element (added), not emitted; RCS v4 builds it.' }
    ],
    extra: [
      { key: 'modelVersion', note: 'TODO(#1320): no canonical counterpart; likely predecessor of rcsModelVersion (ELM-0161, absent above).' },
      { key: 'governanceStatus', note: 'TODO(#1320): no canonical counterpart; likely predecessor of governanceGateResult (ELM-0164, absent above).' },
      { key: 'governanceFailureReasons', note: 'TODO(#1320): no canonical counterpart; likely predecessor of governanceFailureCodes (P1X-0068, absent above).' },
      { key: 'governanceRuleCodes', note: 'TODO(#1320): no canonical counterpart; likely predecessor of governanceChecks (P1X-0067, absent above).' },
      { key: 'axisPenalties', note: 'TODO(#1320): no canonical counterpart; likely predecessor of rcsAxisResults (ELM-0163, absent above).' },
      { key: 'calculationTrace', note: 'TODO(#1320): no canonical counterpart; free-form trace value, not calculationStatus (P1X-0071, absent above).' }
    ]
  },
  SpecimenPreanalytics: {
    absent: [],
    // Deliberate, all five (#1330's last item, decided 2026-10-09): these are
    // the raw SPREC axis slots import.service.js fills from CSV columns, and
    // fieldsOf() derives every sprec* canonical name from them. matrixType is
    // the discriminator of that derivation (fluid vs solid relabel axes 2-6),
    // and dict-02 has no row for it. Dropping the slots would leave a snapshot
    // with derived values and no record of the input they came from.
    extra: [
      { key: 'matrixType', note: 'Deliberate local extension: the fluid/solid discriminator fieldsOf() derives the sprec* names by; no canonical row.' },
      { key: 'sampleType', note: 'Deliberate local extension: raw axis-1 slot; sprecSpecimenType is the derived canonical field, present and matched.' },
      { key: 'primaryContainer', note: 'Deliberate local extension: raw axis-2 slot; sprecPrimaryContainer/sprecCollectionType are the derived canonical fields, present and matched.' },
      { key: 'preCentrifugation', note: 'Deliberate local extension: raw axis-3 slot; warmIschemiaTime/preCentrifugationDelay are the derived canonical fields, present and matched.' },
      { key: 'centrifugation', note: 'Deliberate local extension: raw axis-4 slot; coldIschemiaTime/firstCentrifugation are the derived canonical fields, present and matched.' }
    ]
  },
  UserAccount: {
    absent: [
      { elementId: 'P1X-0182', field: 'userAccountId', note: 'TODO(#1330): 1..1 Core -- the user document has no id of its own beyond Mongo _id.' },
      { elementId: 'P1X-0183', field: 'actorId', note: 'TODO(#1330): 1..1 Core -- not emitted.' },
      { elementId: 'P1X-0184', field: 'displayName', note: 'TODO(#1330): 1..1 Core -- stored as name (extra below).' },
      { elementId: 'P1X-0188', field: 'institutionLegacy', note: 'TODO(#1330): 0..1 Extensão local -- not emitted; the document carries organizationId instead.' },
      { elementId: 'P1X-0190', field: 'passwordHash', note: 'TODO(#1330): 1..1 Core -- stored as password (extra below), which the service hashes before insert.' },
      { elementId: 'P1X-0191', field: 'accessTypeLegacy', note: 'TODO(#1330): 0..1 Extensão local -- not emitted.' },
      { elementId: 'P1X-0192', field: 'primaryRoleId', note: 'TODO(#1330): 1..1 Core -- not emitted; roles live in UserRoleAssignment.' },
      { elementId: 'P1X-0193', field: 'accountStatus', note: 'TODO(#1330): 1..1 Core -- stored as status (extra below).' },
      { elementId: 'P1X-0196', field: 'mfaMethod', note: 'TODO(#1330): 0..1 Condicional -- set by the auth services, not by fieldsOf().' },
      { elementId: 'P1X-0198', field: 'mfaSetupAt', note: 'TODO(#1330): 0..1 Condicional -- stored as mfaActivationDate (extra below).' },
      { elementId: 'P1X-0201', field: 'mfaLockedUntil', note: 'TODO(#1330): 0..1 Condicional -- set by the auth services, not by fieldsOf().' },
      { elementId: 'P1X-0202', field: 'lastLoginAt', note: 'TODO(#1330): 0..1 O/D -- stored as lastLogin (extra below).' },
      { elementId: 'P1X-0203', field: 'passwordHistoryHashes', note: 'TODO(#1330): 0..* Essencial -- stored as passwordHistory (extra below).' },
      { elementId: 'P1X-0205', field: 'forcePasswordReset', note: 'TODO(#1330): 1..1 Core -- stored as forceReset (extra below).' },
      { elementId: 'P1X-0207', field: 'passwordResetTokenHash', note: 'TODO(#1330): 0..1 Condicional -- set by the reset flow (#1078), not by fieldsOf().' },
      { elementId: 'P1X-0208', field: 'passwordResetExpiresAt', note: 'TODO(#1330): 0..1 Condicional -- the reset flow writes passwordResetExpires.' }
    ],
    extra: [
      { key: 'name', note: 'TODO(#1330): pre-dictionary name of displayName (P1X-0184).' },
      { key: 'password', note: 'TODO(#1330): pre-dictionary name of passwordHash (P1X-0190).' },
      { key: 'status', note: 'TODO(#1330): pre-dictionary name of accountStatus (P1X-0193).' },
      { key: 'mfaActivationDate', note: 'TODO(#1330): pre-dictionary name of mfaSetupAt (P1X-0198).' },
      { key: 'lastLogin', note: 'TODO(#1330): pre-dictionary name of lastLoginAt (P1X-0202).' },
      { key: 'passwordHistory', note: 'TODO(#1330): pre-dictionary name of passwordHistoryHashes (P1X-0203).' },
      { key: 'forceReset', note: 'TODO(#1330): pre-dictionary name of forcePasswordReset (P1X-0205).' },
      { key: 'accountLockedUntil', note: "TODO(#1330): local extension for RF001 AC2's temporary lock (#952); dict-02 has no password-side lock expiry." },
      { key: 'roleValidFrom', note: 'TODO(#1330): RF003 AC3 role validity on the user document; the canonical home is UserRoleAssignment.validFrom.' },
      { key: 'roleValidUntil', note: 'TODO(#1330): RF003 AC3 role validity on the user document; the canonical home is UserRoleAssignment.validUntil.' },
      { key: 'organizationIds', note: 'TODO(#1330): RF003 AC3 role scope on the user document; the canonical home is UserRoleAssignment.scopeId.' },
      { key: 'createdAt', note: 'TODO(#1330): record timestamp with no UserAccount row.' },
      { key: 'updatedAt', note: 'TODO(#1330): record timestamp with no UserAccount row.' }
    ]
  },
  Session: {
    absent: [
      { elementId: 'P1X-0251', field: 'sessionId', note: 'TODO(#1330): 1..1 Core -- stored as sessionID (extra below).' },
      { elementId: 'P1X-0252', field: 'userAccountId', note: 'TODO(#1330): 1..1 Core -- stored as userID (extra below).' },
      { elementId: 'P1X-0253', field: 'accessTokenHash', note: 'TODO(#1330): 1..1 Core -- stored as tokenHash (extra below).' },
      { elementId: 'P1X-0258', field: 'lastActivityAt', note: 'TODO(#1330): 1..1 Core -- stored as lastActivity (extra below).' },
      { elementId: 'P1X-0259', field: 'sessionStartedAt', note: 'TODO(#1330): 1..1 Core -- stored as createdAt (extra below), as the dictionary row itself notes.' },
      { elementId: 'P1X-0262', field: 'inactivityTimeoutMs', note: 'TODO(#1330): 1..1 Core -- stored as inactiveTimeout (extra below).' }
    ],
    extra: [
      { key: 'sessionID', note: 'TODO(#1330): pre-dictionary name of sessionId (P1X-0251).' },
      { key: 'userID', note: 'TODO(#1330): pre-dictionary name of userAccountId (P1X-0252).' },
      { key: 'tokenHash', note: 'TODO(#1330): pre-dictionary name of accessTokenHash (P1X-0253).' },
      { key: 'lastActivity', note: 'TODO(#1330): pre-dictionary name of lastActivityAt (P1X-0258).' },
      { key: 'createdAt', note: 'TODO(#1330): pre-dictionary name of sessionStartedAt (P1X-0259).' },
      { key: 'inactiveTimeout', note: 'TODO(#1330): pre-dictionary name of inactivityTimeoutMs (P1X-0262).' },
      { key: 'updatedAt', note: 'TODO(#1330): record timestamp with no Session row.' }
    ]
  }
};

// The comparison itself, factored out so the synthetic self-test below can
// exercise it without touching ENTITY_TARGETS/KNOWN_DRIFT. `known` defaults
// to no allowance at all, so calling this without a third argument is
// exactly "everything measured must match the catalog exactly".
//
// Both directions of drift are checked, which is what keeps KNOWN_DRIFT from
// rotting: an entry that no longer corresponds to a real absence/extra (the
// code was fixed, or the catalog changed) is reported exactly as loudly as a
// brand-new, undeclared one.
function diffEntity(entity, canonicalRows, codeObject, known = { absent: [], extra: [] }) {
  const codeKeys = new Set(flattenKeys(codeObject));
  const canonicalFieldSet = new Set(canonicalRows.map((row) => row.field));

  // A canonical field typed as a structure (Encounter.encounterPeriod is a
  // Period) is one catalog row, while the code emits it as an object that
  // flattenKeys splits into leaves. A leaf under a canonical field is that
  // field, both ways round.
  const prefixesOf = (key) => key.split('.').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('.'));
  const emits = (field) => codeKeys.has(field) || [...codeKeys].some((key) => key.startsWith(`${field}.`));
  const isCanonical = (key) => canonicalFieldSet.has(key) || prefixesOf(key).some((prefix) => canonicalFieldSet.has(prefix));

  const actualAbsent = canonicalRows.filter((row) => !emits(row.field));
  const actualExtra = [...codeKeys].filter((key) => !isCanonical(key));

  const knownAbsentIds = new Set(known.absent.map((entry) => entry.elementId));
  const knownExtraKeys = new Set(known.extra.map((entry) => entry.key));

  const messages = [];

  for (const row of actualAbsent) {
    if (!knownAbsentIds.has(row.elementId)) {
      messages.push(
        `${entity} ${row.elementId} '${row.field}' (${row.cardinality} ${row.requirement}) is `
          + 'absent from the runtime object and not declared in KNOWN_DRIFT -- new drift: '
          + 'either make the code emit it, or add a KNOWN_DRIFT entry whose TODO(#N) names the issue that fixes it'
      );
    }
  }
  for (const entry of known.absent) {
    if (!actualAbsent.some((row) => row.elementId === entry.elementId)) {
      messages.push(
        `${entity} KNOWN_DRIFT.absent entry ${entry.elementId} '${entry.field}' is stale -- `
          + 'the code now emits this field, so the allowance no longer corresponds to real '
          + 'drift; remove the entry'
      );
    }
  }
  for (const key of actualExtra) {
    if (!knownExtraKeys.has(key)) {
      messages.push(
        `${entity} code key '${key}' has no canonical catalog counterpart and is not declared `
          + 'in KNOWN_DRIFT -- new drift: either remove the key, rename it to the canonical '
          + 'field, or add a KNOWN_DRIFT entry whose TODO(#N) names the issue that fixes it'
      );
    }
  }
  for (const entry of known.extra) {
    if (!actualExtra.includes(entry.key)) {
      messages.push(
        `${entity} KNOWN_DRIFT.extra entry '${entry.key}' is stale -- the code no longer `
          + 'emits an unmatched key by that name, so the allowance no longer corresponds to '
          + 'real drift; remove the entry'
      );
    }
  }

  return messages;
}

test('flattenKeys treats a null value and a Date instance as leaves, never recursing into them', () => {
  // Both traps are live in SecurityConfiguration's own getDefaultConfig()
  // output (lastUpdatedBy: null, lastUpdatedAt: new Date()) -- a naive
  // `typeof v === 'object'` recursion yields zero leaves for either and the
  // field silently vanishes, which would make the conformance test below
  // pass by omission rather than by an honest match. Pinned directly here,
  // independent of getDefaultConfig()'s actual current shape.
  const paths = flattenKeys({ a: null, b: new Date(), c: { d: 1 } });
  assert.deepEqual(paths, ['a', 'b', 'c.d']);
});

test('#967: every registered entity has at least one canonical catalog row', () => {
  // A typo'd entity name in ENTITY_TARGETS or KNOWN_DRIFT would silently
  // compare against zero catalog rows -- every field would read as "extra",
  // which offendersIn-style guards elsewhere in this suite treat as the
  // under-collection risk worth a floor check for.
  const catalog = loadCanonicalDictionary();
  const missing = Object.keys(ENTITY_TARGETS).filter(
    (entity) => !catalog.some((row) => row.entity === entity)
  );
  assert.deepEqual(missing, [], `no catalog rows at all for: ${missing.join(', ')} -- check the entity name`);
});

test('#967: canonical catalog fields match the runtime shape ENTITY_TARGETS produce, modulo KNOWN_DRIFT', () => {
  const catalog = loadCanonicalDictionary();
  const messages = [];

  for (const [entity, buildCodeObject] of Object.entries(ENTITY_TARGETS)) {
    const canonicalRows = catalog.filter((row) => row.entity === entity);
    const known = KNOWN_DRIFT[entity] || { absent: [], extra: [] };
    messages.push(...diffEntity(entity, canonicalRows, buildCodeObject(), known));
  }

  assert.deepEqual(
    messages,
    [],
    'catalog.2.0.0.json field names and the runtime object the code actually '
      + 'produces disagree, in a way KNOWN_DRIFT does not (yet) account for. '
      + '1..1 Core absences are the serious class -- fix the code, or file the '
      + 'drift as a KNOWN_DRIFT entry with a one-line note and the TODO(#N) that fixes it:\n  '
      + messages.join('\n  ')
  );
});

test('#967: the guard actually detects new drift, a clean match, and a stale KNOWN_DRIFT entry', () => {
  // The failure mode of "compare two sets and assert equal" is a silently
  // vacuous comparison (e.g. both sides accidentally empty) -- so exercise
  // diffEntity directly against synthetic catalog rows and a synthetic code
  // object, entirely separate from ENTITY_TARGETS/KNOWN_DRIFT above.
  const canonicalRows = [
    { elementId: 'X-1', entity: 'Widget', field: 'a', cardinality: '1..1', requirement: 'Core' },
    { elementId: 'X-2', entity: 'Widget', field: 'b', cardinality: '0..1', requirement: 'Essencial' }
  ];

  // Undeclared: 'a' matches (silent, correctly not reported), 'b' is
  // absent from the code, and 'c' is an extra code key -- neither is in any
  // KNOWN_DRIFT allowance, so both must be flagged.
  const undeclared = diffEntity('Widget', canonicalRows, { a: 1, c: 2 });
  assert.equal(undeclared.length, 2, `expected exactly 2 messages, got:\n  ${undeclared.join('\n  ')}`);
  assert.ok(undeclared.some((m) => m.includes("X-2 'b'")), "missing 'b' absence message");
  assert.ok(undeclared.some((m) => m.includes("key 'c'")), "missing 'c' extra-key message");

  // Declaring both in KNOWN_DRIFT silences them.
  const known = {
    absent: [{ elementId: 'X-2', field: 'b' }],
    extra: [{ key: 'c' }]
  };
  const declared = diffEntity('Widget', canonicalRows, { a: 1, c: 2 }, known);
  assert.deepEqual(declared, [], `a fully-declared drift set still reported:\n  ${declared.join('\n  ')}`);

  // If the code is then fixed (b now emitted, c no longer emitted), the
  // same KNOWN_DRIFT table is now stale on both entries -- that must be
  // flagged too, or the table could rot indefinitely once a fix lands.
  const stale = diffEntity('Widget', canonicalRows, { a: 1, b: 2 }, known);
  assert.equal(stale.length, 2, `expected exactly 2 staleness messages, got:\n  ${stale.join('\n  ')}`);
  assert.ok(stale.every((m) => m.includes('stale')), `expected only staleness messages:\n  ${stale.join('\n  ')}`);
});

test('a structured canonical field matches the leaves the code emits under it, and only those', () => {
  // Encounter.encounterPeriod is one Period row; the model emits
  // { start, end } under it. A leaf under a canonical field is that field.
  // A sibling that merely shares the name's start ('aPeriodic') is not, and
  // a dotted canonical leaf ('rules.min') does not make its parent canonical.
  const canonicalRows = [
    { elementId: 'X-1', entity: 'Widget', field: 'aPeriod', cardinality: '1..1', requirement: 'Core' },
    { elementId: 'X-2', entity: 'Widget', field: 'rules.min', cardinality: '1..1', requirement: 'Core' }
  ];
  const code = { aPeriod: { start: 1, end: 2 }, aPeriodic: 3, rules: { min: 4, max: 5 } };
  const messages = diffEntity('Widget', canonicalRows, code);
  assert.equal(messages.length, 2, `expected exactly 2 messages, got:\n  ${messages.join('\n  ')}`);
  assert.ok(messages.some((m) => m.includes("key 'aPeriodic'")), "missing 'aPeriodic' extra-key message");
  assert.ok(messages.some((m) => m.includes("key 'rules.max'")), "missing 'rules.max' extra-key message");
});
