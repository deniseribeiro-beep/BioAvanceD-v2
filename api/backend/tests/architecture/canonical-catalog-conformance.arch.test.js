// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.
//
// #967: catalog.2.0.0.json (the approved v2.0.0 release, 1644 elements,
// generated from docs/extracted-v2.0.0/dict-DICIONARIO.md -- see
// canonical-dictionary/v2.js's own header) names the canonical
// field for every entity, and nothing in the repo compared those names
// against the shape the runtime code actually produces. This is that
// comparison, for 26 entities: SecurityConfiguration (a service singleton's
// getDefaultConfig()) plus 25 models exposing a pure `static fieldsOf(data =
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
  DatasetSnapshot: () => require('../../src/models/DatasetSnapshot').fieldsOf(),
  DatasetPartition: () => require('../../src/models/DatasetPartition').fieldsOf(),
  FeatureDefinition: () => require('../../src/models/FeatureDefinition').fieldsOf(),
  LabelDefinition: () => require('../../src/models/LabelDefinition').fieldsOf(),
  CohortDefinition: () => require('../../src/models/CohortDefinition').fieldsOf(),
  DeidentificationProcess: () => require('../../src/models/DeidentificationProcess').fieldsOf(),
  DatasetRepresentativenessAssessment: () => require('../../src/models/DatasetRepresentativenessAssessment').fieldsOf(),
  CollectionGovernanceApproval: () => require('../../src/models/CollectionGovernanceApproval').fieldsOf(),
  BiorepositoryContext: () => require('../../src/models/CollectionGovernanceContext').biorepositoryFieldsOf(),
  BiobankGovernanceContext: () => require('../../src/models/CollectionGovernanceContext').biobankFieldsOf(),
  CollectionGovernanceEvent: () => require('../../src/models/CollectionGovernanceEvent').fieldsOf(),
  ConsentDecisionEvent: () => require('../../src/models/ConsentDecisionEvent').fieldsOf(),
  ConsentRevocation: () => require('../../src/models/ConsentRevocation').fieldsOf(),
  ConsentAuthorizationDecision: () => require('../../src/models/ConsentAuthorizationDecision').fieldsOf(),
  ConsentPermission: () => require('../../src/models/ConsentPermission').fieldsOf(),
  ConsentCommunicationEvent: () => require('../../src/models/ConsentCommunicationEvent').fieldsOf(),
  AllergyIntolerance: () => require('../../src/models/AllergyIntolerance').fieldsOf(),
  ClinicalObservation: () => require('../../src/models/ClinicalObservation').fieldsOf(),
  ConfigurationChangeEvent: () => require('../../src/models/ConfigurationChangeEvent').fieldsOf(),
  ConfigurationProfile: () => require('../../src/models/ConfigurationProfile').fieldsOf(),
  ConfigurationRelease: () => require('../../src/models/ConfigurationRelease').fieldsOf(),
  CanonicalModelRelease: () => require('../../src/models/CanonicalModelRelease').fieldsOf(),
  InteroperabilityMappingRelease: () => require('../../src/models/InteroperabilityMappingRelease').fieldsOf(),
  FHIRProfileRegistry: () => require('../../src/models/FHIRProfileRegistry').fieldsOf(),
  Biobank: () => require('../../src/models/Biobank').fieldsOf(),
  BiomarkerAssociation: () => require('../../src/models/BiomarkerAssociation').fieldsOf(),
  Network: () => require('../../src/models/Network').fieldsOf(),
  ResearchResource: () => require('../../src/models/ResearchResource').fieldsOf(),
  ResearchResourceCollection: () => require('../../src/models/ResearchResourceCollection').fieldsOf(),
  ResearchResourceBiobank: () => require('../../src/models/ResearchResourceBiobank').fieldsOf(),
  ImagingStudy: () => require('../../src/models/ImagingStudy').fieldsOf(),
  ImagingDerivedData: () => require('../../src/models/ImagingDerivedData').fieldsOf(),
  ConfigurationValidationRun: () => require('../../src/models/ConfigurationValidationRun').fieldsOf(),
  GovernanceInvariantCatalog: () => require('../../src/models/GovernanceInvariantCatalog').fieldsOf(),
  InvariantViolation: () => require('../../src/models/InvariantViolation').fieldsOf(),
  GovernanceInvariant: () => require('../../src/models/GovernanceInvariantCatalog').invariantFieldsOf(),
  ClinicalOutcome: () => require('../../src/models/ClinicalOutcome').fieldsOf(),
  Condition: () => require('../../src/models/Condition').fieldsOf(),
  DiagnosticReport: () => require('../../src/models/DiagnosticReport').fieldsOf(),
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
  TelemetryExposureSummary: () => require('../../src/models/TelemetryExposureSummary').fieldsOf(),
  StorageLocation: () => require('../../src/models/StorageLocation').fieldsOf(),
  OperationalStateDecision: () => require('../../src/models/OperationalStateDecision').fieldsOf(),
  StorageRack: () => require('../../src/models/StorageRack').fieldsOf(),
  StoragePosition: () => require('../../src/models/StoragePosition').fieldsOf(),
  LabelIdentifier: () => require('../../src/models/LabelIdentifier').fieldsOf(),
  IdentifierNamespaceRegistry: () => require('../../src/models/IdentifierNamespaceRegistry').fieldsOf(),
  IdentificationPolicy: () => require('../../src/models/IdentificationPolicy').fieldsOf(),
  ScanEvent: () => require('../../src/models/ScanEvent').fieldsOf(),
  CustodianshipAssignment: () => require('../../src/models/CustodianshipAssignment').fieldsOf(),
  Shipment: () => require('../../src/models/Shipment').fieldsOf(),
  DataFileVersion: () => require('../../src/models/DataFileVersion').fieldsOf(),
  TelemetryDatastream: () => require('../../src/models/TelemetryDatastream').fieldsOf(),
  TelemetryIngestionEvent: () => require('../../src/models/TelemetryIngestionEvent').fieldsOf(),
  TelemetryValidationIssue: () => require('../../src/models/TelemetryValidationIssue').fieldsOf(),
  DeviceRegistration: () => require('../../src/models/DeviceRegistration').fieldsOf(),
  PhysicalIdentificationValidationProtocol: () => require('../../src/models/PhysicalIdentificationValidationProtocol').fieldsOf(),
  UserRoleAssignment: () => require('../../src/models/UserRoleAssignment').fieldsOf(),
  UserAccount: () => require('../../src/models/User').fieldsOf(),
  AccessGrant: () => require('../../src/models/Access').fieldsOf(),
  Session: () => require('../../src/models/Session').fieldsOf(),
  RecoveryCodeSet: () => require('../../src/models/RecoveryCodeSet').fieldsOf(),
  DataQualityAssessment: () => require('../../src/models/DataQualityAssessment').fieldsOf(),
  ReferenceCoverageManifest: () => require('../../src/models/ReferenceCoverageManifest').fieldsOf(),
  RCSInputSnapshot: () => require('../../src/models/RcsInputSnapshot').fieldsOf(),
  RCSPreanalyticalAxisInput: () => require('../../src/models/RcsPreanalyticalAxisInput').fieldsOf(),
  RCSGovernanceEvidenceSnapshot: () => require('../../src/models/RcsGovernanceEvidenceSnapshot').fieldsOf(),
  RCSRulePackage: () => require('../../src/models/RcsRulePackage').fieldsOf(),
  RCSValidationStudy: () => require('../../src/models/RcsValidationStudy').fieldsOf(),
};

// Drift measured against catalog.1.3.0.json, 2026-09-02, and re-measured
// against catalog.2.0.0.json, 2026-10-07, via loadCanonicalDictionary() and
// each ENTITY_TARGETS entry above. The v2.0.0 re-measure changed only
// RCSAssessment: V2E elements absent, which name the issue that builds
// them (TODO(#1320)) and which the RCS v4 slices have since emitted in
// part, and two former extras (finalGrade, gradeRoute) that
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
  ImagingStudy: {
    absent: [],
    extra: [
      {
        key: 'imagingStudyId',
        note: "Deliberate: the master-data router's idField, the key GET/PUT /api/imaging-studies/:id looks a study up by. The dictionary gives ImagingStudy no id row (ELM-0353..0354)."
      }
    ]
  },
  ImagingDerivedData: {
    absent: [],
    extra: [
      {
        key: 'imagingDerivedDataId',
        note: "Deliberate: the master-data router's idField, the key GET/PUT /api/imaging-derived-data/:id looks a row up by. The dictionary gives ImagingDerivedData no id row (ELM-0355..0356)."
      }
    ]
  },
  ParticipantIdentity: {
    absent: [
      { elementId: 'P1X-0356', field: 'clinicalUnitId', note: 'Deliberate absence: 0..1 Condicional -- the clinical unit is Patient.clinicalUnitId, the tenancy key patient routes scope on; a copy here would go stale at a reparent. See docs/decisions/2026-10-17-participant-identity-names-and-fields.md.' },
      { elementId: 'P1X-0363', field: 'lastVerifiedAt', note: 'Deliberate absence: 0..1 Condicional -- its condition never holds: no flow verifies an identity, and re-identification only reads and audits it. See docs/decisions/2026-10-17-participant-identity-names-and-fields.md.' },
      { elementId: 'P1X-0364', field: 'verifiedBy', note: 'Deliberate absence: 0..1 Condicional -- its condition never holds: no flow verifies an identity, and no Actor entity exists to reference. See docs/decisions/2026-10-17-participant-identity-names-and-fields.md.' }
    ],
    extra: [
      {
        key: 'identityDocument',
        note: 'Deliberate: the plaintext input that encryptIdentityFields enciphers into identityDocumentCiphertext (P1X-0354) and then nulls, so no stored record holds a value here. See docs/decisions/2026-10-17-participant-identity-names-and-fields.md, item 5.'
      },
      {
        key: 'representativeIdentityDocument',
        note: 'Deliberate: the plaintext input that encryptIdentityFields enciphers into representativeIdentityDocumentCiphertext (P1X-0359) and then nulls, so no stored record holds a value here. See docs/decisions/2026-10-17-participant-identity-names-and-fields.md, item 5.'
      },
      {
        key: 'recordNumber',
        note: 'Deliberate: the plaintext input that encryptIdentityFields enciphers into recordNumberCiphertext (P1X-0355) and then nulls, so no stored record holds a value here. See docs/decisions/2026-10-17-participant-identity-names-and-fields.md, item 6.'
      }
    ]
  },
  RCSAssessment: {
    absent: [
      { elementId: 'ELM-0160', field: 'rcsGrade', note: 'TODO(#1320): 0..1 Core -- not emitted; finalGrade is its own v2.0.0 element (V2E-0541), so it is not a rename of this one.' },
      { elementId: 'ELM-0161', field: 'rcsModelVersion', note: 'TODO(#1320): 1..1 Core -- code emits modelVersion (extra below), not this canonical name.' },
      { elementId: 'ELM-0162', field: 'sprecRcsMappingVersion', note: 'TODO(#1320): 1..1 Core -- not emitted.' },
      { elementId: 'ELM-0164', field: 'governanceGateResult', note: 'TODO(#1320): 1..1 Core -- code emits governanceStatus (extra below), not this canonical name.' },
      { elementId: 'ELM-0165', field: 'unmappedCodes', note: 'TODO(#1320): 0..* Condicional -- not emitted.' },
      { elementId: 'ELM-0166', field: 'rcsCalculatedAt', note: 'TODO(#1320): 0..1 Core -- not emitted by fieldsOf(); create() sets a separate assessedAt outside fieldsOf().' },
      { elementId: 'P1X-0062', field: 'sprecProfileId', note: 'TODO(#1320): 1..1 Core -- not emitted; no reference back to the SpecimenPreanalytics snapshot this assessment was computed from.' },
      { elementId: 'P1X-0064', field: 'biologicalPenalty', note: 'TODO(#1320): 0..1 Condicional -- not emitted.' },
      { elementId: 'P1X-0066', field: 'decisionRoute', note: 'TODO(#1320): 1..1 Core -- not emitted; gradeRoute is its own v2.0.0 element (V2E-0542), so it is not a rename of this one.' },
      { elementId: 'P1X-0067', field: 'governanceChecks', note: 'TODO(#1320): 1..* Core -- code emits governanceRuleCodes (extra below), not this canonical name.' },
      { elementId: 'P1X-0068', field: 'governanceFailureCodes', note: 'TODO(#1320): 0..* Condicional -- code emits governanceFailureReasons (extra below), not this canonical name.' },
      { elementId: 'P1X-0070', field: 'evidenceRefs', note: 'TODO(#1320): 0..* Essencial -- not emitted.' },
      { elementId: 'P1X-0071', field: 'calculationStatus', note: 'TODO(#1320): 1..1 Core -- code emits calculationTrace (extra below), a free-form value, not this canonical status field.' }
    ],
    extra: [
      { key: 'modelVersion', note: 'TODO(#1320): no canonical counterpart; likely predecessor of rcsModelVersion (ELM-0161, absent above).' },
      { key: 'governanceStatus', note: 'TODO(#1320): no canonical counterpart; likely predecessor of governanceGateResult (ELM-0164, absent above).' },
      { key: 'governanceFailureReasons', note: 'TODO(#1320): no canonical counterpart; likely predecessor of governanceFailureCodes (P1X-0068, absent above).' },
      { key: 'governanceRuleCodes', note: 'TODO(#1320): no canonical counterpart; likely predecessor of governanceChecks (P1X-0067, absent above).' },
      { key: 'axisPenalties', note: 'TODO(#1320): no canonical counterpart; the score-route penalties the Merkle hash reads, kept beside rcsAxisResults (ELM-0163).' },
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
      { elementId: 'P1X-0182', field: 'userAccountId', note: "Deliberate absence: 1..1 Core -- the account's id is its Mongo _id, which every reference already stores as userAccountId; fieldsOf runs before insertion, so it cannot emit _id. See docs/decisions/2026-10-17-user-account-absent-elements.md." },
      { elementId: 'P1X-0183', field: 'actorId', note: 'Deliberate absence: 1..1 Core -- no Actor entity exists in the code; every recorded actorId is the user id itself. See docs/decisions/2026-10-17-user-account-absent-elements.md.' },
      { elementId: 'P1X-0188', field: 'institutionLegacy', note: 'Deliberate absence: 0..1 Extensão local -- the institution migration it aliases is finished (migrateUserOrganizations.js, #347); the document carries organizationId. See docs/decisions/2026-10-17-user-account-absent-elements.md.' },
      { elementId: 'P1X-0191', field: 'accessTypeLegacy', note: "Deliberate absence: 0..1 Extensão local -- the 1-4 level is no longer stored on the user; it is resolved from the active role's hierarchyLevel (rbac-assignment.service.js resolveUserHierarchyLevel). See docs/decisions/2026-10-17-user-account-absent-elements.md." },
      { elementId: 'P1X-0192', field: 'primaryRoleId', note: 'Deliberate absence: 1..1 Core -- the primary role is derived from the active UserRoleAssignment (rbac-assignment.service.js changeUserRole), not stored on the user. See docs/decisions/2026-10-17-user-account-absent-elements.md.' },
      { elementId: 'P1X-0196', field: 'mfaMethod', note: "Deliberate absence: 0..1 Condicional -- only TOTP exists, fixed by policy (securitySettingCatalog.js authentication.mfaMethod enum ['totp']), so a per-account copy records nothing. See docs/decisions/2026-10-17-user-account-absent-elements.md." },
      { elementId: 'P1X-0201', field: 'mfaLockedUntil', note: "Deliberate absence: 0..1 Condicional -- its condition never holds: no MFA lock-duration policy exists, and the mfaLocked flag is cleared only by an administrator's reset-mfa. See docs/decisions/2026-10-17-user-account-absent-elements.md." }
    ],
    extra: [
      { key: 'accountLockedUntil', note: "Deliberate local extension: the expiry of RF001 AC2's temporary password lock (#952), which every password check reads; dict-02 has no password-side lock expiry." },
      { key: 'roleValidFrom', note: 'Deliberate local extension: RF003 AC3 role validity, set by PUT /api/users/:id; no UserAccount row (UserRoleAssignment.validFrom is the assignment-level field).' },
      { key: 'roleValidUntil', note: 'Deliberate local extension: RF003 AC3 role validity, set by PUT /api/users/:id and enforced by the authenticate middleware on every request; no UserAccount row (UserRoleAssignment.validUntil is the assignment-level field).' },
      { key: 'organizationIds', note: 'Deliberate local extension: RF003 AC3 role scope on the user document, set by PUT /api/users/:id and read by the organization reference check; no UserAccount row (UserRoleAssignment.scopeId is the assignment-level field).' },
      { key: 'createdAt', note: "Deliberate local extension: BaseRecord's creation instant (ELM-0006), which UserAccount's rows do not repeat; create() stamps it, and password.service.js's expiry anchor falls back to it after passwordChangedAt and lastPasswordChange." },
      { key: 'updatedAt', note: "Deliberate local extension: BaseRecord's last-update instant (ELM-0008), which UserAccount's rows do not repeat; the user writes in auth.service.js and user-security.service.js stamp it." }
    ]
  },
  AccessGrant: {
    absent: [
      { elementId: 'P1X-0242', field: 'reportTypeLegacy', note: "TODO(#1201): 0..1 Extensão local -- dict-02 names it the alias of the Access model's reportType, which the grant still stores under that name (extra below); the API, the frontend's Access type and the report grant check read it." },
      { elementId: 'P1X-0244', field: 'accessTypeLegacy', note: "TODO(#1201): 0..1 Extensão local -- dict-02 names it the Access model's 1-4 level, which the grant still stores as accessType (extra below)." }
    ],
    extra: [
      { key: 'reportID', note: 'Deliberate: the API key a grant is created and updated by, and the report id the RF002 AC4 grant check reads first; resourceId (P1X-0241) carries the same value under its canonical name.' },
      { key: 'reportType', note: 'TODO(#1201): stored name of P1X-0242 reportTypeLegacy (absent above).' },
      { key: 'accessType', note: 'TODO(#1201): stored name of P1X-0244 accessTypeLegacy (absent above).' },
      { key: 'createdAt', note: 'TODO(#1201): record timestamp with no AccessGrant row.' },
      { key: 'updatedAt', note: 'TODO(#1201): record timestamp with no AccessGrant row; the update and the revocation stamp it.' }
    ]
  },
  Session: {
    absent: [],
    extra: [
      { key: 'updatedAt', note: 'Deliberate local extension: every session write stamps it, the revocation audit reads it (#974); no canonical row.' }
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
