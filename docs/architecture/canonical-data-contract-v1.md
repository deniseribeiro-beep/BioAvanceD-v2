# Canonical Data Contract v1

## Purpose

This document defines the canonical v1 runtime contract for BioAvanceD.

- MongoDB is the operational source of truth.
- Neo4j is a projection fed by the outbox.
- FHIR is a pure serialization and interoperability boundary.
- Legacy aliases are not part of the canonical contract.

## Naming Convention

- English in code.
- `camelCase` for fields.
- Singular for objects.
- Plural only for arrays.
- `Id` for identifiers.
- `At` for timestamps.
- `Date` only for date-only values.
- No snake_case and camelCase mixing in canonical runtime payloads.

## Canonical Fields

### Participant

- `participantId`
- `patientName` (segregated, see ParticipantIdentity below — not returned by
  the `GET /api/patients/:id` participant resource as of #363)
- `birthDate` (segregated, see ParticipantIdentity below — not returned by
  the `GET /api/patients/:id` participant resource as of #363)
- `sex`
- `email`
- `phone`
- `identityDocument` (segregated, see ParticipantIdentity below — not
  returned by the `GET /api/patients/:id` participant resource as of #363)
- `recordNumber`
- `isDeceased`
- `clinicalUnitId` (migrating to Reference(Organization), per dictionary
  P1X-0356 — accepts an `organizationId` reference as of #351. A one-time
  data migration, `migrateClinicalUnitOrganizations.js` (#352), resolves
  existing free-text/ObjectId values to real `Organization` docs so
  historical patient records aren't left behind. `patient.service.js`'s
  `resolveClinicalUnitSnapshot` now resolves exclusively against
  `organizations` (by `organizationId`, then by normalized name) — the
  legacy `clinicalUnits`-collection ObjectId/name lookup was retired in
  #353. `patient.service.js`'s free-text search/filter paths
  (`listPatients`'s `filters.clinicalUnit` exact match, `searchPatients`'s
  `clinicalUnit` regex clause) were decided (#355) to stay as-is: both
  query `patients.clinicalUnit` directly, and that field is now reliably
  populated from `Organization.officialName` by
  `resolveClinicalUnitSnapshot`, so no Organization-based replacement
  (e.g. filtering by `organizationId`) is needed — regression-covered by
  `patient.service.clinicalUnitSearch.unit.test.js`. `paciente.controller.js`'s
  `clinicalUnitId`/`clinicalUnit`/`unitAcronym` allowlist and
  normalization were decided (#356) to stay as-is too: the allowlist
  already accepts `clinicalUnitId` as an opaque `organizationId`
  reference and forwards it unmangled (in particular, unlike
  `clinicalUnit`/`unitAcronym`, it is never case-folded) into
  `resolveClinicalUnitSnapshot` — regression-covered by
  `paciente.controller.clinicalUnitAllowlist.unit.test.js`.
  `clinical-unit.routes.js`'s CRUD/search surface (`/api/clinical-units`
  and its `clinicalUnits` collection) was retired outright in #357: no
  backend code has read/written that collection since #353, and the
  frontend's `clinicalUnitService`/`useClinicalUnits` hook that called it
  were themselves dead code (never imported by any component) — regression-
  covered by `clinical-unit.routes.retirement.test.js` asserting the
  routes now 404.

### ParticipantIdentity

RF005/RNF007, dict-07_ALINHAMENTO_CODIGO.md row 1 / migration table row 2
("Segregar, cifrar e não projetar ao grafo"). Civil identity, segregated
from the scientific `Participant` record behind reinforced access controls
(`ParticipantIdentity.js`, `participantIdentities` collection):

- `participantId` (foreign key back to `Participant`)
- `patientName`
- `birthDate`
- `identityDocument`
- `email`
- `phone`
- `representativeName`
- `representativeEmail`
- `representativeIdentityDocument`
- `representativePhone`

**Landed in #363:** the entity/collection exists and is dual-written
alongside `Patient` at intake (`patient.service.js#createPatient`); the
`GET /api/patients/:id` participant resource
(`paciente.controller.js#buscar`) no longer returns `patientName`/
`birthDate`/`identityDocument` as direct fields, for any caller regardless
of `createPatient` permission (RNF007 AC#1/AC#2).

**Not yet landed (follow-up tracked separately):** the `Patient` document
itself still carries these fields internally — 20+ existing consumers
(search, consent notifications, exports, FHIR/import staging, audit
logging) still read them off `Patient`, so removing them from that
document is a larger migration than this slice. Also outstanding: an
authorized, audited re-identification flow (RNF007 AC#4/AC#5) and
encryption at rest for the segregated collection ("cifrar").

### Specimen

- `specimenId`
- `participantId`
- `sampleType`
- `sampleOrigin`
- `extractionProtocol`
- `barcode`
- `quantity`
- `unit`
- `registeredAt`
- `lifecycleStatus`
- `linkedProject`
- `collectionSite` (Reference(Organization), per dictionary ELM-0128)
- `merkleRoot`
- `sprec`

**Not yet landed (follow-up tracked separately):** dict-07/dict-08 call for
`Specimen` + `SPREC` + `RCS` + storage/custody as four separate canonical
entities, referenced (not duplicated) from each other — `Sample.js` still
carries `sprec` and the storage/custody fields (`locationId`, `location`,
`storageLocation`, `lifecycleStatus`, `availabilityStatus`,
`quarantineStatus`, ...) directly. `RcsAssessment` and
`SpecimenPreanalytics` below are the first two of the three separations to
land (#383, #388); storage/custody remains filed as its own follow-up
(#389).

### RcsAssessment

- `specimenId` (reference to `Specimen`, not a duplicate — dict-07 row 38:
  "Não duplicar fonte canônica")
- `modelVersion`
- `matrixType`
- `governanceStatus`
- `governanceFailureReasons`
- `governanceRuleCodes`
- `rcsScore`
- `scoreBasedGrade`
- `finalGrade`
- `gradeRoute`
- `axisPenalties`
- `calculationTrace`
- `assessedAt` (each `certify()` run is its own versioned snapshot, per
  dict-07's "usar referências e snapshots versionados" — multiple
  documents may exist per `specimenId`, newest first)

**Landed in #383:** the entity/collection (`rcsAssessments`) exists;
`import.service.js`'s CSV/XLSX sample-import path records a snapshot
alongside every RCS certification it computes, referenced by
`specimenId`; `GET /api/samples/:id/rcs-assessments` resolves the
versioned history for a specimen (mirrors the existing
`SampleMovement`/`GET /:id/movements` pattern).

**Not yet landed (follow-up tracked separately):** `Sample.js` still
carries its own embedded copy of the same RCS fields (`rcsScore`,
`rcsEvaluation`, `calculationTrace`, `axisPenalties`, ...) — removing
that duplication requires migrating every consumer that reads RCS data
directly off `Sample` (MerkleService, neo4j canonical projection,
frontend types, the live `POST /api/samples` registration path, which
doesn't compute RCS server-side at all today). Also outstanding: the
JSON-import branch of `importSamples` doesn't compute or record RCS
either (only the CSV/XLSX branch does).

### SpecimenPreanalytics

- `specimenId` (reference to `Specimen`, not a duplicate — dict-07 row 38:
  "Não duplicar fonte canônica"; dict-02 P1X-0058)
- `matrixType`
- `sampleType`
- `primaryContainer`
- `preCentrifugation`
- `centrifugation`
- `secondCentrifugation`
- `postCentrifugationDelay`
- `longTermStorage`
- `recordedAt` (each import is its own versioned snapshot, per dict-07's
  "usar referências e snapshots versionados" — row 38 groups SPREC with
  RCS under the same directive `RcsAssessment` above uses — multiple
  documents may exist per `specimenId`, newest first)
- `sprecCode` (ELM-0145, compact original SPREC code — preserved as given
  from `sprec_code`/`sprecCode`, never recomputed from the fields below)
- `sprecVersion` (ELM-0146, SPREC standard version used to encode it)
- `sprecProfileId` (P1X-0057, immutable UUID identifying this profile
  *version* — generated per snapshot via `crypto.randomUUID()`, same
  pattern as `PatientConsentModel`'s `consentId`, #364)
- `profileStatus` (P1X-0059, `draft` | `validado` | `substituído` |
  `inválido` — defaults to `draft`; nothing in the codebase confirms/
  validates a profile yet)
- `sprecSpecimenType` (ELM-0147, fluid/solid axis element 1 — derived
  from `sampleType`, applies to both matrix types)
- `sprecPrimaryContainer` (ELM-0148, fluid axis element 2 — derived from
  `primaryContainer` when `matrixType` is `fluid`, else `null`)
- `sprecCollectionType` (ELM-0149, solid axis element 2 — derived from
  `primaryContainer` when `matrixType` is `solid`, else `null`)
- `warmIschemiaTime` / `coldIschemiaTime` / `fixationStabilizationType` /
  `fixationTime` (ELM-0154–0157, solids only — derived from
  `preCentrifugation`/`centrifugation`/`secondCentrifugation`/
  `postCentrifugationDelay` when `matrixType` is `solid`, else `null`)
- `preCentrifugationDelay` / `firstCentrifugation` (ELM-0150/0151, fluids
  only — derived from `preCentrifugation`/`centrifugation` when
  `matrixType` is `fluid`, else `null`)

Named after dict-02's canonical entity (`SpecimenPreanalytics`,
ELM-0145–ELM-0166/P1X-0057–P1X-0059), not the "SPREC" shorthand
dict-07/dict-08 and issue #388 itself use — the same substitution #383
made for "RCS" → `RcsAssessment`.

**Landed in #388:** the entity/collection (`specimenPreanalytics`) exists;
`import.service.js`'s CSV/XLSX sample-import path records a snapshot
alongside every SPREC profile it already parses from `sprec_*` columns,
referenced by `specimenId`; `GET /api/samples/:id/sprec-profiles` resolves
the versioned history for a specimen (mirrors `RcsAssessment`/
`GET /:id/rcs-assessments`, #383).

**Landed in #392:** dict-02's fuller field set above. `matrixType`/
`sampleType`/`primaryContainer`/`preCentrifugation`/`centrifugation`/
`secondCentrifugation`/`postCentrifugationDelay`/`longTermStorage` (#388)
are generic axis-position slots (axis 1–7) populated straight from CSV
columns regardless of matrix type — mirroring
`frontend/src/constants/sprecDictionary.js`'s `SPREC_FLUID_DICTIONARY`
vs `SPREC_SOLID_DICTIONARY`, which relabel the same axis 2–6 slots per
matrix type. The new canonical fields are *derived* from those same
slots in `SpecimenPreanalyticsModel.fieldsOf()` based on `matrixType` —
`import.service.js`'s CSV parsing of the axis slots themselves is
unchanged, except for `sprecCode`/`sprecVersion`, which are genuinely new
pass-through values with no prior source. `preCentrifugationDelay`
(ELM-0150) and `firstCentrifugation` (ELM-0151) — the fluid-specific
canonical names for the `preCentrifugation`/`centrifugation` slots — were
out of scope for #392 (it only added the fields explicitly missing, not
a full rename of the fluid axis to its canonical names) and landed
separately below.

**Landed in #396:** `preCentrifugationDelay`/`firstCentrifugation` above,
the fluid-axis counterpart to #392's solid-axis derivation — same
pattern, same `SpecimenPreanalyticsModel.fieldsOf()`, no
`import.service.js` change needed since `preCentrifugation`/
`centrifugation` were already parsed by #388.

**Not yet landed (follow-up tracked separately):** `Sample.js` still
carries its own embedded `sprec` copy (only the axis slots +
`sprecCode`/`sprecVersion`, not the derived fields) — removing that
duplication requires migrating every consumer that reads it directly off
`Sample` (tracked in #390, alongside the equivalent RCS migration). The
JSON-import branch of `importSamples` doesn't record a profile either
(only the CSV/XLSX branch does, the same gap #383 left for RCS).

### Consent

- `consentId` (internal identity of the consent instance, distinct from
  the storage-layer `_id` — dict-02 ELM-0088; assigned at creation via
  `crypto.randomUUID()` in `PatientConsentModel.create`, #364)
- `consentTemplateId`
- `consentGranted`
- `consentAcceptedAt`

### Intake

- `participant`
- `legalRepresentative`
- `consent`
- `specimen`
- `diagnosis`
- `clinical`
- `biomarkers`

## Legacy Fields Prohibited

- `patientID`
- `patientId`
- `pseudoId`
- `sampleID`
- `sampleId`
- `registerDate`
- `registrationDate`
- `currentStatus`
- `selected_tcle`
- `tcle_id`
- `tcle_template_id`
- `merkle_root`
- `clinical_data`
- `legacy_compat`
- `quality_score`
- `quality_category`
- `penalty_log`
- `medication_name`
- `drug_name`
- `medication_code`
- `medication_drug_class`
- `atc_code`
- `atc_level_1`
- `last_dose_date`
- `washout_start_date`
- `washout_end_date`

## Removed Fields

- Legacy aliases and duplicated field names.
- `patient_name_confirmed`

## Intake Contract

See `api/backend/src/contracts/canonical/v1/index.js`.

## Outbox Contract

- `participantId`
- `specimenId`
- `parentSpecimenId`
- `consentId`
- `qualityAssessmentId`
- `telemetryIncidentId`

## FHIR Boundary

- FHIR conversion is pure and side-effect free.
- No database writes.
- No Neo4j access.
- No legacy aliases accepted.
- FHIR models are not persisted as operational collections.

## Operational Boundaries

- MongoDB stores the canonical operational data.
- Neo4j receives only projected graph data through the outbox.
- Collection aliases are not allowed for runtime routing or persistence.

## Alias Rejection Policy

- Unknown fields are rejected.
- Alias payloads must return HTTP 422.
- No silent field removal or auto-conversion.

## Known Residual Legacy Surfaces

The following files still contain residual aliases or transitional naming and are deferred to later PRs:

- `api/backend/src/interface/routes/sample.routes.js`
- `api/backend/src/interface/routes/reports.routes.js`
- `api/backend/src/routes/intakeWizard.js`
- `frontend/src/views/SampleDetailsPage.tsx`
- `frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx`
- `api/backend/src/services/analysisValidation.service.js`
- `api/backend/src/services/consent.validator.js`
- `api/backend/src/services/hl7.service.js`
- `api/backend/src/services/sampleComplianceSync.service.js`
- `api/backend/src/services/storageService.js`
- `api/backend/src/services/batch-validation-engine.service.js`
- `api/backend/src/services/import.service.js`
- `api/backend/src/services/import-lgpd.service.js`
- `api/backend/src/services/quality-compatibility.service.js`
- `api/backend/src/core/use-cases/*`

## Deferred Cleanup Plan

- PR 100 - Canonicalize participant flow
- PR 101 - Canonicalize specimen, custody and storage flow (RCS entity
  separation landed in #383; SPREC and storage/custody separation still
  outstanding, see `### RcsAssessment`'s "Not yet landed" note)
- PR 102 - Canonicalize frontend intake and active views
- PR 103 - Remove inactive legacy runtime files
- PR 104 - Build aggregate/domain matrix

## Deferred to PR 100

- Split of mixed-domain responsibilities.
- Larger frontend type cleanup beyond the main intake flow.
- Historical import templates and documentation-wide terminology cleanup.
