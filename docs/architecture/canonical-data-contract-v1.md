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
- `specimenStatus`
- `linkedProject`
- `collectionSite` (Reference(Organization), per dictionary ELM-0128)
- `merkleRoot`
- `sprec`

**Not yet landed (follow-up tracked separately):** dict-07/dict-08 call for
`Specimen` + `SPREC` + `RCS` + storage/custody as four separate canonical
entities, referenced (not duplicated) from each other — `Sample.js` still
carries `sprec` and the storage/custody fields (`locationId`, `location`,
`storageLocation`, ...) directly. `RcsAssessment` and
`SpecimenPreanalytics` below are the first two of the three separations to
land (#383, #388); storage/custody remains filed as its own follow-up
(#389).

**`locationId`/`location`/`locationID` are legacy, not a second storage
system (#453, resolved 2026-08-06):** #450's audit found these fields
alongside `storageLocation` and initially treated them as an unresolved
"maybe two systems" question. Settled against
`docs/docs-7-31-2026/manuscript/2.2-Additional_file_2_Polyglot_Persistence_Data_Model.docx`
(the current canonical data model, cited by
`docs/docs-7-31-2026/CHANGELOG-2026-07-31.md` as the fix for this file's
own staleness): the target model defines exactly one physical/inventory
entity pair — `StorageLocation` (physical hierarchy) + `StorageAssignment`
(specimen-to-position link), section 7.4. The legacy `Location` model
(`api/backend/src/models/Location.js`) — numeric
`equipmentType`/`equipmentID`/`block`/`rack`/`drawer`/`box`/`wellPosition`
fields — is a pre-normalization encoding of that same hierarchy, not an
independent system. Migration plan filed as #457 (mapping design,
foundational) → #458/#459 (consumer migration) → #460 (retire the legacy
API surface).

**#457 field mapping resolved 2026-08-06:** see
`docs/architecture/legacy-location-migration-mapping.md` for the
field-by-field mapping (`equipmentType` dropped as redundant/undocumented,
`equipmentID` joins directly to `Equipment.equipmentID` — no bridging table
needed, `block`/`rack` map onto existing `SHELF`/`RACK` container types,
`drawer` needs a new optional `DRAWER` container type with no current
equivalent, `box`/`wellPosition` map onto the existing `StorageBox`/
`positionCode`) and the one-time-backfill migration plan (not a read-time
translation layer).

**Status-field consolidation — decision recorded in #398, implementation
tracked in #399 (storage/custody split, part 2/3 of #389):**
`lifecycleStatus`/`availabilityStatus`/`quarantineStatus`/`quarantineReason`
collapse onto dict-02's single `Specimen.specimenStatus` (ELM-0123) plus a
new `QuarantineAction` referenced entity (P1X-0113–0119, section below) —
not a straight field rename. Reasoning, traced against the current code
(not just the issue's own scoping pass) and against both `dict-02` and
`requisitos-index.md` (RF006):

1. **`lifecycleStatus` → `specimenStatus`, case-folded, with two value-set
   gaps:**
   - 6 of 8 current values case-fold directly onto dict-02's enum:
     `AVAILABLE`/`PARTIAL`/`DEPLETED`/`UNAVAILABLE`/`DESTROYED`/
     `QUARANTINED` → `available`/`partial`/`depleted`/`unavailable`/
     `destroyed`/`quarantined`.
   - `REGISTERED` (current-only — `SampleModel.create()`'s pre-transaction
     default) has no dict-02 equivalent; dict-02's own example value for a
     newly-created specimen is `available`. Fold `REGISTERED` into
     `available` — `SampleModel.computeStatus()`'s sticky-status list never
     includes it, so nothing treats it as a distinct blockable state and no
     behavior changes.
   - `DISPOSED` (current-only) **cannot** fold into `destroyed`: RF006 AC#4
     (`requisitos-index.md`) names both as separately-blocking states
     ("Bloquear movimentação de espécime UNAVAILABLE, DESTROYED, DISPOSED
     ou QUARANTINED"), and dict-02's ELM-0123 enum has no `disposed` value.
     This is a real gap between the two Fase-1-authoritative docs
     (dictionary vs. requirements), not a naming quibble. Resolve it as a
     documented local extension of the `specimenStatus` domain (add
     `disposed` alongside the ELM-0123 baseline) — the same
     "extension beyond baseline" mechanism dict-02's own P1X-prefixed rows
     already use elsewhere in the dictionary. #399 carries this extension
     note to wherever `specimenStatus`'s validator/enum lives.
   - dict-02 additionally defines `reserved` and `checked_out`, which
     nothing in the current codebase produces yet. Not a blocker for #399 —
     carry them as valid-but-currently-unreachable values, the same way
     #388 left `SpecimenPreanalytics`'s fuller field set unproduced until
     #392 built the parsers.
   - `computeStatus()`'s sticky-quantity logic (Q3) carries over unchanged
     in shape: while `specimenStatus` is one of the terminal/blocked values
     (`unavailable`/`destroyed`/`disposed`/`quarantined`), quantity changes
     must not override it; only outside that set does quantity drive
     `depleted`/`partial`/`available`. #399 renames the sticky list's
     contents, not the algorithm.

2. **`availabilityStatus` does not survive as its own field.** Every real
   write site (`intakeWizard.js`, `intakeWizard.routes.js`,
   `equipment-sensor-quarantine.service.js`, `fhir-import-staging.service.js`)
   sets it in lockstep with `quarantineStatus` — `'BLOCKED'`+`'QUARANTINED'`,
   `'AVAILABLE'`+`'RELEASED'`, or `'PENDING_REVIEW'`+`'PENDING_REVIEW'` —
   never independently, and dict-02 has no parallel `Specimen` field for it
   (only `specimenStatus` and the separate `availabilityReason`, ELM-0124,
   a reason code, not a status). This corrects #398's own scoping-pass
   note that `availabilityStatus` was "never recomputed anywhere found" —
   it's actively read/written across four services, just never
   *independently* of `quarantineStatus`, which is what actually settles
   the question: it's a redundant coarse duplicate of the same signal, so
   nothing is lost by dropping it in favor of `specimenStatus` alone.
   `'BLOCKED'` collapses into whichever coarse `specimenStatus` value
   (`unavailable`/`quarantined`) it always accompanied — it was never an
   independent value.

3. **`quarantineStatus`/`quarantineReason` split across two dict-02
   entities, both needed:**
   - The *current-state* bit folds into `specimenStatus`'s `quarantined`
     value — the same single field as everything else, not a parallel
     status.
   - The *event history* — why, when it started, when it was released, who
     authorized it — has no home in the current flat two-field shape, and
     real code already wants more than two fields:
     `equipment-sensor-quarantine.service.js` also tracks `quarantinedAt`,
     `quarantineSource`/`quarantineSourceId`, and a separate
     `quarantineReasonCode`, none of which exist on `Sample.js`'s schema
     (written via the native driver, so nothing validates them). This is
     exactly what dict-02's `QuarantineAction` entity (P1X-0113–0119,
     below) models: `specimenIds` (1..*, so one action can cover a batch —
     matches the equipment-quarantine flow's batch-quarantine of every
     specimen tied to one sensor incident), `reasonCodes`
     (`CodeableConcept[]`, richer than today's single string),
     `startedAt`/`releasedAt`, `authorizedBy`. Follow the
     `RcsAssessment`/`SpecimenPreanalytics` pattern (#383/#388): a
     referenced, append-only entity, not embedded fields —
     `availabilityReason` (ELM-0124) stays the FHIR-boundary-facing coarse
     reason on `Specimen` itself, `QuarantineAction` is the operational
     quality/governance audit trail.
   - Gap acknowledged, not resolved here: dict-02's own `actionStatus`
     (P1X-0118) domain is under-specified in the dictionary (only `active`
     is listed; no released/completed counterpart), less complete than the
     current code's own `quarantineStatus` vocabulary
     (`QUARANTINED`/`RELEASED`/`PENDING_REVIEW`). #399 will need its own
     local extension of `actionStatus`'s domain to carry today's three
     states — flag it to Dennis/Denise as a dict-02 completeness gap if
     #399 hits it, rather than silently inventing values.

**Found while researching this decision, filed separately (#404, not part
of #398's own scope):** `intakeWizard.routes.js` and
`equipment-sensor-quarantine.service.js` already fail to keep
`lifecycleStatus` in sync with `quarantineStatus`/`availabilityStatus` on
write, so `sample.service.js`'s movement-blocking gate silently doesn't
fire for consent-revoked or cold-chain-quarantined samples today. That bug
is independent of this decision, but it's a concrete argument for #399
landing soon — a single `specimenStatus` write path eliminates this whole
class of drift. (Not yet fixed by #405 — that lands once every quarantine
write site funnels through `specimenStatus` in #406.)

**Landed in #405 (part 3a of #389 — `Sample.js`/`sample.service.js` core
status computation only):** `Sample.js`'s schema gained `specimenStatus`
(dict-02 ELM-0123's enum plus the local `disposed` extension);
`SampleModel.computeStatus()` now computes case-folded `specimenStatus`
values (same sticky-status algorithm shape, lowercase vocabulary,
`disposed` added to the sticky/blocked list); `SampleModel.create()` folds
`REGISTERED` into `available` and derives `lifecycleStatus`/
`availabilityStatus` from `specimenStatus` via the new
`SampleModel.deriveLegacyStatuses()` — a pure 1:1 derivation, not
independently maintained. `sample.service.js`'s `withdrawSample`/
`returnSample`/`updateSample` now compute and gate on `specimenStatus` as
the source of truth, using a single shared `BLOCKED_SPECIMEN_STATUSES`
constant (replacing the two duplicated `blockedLifecycleStatuses` arrays)
and writing the derived legacy fields alongside it on every write
(the dual-write bridge). `SampleModel.resolveSpecimenStatus()` falls back
to a legacy sample document's `lifecycleStatus` (case-folded) when
`specimenStatus` hasn't been written yet, so pre-#405 documents keep
working until their next write. **Not in this phase:** `QuarantineAction`
and the other ~10 quarantine write sites (part B/#406), frontend/e2e
(part C/#407), removing the legacy fields (part D/#408) — every current
reader of `lifecycleStatus`/`availabilityStatus` (routes, frontend, e2e)
keeps working unchanged.

**Landed in #408 (part D/#389 closeout — final phase, after #412-#415
migrated every remaining reader/writer onto `specimenStatus`):**
`lifecycleStatus`/`availabilityStatus`/`quarantineStatus` and
`SampleModel.deriveLegacyStatuses()`/`validateLifecycleStatus()` are
removed from `Sample.js`'s schema and every write site
(`sample.service.js`, `intakeWizard.js`/`.routes.js`, `eConsent.js`,
`equipment-sensor-quarantine.service.js`, `fhir-import-staging.service.js`'s
`samples` writes) — `specimenStatus` is now the sole persisted status
field. **Deliberate exception, not part of this removal:**
`quarantineReason` — the free-text quarantine reason has no
`specimenStatus` equivalent (dict-02's `QuarantineAction.reasonCodes` is
`CodeableConcept[]`, coded, not free text; confirmed against
`dict-02_DICIONARIO.md` and `requisitos-index.md` RF006 while picking up
#408 — no primary doc authorizes a `reasonCodes`/CodeableConcept redesign
to carry it instead), so it stays on `Sample.js`'s schema exactly as
#407/#415 already decided. `fhir-import-staging.service.js`'s
`import_staging_records` writes (a pre-commit workflow snapshot, a
different collection from `samples`) are unchanged, per #409's own
scoping. `eConsent.js`'s own `quarantineStatus`/`availabilityStatus`
response fields (`POST /import/fhir/consent/:token/accept`) read off
that same `import_staging_records` snapshot via
`acceptImportConsentToken`, not `Sample` directly — also out of #408's
scope, confirmed while picking up #451.

**#451 (status-field audit, closed as confirmed-resolved by the above):**
re-verified against current code that every `lifecycleStatus`/
`availabilityStatus`/`quarantineStatus` write site listed here really is
gone from the `samples` collection (no live write path sets
`lifecycleStatus` anymore — only import/FHIR readers map it as a legacy
*input* alias into `specimenStatus` via
`mapLegacyLifecycleStatusToSpecimenStatus`). `SampleModel.
resolveSpecimenStatus()`'s `lifecycleStatus` fallback (for documents
predating #405) was confirmed dead in production and removed — it now
defaults straight to `'available'` when `specimenStatus` is absent,
same as `SampleModel.create()`'s handling of an unrecognized/blank
legacy value.

### QuarantineAction

- `quarantineActionId`
- `specimenIds` (`Reference[]`, 1..* — one action may cover a batch, e.g.
  every specimen tied to one cold-chain sensor incident)
- `reasonCodes` (`CodeableConcept[]`)
- `startedAt`
- `releasedAt` (0..1, present only once released)
- `actionStatus`
- `authorizedBy` (Reference to Actor)

Per dict-02 P1X-0113–0119 ("Gestão da qualidade" domain), decided in #398
as the destination for `Sample.js`'s current
`quarantineStatus`/`quarantineReason` pair (storage/custody split, part of
#389); implementation tracked in #399. See the `Specimen` section above
for the full reasoning and the two acknowledged gaps (dict-02's
`actionStatus` domain is under-specified; RF006's `DISPOSED` state has no
`specimenStatus` equivalent and needs a local extension).

**Landed in #406 (entity + read path only — foundational slice, chunked
per `divide-and-conquer`):** the `quarantineActions` collection/entity
exists (`api/backend/src/models/QuarantineAction.js`,
`api/backend/src/services/quarantine-action.service.js`), mirroring the
`RcsAssessment`/`SpecimenPreanalytics` referenced-and-versioned pattern
(#383/#388) — `specimenIds` (1..*, batch-capable),
`reasonCodes`/`startedAt`/`releasedAt`/`authorizedBy` per dict-02, and
`actionStatus`'s documented local extension (`active`/`released`/
`pending_review`, carrying today's three-state vocabulary; dict-02's own
domain only lists `active`). `GET /api/samples/:id/quarantine-actions`
resolves the versioned history for a specimen, mirroring
`GET /:id/rcs-assessments`. **Not in this slice:** none of the ~25
existing quarantine write sites
(`equipment-sensor-quarantine.service.js`, `intakeWizard.js`/
`.routes.js`, `eConsent.js`, `fhir-import-staging.service.js`) write to
this entity yet — they still write the old
`quarantineStatus`/`quarantineReason`/`availabilityStatus` trio directly,
unchanged. That migration (and the #404 fix it enables) is carried by a
follow-up issue referencing #406.

**Landed in #408:** every quarantine write site above now records a
`QuarantineAction` via `quarantineActionService.recordAction`/
`releaseActiveAction` alongside setting `specimenStatus` directly
(no more `quarantineStatus`/`availabilityStatus` dual-write). The #404
drift bug this enabled a fix for is resolved as a side effect —
`specimenStatus` is the single write path now, so it cannot desync from
itself.

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

**Audited and confirmed clean (#500):** `rcs-certification.service.js`
does *not* belong on the still-outstanding-consumers list above.
`certify()` is a stateless calculator over an `sprec`/`matrixType`
payload — `rcsScore`, `calculationTrace`, and `axisPenalties` are its
own locally computed output, never a read off a `Sample` document. Its
only backend consumer, `quality-domain.service.js`, already has the
correct split: `resolveMethodologicalQuality`/`validateQualityForRelease`
compute fresh from an `sprec` payload (not a persisted-field read —
legitimate), and `validateQualityForReleaseFromSample` already resolves
through `RcsAssessment` (#383). The actual outstanding consumers remain
exactly the ones named above (MerkleService, neo4j projection, frontend
types, the live registration path) — #500 named the wrong file.

**Sample seal-time snapshot pin — landed #502:** `MerkleService`'s
resolved-snapshot integrity hash (#497) originally resolved the *newest*
`RcsAssessment`/`SpecimenPreanalytics` snapshot for a sample's
`specimenId`. That drifts if a later snapshot is ever recorded for the
same `specimenId` after the sample's `merkleRoot` was sealed (e.g. a
future re-assessment/correction/re-import flow) — verification would
resolve the newer snapshot and report tampering for a sample that was
only re-assessed. Fixed by pinning: `Sample.js` gained
`sealedRcsAssessmentId`/`sealedSpecimenPreanalyticsId` (implementation
detail, not a dict-02 entity — dict-02's own `MerkleRoot`
P1X-0162..0167 is a separate, not-yet-built stub entity), set by
`import.service.js`/`import-lgpd.service.js` to the `_id` of whichever
snapshot was just recorded (or left `null` when no snapshot exists at
seal time, e.g. `intakeWizard.js`, which doesn't record a snapshot at
all). `MerkleService.generateSampleHashFromSample` now resolves the
pinned snapshot by `_id` when the field is present on the sample
document, falling back to the pre-#502 "resolve newest" behavior only
for samples written before this pin existed (no
`sealedRcsAssessmentId`/`sealedSpecimenPreanalyticsId` own-property at
all).

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
JSON-import branch of `import.service.js`'s `importSamples` doesn't
record a profile either (only the CSV/XLSX branch does, the same gap
#383 left for RCS; tracked in #493).

**Landed in #503:** `import-lgpd.service.js`'s `importSamples` now also
calls `specimenPreanalyticsService.recordProfile` after inserting the
sample (best-effort — logs a warning and continues on failure), the
SPREC counterpart to #499's RCS fix for the same file. Before this, the
LGPD import path persisted `sample.sprec` embedded only, with no
canonical `SpecimenPreanalytics` snapshot recorded at all.

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
- `lifecycleStatus`
- `availabilityStatus`
- `quarantineStatus`
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
