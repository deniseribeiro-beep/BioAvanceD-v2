# Backend coverage history (archive)

Slice-by-slice narrative for the test-loop coverage push, split out of
`COVERAGE_NOTES.md` on 2026-07-04 because the combined file had grown
too large to read cheaply every session. **This file is for occasional
reference only** (e.g. tracing back why a file/bug was flagged) — the
per-session read is `COVERAGE_NOTES.md`, which holds only the current
ZERO/LOW buckets and reconcile numbers. Do not read this file as part
of normal slice-picking.

**Reconcile (2026-07-15, commit `94e2fc62`):** Full-suite regenerate of
`COVERAGE_NOTES.md`, owed since the 2026-07-14 reconcile's bucket lists
went stale without a fresh per-file re-derivation (per that reconcile's
own note). Lines 82.4% → 86.33%, statements 81.87% → 85.73%, branches
71.98% → 75.66%, functions 84.49% → 86.58% — consistent with #146-#164
and #203/#212/#227 landing since. Bucket counts shrank across the board
(ZERO 19→18, LOW 14→7, MID-LOW 20→3 listed/12 shown→3, MID-HIGH 44→39)
as #146-family fixes pushed files like `PatientIdentityService.js`,
`MoveSampleUseCase.js`, `sampleIDGenerator.js`, `fhir.service.js`,
`LineageRepository.js`, `analysisValidation.service.js`,
`import-lgpd.service.js`, `consent.validator.js`, `sample.service.js`,
and `import.service.js` into the GOOD (>=85%) bucket, no longer worth
individually tracking. No fixable bug surfaced by this reconcile — the
run's 5 failing test files (123/4739 tests) are entirely the already-open
design-fork backlog (#208/#218/#222/#224, re-traced and commented on
fresh the same day in the fix-bugs loop, see that session's handoff). The
`NotificationService.test.js` > `buildConsentLink` failure flagged at the
2026-07-14 reconcile as "not yet triaged" is gone in this run — resolved
incidentally by an intervening fix, no issue was needed.

**Slice (2026-07-21):** `src/controllers/analysis-type.controller.js`,
77.14% lines / 57.14% branches → 100% lines / 100% branches, new
`tests/unit/analysis-type.controller.test.js` (10 tests, no prior test
file existed). Covers both handlers' full branch sets: `getAnalysisTypes`
503-no-db / 200-success / 500-on-throw, and `createAnalysisType`
503-no-db / code-derived-from-name-via-slugify / explicit-code-lowercased
/ 400-validation-failure / 409-duplicate-code / 201-success /
400-on-insert-throw. No product bugs found.

**Slice (2026-07-21):** `src/services/hl7.service.js`, 73.45% lines /
47.15% branches → 100% lines / 81.81% branches, extended
`tests/unit/hl7.service.unit.test.js` (47 → 91 tests). Added coverage
for the three previously-untested async top-level generators —
`generateHL7v2Message`, `generateFHIRResource`, `generateCDA` — for
their success paths (segment/resource assembly, optional-field
branches like loincCode/accessionNumber/barcode/registeredAt/resultValue
presence-absence) and their `catch`-and-rethrow error paths (forced via
`vi.spyOn` on an internal helper to throw). No product bugs found; the
remaining ~18% branch gap is deep optional-field permutations in the CDA
XML template not worth chasing further for a bug-fixing return.

**Slice (2026-07-13):** `src/workers/neo4jProjection.worker.js`, 65.95% →
89.36% lines (69.23% branches), extended existing
`tests/unit/neo4jProjection.worker.test.js` (2 → 7 tests) across two
passes. First pass covered: the `markRetrying` branch in
`runProjectionOnce` (a failed event with attempts remaining below
`maxAttempts`, previously only the dead-letter branch was exercised);
the empty-batch early return shape; and `runProjectionWorker` — both
the `once: true` single-pass path and the `once: false` daemon loop's
backoff-on-empty-batch branch (forced to exit via a mocked
`leaseNextBatch` rejection on the third poll, since `stopAfterOne` is
captured once at call time and the loop has no other exit —
`setTimeout` mocked to fire synchronously so the test doesn't actually
sleep). Second pass covered the module-level `connectDB`/`connectNeo4j`
default-argument fallbacks (lines 10-11): `vi.mock()` doesn't reliably
intercept this file's CJS `require()` call sites (same gotcha as
`daily-merkle.job.test.js`), so the fix was to require the real
`src/database/mongo` and
`src/infrastructure/database/neo4j/connection` modules first, `vi.spyOn`
their exports, and only then require the worker — so its own
destructuring captures the already-patched functions.

**Product bug found (not fixed — filed as issue #177):** the
`require.main === module` bootstrap block (lines 81-91) calls
`runProjectionWorker()` with no arguments, so `options.once` is always
`undefined` and the loop's `stopAfterOne` is always `false`. Its
`do...while` loop can therefore only exit via a thrown error — the
`.then()` success branch (`'Worker finalizado'` + clean `process.exit(0)`)
is dead code under the current wiring; a real run of this script can
only ever end via `.catch()` (logged as a failure, `process.exit(1)`),
even on what should be a graceful shutdown. This is also why lines
82-89 are left uncovered here: exercising that block honestly would
mean spawning a child process against real Mongo/Neo4j infra (the
`.then()` branch can't be reached at all as currently written), which
is out of scope for native unit tests.

**Slice (2026-07-13):** `src/interface/routes/equipment.routes.js`, 65.66% →
100% lines/statements/functions (90.58% branches), extended existing
`tests/integration/equipment.api.test.js` (13 new tests total across two
passes) covering: 500s from `find().toArray()` rejecting on `GET /` and
`GET /analytical`; a 500 from `findOne` rejecting on `GET /:id`; the
numeric-`equipmentID` fallback lookup succeeding on `GET /:id`; the 400
(outer catch) path when `findOne` rejects mid-update on `PUT /:id` (falls
through the inner ObjectId/numeric-fallback catch into the outer route
catch); a 400 when `deleteOne` rejects on `DELETE /:id`;
`purchaseDate`-to-`Date` conversion on both `POST /` and `PUT /:id`; the
404 numeric-fallback-not-found path on both `PUT /:id` and
`DELETE /:id`; and a real Mongo-transaction path on `PUT /:id`
(`db.client.startSession`/`session.withTransaction`/`endSession`) driving
the quarantine-trigger branch that the existing unit test only exercised
against a router built in isolation. No product bugs found. Remaining
branch gap (90.58%) is the `req.user` falsy branches ahead of each audit
log call — unreachable in practice since `authenticate` always populates
`req.user` before the route body runs — and the `userName`/`userRole`
`||` fallback arm in the quarantine audit-info payload, not worth chasing
further. Note: measuring this file's coverage by running
`tests/integration/equipment.api.test.js` together with
`tests/unit/equipment.routes.quarantine.test.js` in one vitest invocation
undercounts badly (e.g. reported 81.92% lines when the true number is
100%) — the per-file v8 coverage merge across the two test files'
worker threads is unreliable in this repo's vitest config. Measure a
single route file's coverage from the integration spec alone (it already
imports the full `app`, so it exercises the same router); don't trust a
narrowed multi-file `--coverage.include` run as a source of truth without
cross-checking against the single-file number.

**Slice (2026-07-13):** `src/config/keyRegistry.js`, 68.96% → 100% lines
(93.75% branches), new `tests/unit/keyRegistry.test.js` (15 tests)
covering `getActiveKeyId`'s default and trimmed-env-var cases,
`getKeyEntries`'s empty/whitespace-only `ENCRYPTION_KEY` short-circuit
and single-active-entry derivation, `getActiveKey`'s null and derived-key
cases (including determinism), `getKeyById`'s falsy-keyId guard,
matching/trimmed/no-match/no-key-configured cases, and `getFallbackKeys`'
empty and single-unique-key cases. Reloads the module fresh per test via
`require.cache` deletion so env-var changes take effect (module-level
`process.env` reads happen at call time here, not import time, so this
wasn't strictly required, but keeps tests isolated regardless). No
product bugs found this slice.

**Slice (2026-07-13):** `src/services/rfc3161-adapter.service.js`, 64.00% →
100% lines (93.75% branches), extended `tests/unit/rfc3161-adapter.service.test.js`
(12 new tests, 15 total) covering `mode()`'s fallback to `disabled` on an
invalid value, `anchorEnvelopeDigest`'s `disabled` short-circuit,
`remote` mode's `missing_tsa_url` guard, HTTP non-ok response,
`invalid_tsa_response` (missing token/messageImprint), the success path
including the `authorization` header when `AUDIT_RFC3161_TSA_AUTH_TOKEN`
is set (via `vi.stubGlobal('fetch', ...)`), and `verifyTimestamp`'s
`disabled` short-circuit, `missing_timestamp`, `invalid_timestamp_material`,
mock-mode `invalid_mock_token` and `message_imprint_mismatch`, and
remote-mode `message_imprint_mismatch`/match. No product bugs found this
slice.

**Slice (2026-07-13):** `src/utils/fieldEncryption.js`, 57.14% → 100%
lines (86.95% branches), new `tests/unit/utils/fieldEncryption.test.js`
(13 tests) covering `encryptValue`'s no-active-key warning path,
empty-ish-value (`undefined`/`null`/`''`) short-circuit, successful
payload shape, and falsy-but-defined values (`0`/`false`); and
`decryptValue`'s non-object-payload guard, keyed round-trip, unknown-keyId
warning, tampered-ciphertext failure, fallback-key iteration (both a
matching and no-matching fallback key), and keyId-whitespace trimming.
Had to discover the CJS-mocking gotcha firsthand: `vi.mock` on
`keyRegistry`/`logger` silently no-op'd because `fieldEncryption.js`
loads them via plain `require()`, not ESM `import` — rewrote to
`createRequire(import.meta.url)` + `vi.spyOn` on the real singleton
modules per `testing-conventions/references/cjs-mocking.md`, which
already documented this exact pattern. No product bugs found this
slice.

**Slice (2026-07-13):** `src/services/neo4jOutbox.service.js`, 52.45% →
100% lines (85.91% branches), extended `tests/unit/neo4j-outbox.service.test.js`
(11 new tests) covering `ensureIndexes`, `getCollection`'s missing-db
error and custom-collectionName option, `leaseNextBatch`'s populated and
empty-batch paths, `markProjected`/`markRetrying` (Error instance and
fallback message)/`markDeadLetter`/`recoverProcessing`, and
`stableStringify`'s Date/array/nested-object handling via `hashPayload`.
Remaining gaps (not covered, low value): a couple of defensive branches
in the stale-processing update queries. No product bugs found this
slice.

**Slice (2026-07-13):** `src/routes/intakeWizard.js`, 50.19% → 92.82%
lines (77.66% branches), extended `tests/unit/intakeWizard.routes.test.js`
(9 new integration tests via supertest) and `tests/unit/intakeWizard.helpers.test.js`
(3 new tests for `ensureConsentEmailSent`'s validation-error branches).
Covered the canonical-alias/schema-validation 422 rejections, the
ACTIVE/REVOKED/PENDING consent-decision branches, the automatic-location
resolver's sensor-not-operational and equipment-blocked skip-and-continue
paths, the 422 "no qualifying location" and 409 "no available storage
box" error paths inside `resolveAutomaticLocation`, and the box-allocation
failure path that deletes the just-created sample and returns 409.
Remaining gaps (not covered, lower value): a few defensive branches in
`buildIdVariants`/`findFirstAvailablePosition` (Map-based `occupancyGrid`
variant). No product bugs found this slice.

Entries below predate the 2026-07-04 reconcile; percentages mentioned
inline were provisional at the time and have since been superseded by
that reconcile's real `coverage-summary.json` numbers (see
`COVERAGE_NOTES.md`). Numbered slice ordinals are non-contiguous /
non-sequential in places (multiple concurrent authoring passes) — trust
the issue numbers and file names, not the slice ordinal.

**Slice (2026-07-05):** `src/services/patient.service.js` `createPatient`/
`updatePatient` gap, 57.2% → 74.78% lines (57.79% branches), new file
`tests/unit/patient.service.createUpdate.gaps.unit.test.js` (18 tests).
Covered `createPatient`'s consentTemplateId invalid-ObjectId/not-found
branches, duplicate-patient rejection, fallback unitAcronym generation,
consent-notification enqueue success and swallowed-failure paths,
biomarker timeseries/observation artifact writes, and the
phone-duplicate-key (11000) → 409 conversion on insert; and
`updatePatient`'s email/phone validation errors, clinicalUnit snapshot
resolution/merge, height-to-heightCm conversion (meters vs. already-cm),
biomarkerXai set vs. unset branches, ObjectId-vs-patientID query
selection, and the same 11000 → 409 conversion on update. Found a real
bug: `updatePatient`'s deceased/representative merge block only carries
`representativeName`/`representativeCpf`/`representativePhone` forward
from the existing patient record, omitting `representativeEmail` — so
re-affirming/updating any deceased-patient field on an already-valid
representative incorrectly throws the "obrigatório" validation error.
Filed as issue #90; the corresponding test asserts the actual (buggy)
throw with a comment pointing at the issue, per test-loop policy of not
patching product code from this loop. Remaining gap in
`patient.service.js` is concentrated in `getPatient`/`listPatients`/
`searchPatients`'s FHIR-first branches and `validateConsentToken`/
`acceptConsentToken`/`resendConsentNotification` (untouched this slice).

**Slice (2026-07-05):** `src/controllers/sample-file.controller.js`
68.87% → 98.34% lines (69.66% branches), extended
`tests/unit/sample-file.controller.test.js` (33 → 58 tests). Added
coverage for the multer `diskStorage` `getDestination`/`getFilename`
callbacks and `fileFilter` (previously entirely untested — real
validation/sanitization logic, not boilerplate), `uploadMiddleware()`,
the `uploadFile` catch-block cleanup path and its audit-log branch,
`listFiles`'s audit-log and 500 branches, `downloadFile`'s
audit-log/download-error-callback/`headersSent`/500 branches, all of
`deleteFile`'s early-return and 500 branches plus the "unlink fails but
deletion continues" branch, and `exportHL7v2`'s 503/404/log/500
branches (previously only the 400-mismatch and happy paths were
covered). No bugs found. Remaining gap (lines 51, 124, 225, 662) is
defensive `error.message` fallback branches inside nested try/catch
blocks not worth forcing.

**Slice (2026-07-05):** `src/services/import-lgpd.service.js`
67.43% → 79.01% lines (68.25% branches), new file
`tests/unit/import-lgpd.service.importPatientsSmart.unit.test.js` (24
tests). Covered the "smart import" mapping-driven patient-import path,
previously entirely untested: `buildMappedPatientRow` (explicit
mapping wins over an already-canonical raw column name; accented/spaced
raw headers normalize via `canonicalHeaderMap`; blank raw values are
skipped; `responsavelNome`/`responsavelEmail` fall back into
`representativeName`/`representativeEmail`), `importPatientsSmart`
itself (mirrors `importPatients`' per-row validation chain — missing
name, invalid email/cpf, invalid/future birthDate, missing or
non-ObjectId `consentTemplateId` with a `groupFields` fallback, missing
consent template, deceased-patient representative requirements,
duplicate-patient rejection, non-fatal notification-enqueue failure,
and a row-level exception being caught and recorded rather than
aborting the whole import), and `cleanupFile` (deletes when the file
exists, no-ops when it doesn't, swallows an `unlinkSync` throw). Same
mocking approach as the existing `importPatients` test file (DB driven
for real against a fake `db.collection()`, no bug found this slice —
issues #65/#84 already cover this file's other known bugs).

**Slice continued (2026-07-05):** `src/services/import-lgpd.service.js`
79.01% -> 85.18% lines (74.11% branches). Extended
`import-lgpd.service.importPatients.unit.test.js` (recordNumber
normalization, clinicalUnit acronym generation, duplicate-message
pt-BR date formatting, row-level exception handling, blank-row skip,
ignored patientID column, empty-object-rows header check),
`import-lgpd.service.readers.test.js` (readExcel's all-"Instruções"
sheet fallback for both patients/samples, samples-sheet fallback,
rich-text/hyperlink cell values and Date-to-ISO serialization), and
`import-lgpd.service.test.js` (parseBirthDate's DD-MM-YYYY dash format,
native-Date fallback, 1900-2100 year bound; parsePatientRow's `height`-
in-meters fallback and >=3 heightCm-is-already-cm branch). Stopped here
rather than chasing full 100%: the remaining gap is mostly
`importSamples`' post-`SampleModel.validate` code (~845-982), which is
dead in production because `SampleModel.validate` resolves to
mongoose's own static (always rejects, see the BUG-tagged tests in
`import-lgpd.service.importSamples.unit.test.js`) rather than the
hand-written validator — reaching it honestly would mean mocking around
a known bug rather than driving it through realistic inputs.

**Slice (2026-07-05):** `src/controllers/import-batch.controller.js`
69.49% → 100% lines, 97.5% branches. The controller's route-handler
methods (`createBatchImport`, `getBatchImportStatus`,
`normalizeBatchStatus`) were already well covered by the existing
`tests/unit/import-batch.controller.test.js`; the gap was entirely the
module-level `multer.diskStorage({destination, filename})` and
`multer({fileFilter})` closures (lines 10-18, 25-48), which are never
invoked through the controller's public API. Since this file uses
`createRequire` for real Node CJS `require()` (not Vite's ESM graph),
`vi.doMock`/dynamic `import()` silently no-ops — added a helper that
swaps `require.cache[<multer path>].exports` for a thin wrapper around
the real `multer` function/`.diskStorage` before re-requiring the
controller fresh, captures the config object passed to each real call,
then restores the cache entry — this actually exercises the
closures (verified by their coverage lines disappearing), rather than
mocking multer's own internals. Covers: uploads-dir creation
(mkdir-if-missing vs. skip-if-exists), filename generation with
extension preserved, and all three `fileFilter` branches (blocked
extension, disallowed mimetype, accepted file). No bugs found.

**Slice (2026-07-05):** `src/routes/orphanet-count.js` 68.42% → 100%
lines/branches/functions/statements. Extended the existing
`tests/unit/routes/orphanet-count.test.js` (2 → 4 tests) to cover the
previously-untested fallback path (lines 17-22): when
`app.locals.db` is absent, the route creates its own `MongoClient`,
connects, queries, and closes the connection — done by
`vi.spyOn`-mocking the `mongodb` module's `MongoClient` export. Added
cases for the happy-path fallback query and for `connect()` rejecting
(covers the `client` truthy branch inside the catch, since `close()`
must still not be called when connect itself fails). No bugs found.

**Slice (2026-07-05):** `src/infrastructure/queue/TopologicalQuarantine.js`
68.08% → 100% lines/statements/functions, 93.67% branches. Added
`tests/unit/topologicalQuarantine.lifecycle.test.js` (15 tests)
covering gaps left by the existing `topologicalQuarantine.test.js` and
`topologicalQuarantine.observability.test.js`: `enqueue()` (invalid
payload short-circuit, successful enqueue with custom
reason/neo4jError/attempts, redis.rpush rejection); `startWorker`/
`stopWorker` (timer scheduling via fake timers, idempotent start when
already running, timer cleared on stop); `processQueue` guard clauses
(no-op when not running, no-op on reentrant `processing`, corrupted
JSON item skipped, unexpected redis error caught and `processing`
released); `reprocessItem` factory failures (missing
`getLineageRepository` option, factory resolving to null,
`requireEthicalConsent: false` propagated when explicitly set); and
`getObservabilityMetrics` when `redis.llen` is absent or throws (queue
depth reported as null). No bugs found.

**Slice (2026-07-05):** `src/models/ConsentTemplate.js` 67.85% → 100%
lines/branches/functions/statements. Added
`tests/unit/ConsentTemplate.model.unit.test.js` (18 tests) covering the
`validate()` branches not exercised by the existing
`tests/unit/consent.models.test.js` happy-path tests (title/content
missing, non-string, and whitespace-only; optional version/caae
present-but-invalid; active non-boolean; permissions non-array,
empty-array, null-entry, and `required` non-boolean; multi-field error
accumulation) and the `create()` field-mapping branches (all optional
fields populated and trimmed; `htmlContent`-from-`content` and
`content`-from-`htmlContent` fallback directions; defaults for
version/versionGroupId/previousTemplateId/caae/permissions when absent
or blank; non-array `permissions` falling back to `[]`). No bugs found
— the model's validation/creation logic matched its own contract in
every branch exercised. No product source touched.

**Slice (2026-07-05):** `src/models/Patient.js` 63.33% → 98.66% lines
(97.13% branches). Extended existing
`tests/unit/patient.model.unit.test.js` (added ~85 tests, 97 total):
full `validate()` branch coverage (consentTemplateId, deceased/
representative email rules, phone/cpf/representativeCpf digit checks,
weight/heightCm/lysoGb3/alphaGal numeric+sign checks, all boolean
comorbidity fields, icdReference shape checks, status enum,
consentToken, consentAcceptedAt, invalid-Date birthDate); full
`create()` coverage (DD/MM/YYYY vs ISO vs Date birthDate parsing,
email/phone normalization, height-in-meters vs centimeters conversion,
Fabry loose-field consolidation into `dadosEspecificos`, consent token
date fields, defaults); `validateUnit()` and `fillAcronym()` (stop-word
filtering, accent stripping, 6-char truncation) had zero prior coverage
and are now fully covered. Remaining gap (lines 30, 40) is defensive
`isValidEmail`/`normalizePhone` branches not reachable via `validate()`'s
existing guards. No bugs found — the model matched its own inline
Portuguese error-message contract in whatever branch was executed.

**Slice (2026-07-05):** `src/core/use-cases/ListOperationalFreezersUseCase.js`
66.66% → 100% lines/branches/functions/statements. New
`tests/unit/ListOperationalFreezersUseCase.test.js` (2 tests): happy path
delegating to `topologyReadRepository.listOperationalFreezers()`, and
error propagation when the repository rejects. Thin pass-through class,
no bugs found.

**Slice (2026-07-05):** `src/models/Sample.js` 67.79% → 98.3% lines,
93.65% branches (isolated run). New `tests/unit/sample.model.gaps.test.js`
(39 tests) filling gaps left by the pre-existing `sample.model.unit.test.js`
/ `sample.models.test.js` (which already covered the happy-path
validate/computeStatus/mapLifecycleToLegacy/create): `validate`'s
registrationDate/withdrawalDate Date-vs-string-vs-invalid branches,
currentStatus/status branches, barcode/quantity/quality omission
branches, storageLocation shape validation, sampleType/sampleOrigin/
extractionProtocol non-string guards; `create`'s quality_score/
rcs_score/final_grade/p_bio/grade_route/calculation_trace/
external_quality_assessment normalization, clinical_data and
pharmacology_data (incl. legacy aliases) normalization, storageLocation
defaulting, receivedTime/processingStatus, tcle_id/consentTemplateId
cross-fallback, penalty_log array coercion; and `getResults` success +
error-wrapping paths. Remaining 2 uncovered lines: a `new Date()`
default-arg branch and a duplicate (dead, shadowed) second definition
of `validateWithdrawalType` — not worth chasing further. No bugs found
in this file's logic.

**Slice (2026-07-05):** `src/utils/logSerializer.js` 69.14% → 97.87%
lines, 89.43% branches (isolated run). New
`tests/unit/utils/logSerializer.test.js` (36 tests) covering
`isObjectId` (constructor-name and duck-typed hex-string detection,
non-24-char strings, throwing `toString`), `serializeValue` (ObjectId/
Date/Buffer tagging, array/object recursion, `$`-prefixed and
`__proto__` key skipping, circular-reference detection, max-depth
guard, per-key error capture), and `serializeLogSimple`'s field-by-field
normalization (`_id`, `timestamp`, `dateTime`/`createdAt`/`updatedAt`,
`payload`/`metadata`, `entityID`, `userID`/`userId`). No bugs found —
plain utility functions, no mocking required. Remaining gap is a v8
coverage-tool quirk on the depth-guard's string return (line 21),
confirmed hit via a standalone Node repro; not a real test gap.

**Slice (2026-07-05):** `src/services/mqtt-telemetry.service.js` 67.08% →
75.94% lines, 79.61% branches (isolated run), extended
`tests/unit/mqtt-telemetry.service.test.js` (24 tests, up from 15). Added
coverage for `stop()` (client end + already-null-client no-op) and
attempted to cover `start()`'s real `mqtt.connect(...)` call and its
`connect`/`error`/`message` handler wiring, but the `mqtt` package's
`connect` export is a non-configurable getter with no setter — neither
`vi.spyOn(mqtt, 'connect')` nor direct reassignment can override it, and
injecting a fake module via `require.cache` crashed the Vitest worker
(V8 assertion in `CompileFunctionForCJSLoader`) rather than failing
cleanly. Left lines 64-101 (the `mqtt.connect` block and its handlers)
uncovered rather than force a fragile mock; a real fix would need the
source to accept an injectable MQTT client factory, which is out of
scope for a test-only slice. No bugs found this slice.

**Slice (2026-07-05):** `src/models/ConsentPolicy.js` 64.86% → 100%
lines/branches/functions/statements (isolated run), extending the
existing `tests/unit/consent.models.test.js` (which already had 3
`ConsentPolicyModel` cases) with 8 more (17 total in the file). Added
coverage for: empty-payload validation (all required-field errors at
once), blank/whitespace-only title/htmlContent/version, non-string
`caae`, invalid `validFrom`/`validTo` date strings, non-boolean
`active`, malformed `granularPermissions` entries (null item,
missing/wrong-typed `key`/`label`/`required`), and `create()` with an
explicit `caae`/`active: false` plus the `granularPermissions`-omitted
default-to-`[]` path. No bugs found this slice.

**Slice (2026-07-05):** `src/services/biomarker-observation.service.js`
63.88% → 98.61% lines, 93.33% branches (isolated run), new file
`tests/unit/biomarker-observation.service.test.js` (26 tests). Covered
`ensureIndexes` (no-op on missing args, creates all 5 indexes once and
memoizes per collection name, warns and continues on a rejected
`createIndex`), `getObservationsCollection` (resolves via `db.collection`,
falls back to the default name), `encryptObservationValue`/
`decryptObservationValue` (encrypt/decrypt round trip, untouched when no
value or no encrypted payload), `createObservation` (encrypts + inserts,
validation-error throw, duplicate-key (11000) returns the existing doc,
rethrows non-duplicate and no-match-found duplicate errors), and
`listPatientObservations` (patientID format validation, filter building
for biomarkerType/status/date-range including invalid-date omission,
limit/skip clamping and defaults, per-doc decryption). Hit the same
`vi.mock` identity issue as `patientAnonymization.js` above, but for
CJS `require()`'d utils (`fieldEncryption`, `collectionResolver`) rather
than a spied logger: mocking those two modules had no effect on what the
service's internal `require()` resolved to (confirmed by mocking with a
value that should throw/differ and watching the *real* implementation's
behavior run instead) — so this suite drives the real `fieldEncryption`
(actual AES-256-GCM round trip against the test `ENCRYPTION_KEY` from
`vitest.setup.js`) and a fake `db` without `listCollections` (so the real
`getCollection` resolves synchronously to the canonical name, no Mongo
needed). One line (the `decryptObservationValue` catch body) stays
uncovered — `decryptValue` swallows all its own errors internally and
never actually throws, so the catch is defensive/unreachable without
mocking. No bugs found.

**Slice (2026-07-05):** `src/utils/patientAnonymization.js` 62.5% → 100%
lines/statements/functions, 95% branches (isolated run), new file
`tests/unit/patientAnonymization.test.js` (17 tests). Covered
`generateUniquePatientID` (unique first try, `collectionName` override,
retry-on-collision loop, throws after exhausting `maxAttempts`),
`validatePatientID` (null/non-string/wrong-length/non-digit rejection,
found/not-found, and the try/catch error path), `getPatientByIDOnly`
(found returns only `{ patientID, exists: true }`, not-found returns
null, and the try/catch error path), and `sanitizePatientForLogs`
(falsy patient, strips non-`patientID` fields, missing `patientID`
field). No bugs found. Logger calls are spied via `vi.spyOn` on the
real logger module (matching `NotificationService.test.js`'s
convention) rather than `vi.mock`, since this repo's `vitest.config.js`
runs with `isolate: true` and a `vi.mock` factory's object didn't
stay identity-matched with the module the source captured across
tests. Remaining uncovered branch is the `env.COLL_PATIENTS ||`
module-load-time default fallback — not worth chasing (would need a
separate isolated module registry per test just for that one line).

**Slice (2026-07-05):** `src/services/mqtt-signature.service.js` 62.5% →
100% lines/branches/functions/statements (isolated run), new file
`tests/unit/mqtt-signature.service.test.js` (14 tests). Covered
`getSigningSecret` (set/unset/whitespace-only env var), `hashPayload`
(deterministic sha256, falsy-payload coercion to `''`), `computeHmac`
(null when no secret, deterministic hmac-sha256 hex when a secret is
set, falsy-payload coercion), and `verifyHmac` (no secret, no
signature, length-mismatch short-circuit, matching signature,
whitespace-tolerant signature, same-length-but-wrong signature via
`timingSafeEqual`). No bugs found. `MQTT_SIGNING_SECRET` env var is
saved/restored around each test.

**Slice (2026-07-05):** `src/services/import.service.js` 61.91% → 80.05%
lines (isolated run across all `import.service.*.test.js`, new file
`tests/unit/import.service.importPatients.test.js`, 11 tests). Covered
`importPatients` end to end, which previously had zero coverage: JSON
new-patient insert (with/without `patientID`, gating the consent-notify
branch), the notification-failure swallow, cpf-based merge into an
existing record, the `birthDate`-changed merge-conflict rejection, the
no-identifier skip path, model-validation rejection, a mixed-array batch,
the CSV row path, and the top-level file-read rejection. Two real bugs
found and filed, both asserted as actual (buggy) behavior with an
inline comment: issue #86 (`results.total` under-counts rows that fail
`PatientModel.validate`, same pattern as the already-known #79/#65
undercounts) and issue #87 (`parsePatientCSV` never maps
`email`/`consentTemplateId`/`cpf`/`recordNumber`, so every CSV-imported
patient row fails model validation — CSV patient import is effectively
dead code). Remaining gaps in this file are `importSamples` (JSON/CSV
branches, lines 384-434 etc.) and `importLocations`/`importTemperature`
edge cases already partially covered by other test files in this slice
family — next slice should target `importSamples`.

**Slice (2026-07-05):** `src/services/import.service.js` 80.05% → 88.86%
lines (isolated run across all `import.service.*.test.js`, new file
`tests/unit/import.service.importSamples.test.js`, 12 tests). Covered
`importSamples` end to end: JSON insert with complete ethics/sprec data
(release_status upgraded to AVAILABLE via the compliance validator),
JSON insert with missing ethics/sprec (stays QUARANTINE, no update
needed since it's already the default), the compliance-validator-throws
catch path (stays QUARANTINE, logs a warning) for both the JSON and
tabular branches, model-validation rejection, an insertOne rejection,
a JSON array batch, the CSV structural-validation short-circuit, a CSV
parse error (non-numeric quantity), a CSV model-validation rejection,
and the unsupported-extension/file-not-found top-level paths. One more
real bug found and filed as actual (buggy) behavior: issue #88 —
`importSamples`'s **JSON** branch has the same `results.total`
undercount pattern as #79/#65/#86 (continue before the bottom-of-loop
`total++`), but the CSV/XLSX branch of this same method does not have
the bug (it increments `total` explicitly before its own continues).
Remaining gaps in `import.service.js` are `importLocations`'s dynamic
`require('../utils/locationIDGenerator')` line and a few defensive/edge
branches (getRowValue with a null-alias-list caller, readSpreadsheetRows
edge cases) — lower value, not prioritized further this session.

**Slice (2026-07-05):** `src/i18n/index.js` 57.37% → 100% lines/
statements/functions, 86.15% branches (isolated run:
`tests/unit/i18n.test.js`, new file, 26 tests). Covered `setLanguage`,
`getDefaultLanguage`, `detectLanguage` (query/header/user/default
precedence), `translate` (direct hit, miss with fallback, cross-language
fallback to pt-BR including the real-key path via an unloaded `fr-FR`
lang), `languageMiddleware` (header/req.language/req.t wiring, the
try/catch swallow in `req.t`, and all three guard conditions gating the
`setImmediate` audit-log branch plus the scheduled-callback body itself,
including its own inner catch), and `loadTranslations`'s `fs.readFileSync`
failure path (mocked to throw, verifying the empty-object fallback and
`console.error`). No bugs found; no issues filed. Remaining branch gaps
are unreachable-in-practice combinations (e.g. Accept-Language variants
already covered by the precedence chain), not missing test cases.

**Slice (2026-07-05):** `src/models/Session.js` 57.14% (stale, see below)
→ 100% lines/branches/functions/statements (isolated run:
`tests/unit/models/Session.test.js`). The pre-existing test file already
had 19 thorough tests covering `create`/`validate`/`isSessionActive`, but
loaded the CJS source via plain ESM `import` instead of
`createRequire(import.meta.url)` — the exact known gotcha in
`testing-conventions/references/cjs-mocking.md` ("Mixing import and
createRequire... silently under-reports coverage"). Switching the loader
alone (no new tests) jumped isolated coverage from 80.95% to 100% lines;
one new test (`create()` defaults for missing userAgent/ipAddress/
deviceInfo) closed the one remaining branch gap (91.42% → 100%
branches). No bugs found; no issues filed. Confirms the cjs-mocking.md
gotcha generalizes beyond the sensor.service.js case it was first found
in — worth checking other MID-LOW files that look "already well-tested"
but show a stubbornly stale percentage for the same root cause before
assuming they need new tests at all.

**Slice (2026-07-05):** `src/services/patient.service.js` 56.35% → 57.2%
lines (isolated run: `patient.service.unit.test.js` +
`patient.service.module.test.js` + new
`patient.service.gaps.unit.test.js`, plus the other test files that
already exercise it indirectly — `paciente.controller.test.js`,
`controllers/consent.controller.test.js`,
`import-lgpd.service.importPatients.unit.test.js`,
`import-lgpd.service.unit.test.js`). New file covers the previously-bare
`resolveClinicalUnitSnapshot` (by-id and by-name lookups, fallback
normalization, invalid-id branches), `checkIdentifierConflict` (cpf,
recordNumber, and generic-identifier conflict branches),
`checkDuplicatePatient` (DD/MM/YYYY and Date-instance birthDate parsing,
no-match, and the catch-and-return-null-on-db-error path),
`syncPatientPhoneToGraph` (missing driver, missing `session()`, empty
patientID, success, and run()-rejects-but-still-closes-session paths),
and `applyDeceasedRepresentativeRules`'s full branch set (not-deceased
clears fields; missing-field, invalid-email, invalid-cpf-length, and
invalid-phone-length throws; full valid-payload normalization). The
percentage barely moved because the remaining gap is concentrated in
`createPatient`/`updatePatient`'s much larger bodies, not these helper
methods. **Bug found:** `resolveClinicalUnitSnapshot` invents a bogus
clinical unit named `"UNDEFINED"` instead of throwing
`clinicalUnitId inválido`, when `clinicalUnitId` is invalid and
`clinicalUnit` is omitted entirely (`undefined`, not `null`/`''`) — the
null/'' normalization check doesn't catch `undefined`, so
`String(undefined).trim()` becomes the literal string `"undefined"`,
which reads as truthy. Test asserts the actual buggy output with an
inline comment; filed as issue #85 (`gh issue create` was initially
blocked twice by the harness's auto-mode permission classifier this
session — treated as an unapproved external-system write despite the
repo's standing blanket OK for filing test-loop findings — then filed
successfully once Dennis gave explicit in-session authorization).

**Slice (2026-07-05):** `src/interface/routes/backup.routes.js` 57.69% →
98.07% lines (isolated run alongside `backup.service.test.js`). Extended
`tests/integration/backup.api.test.js` with: `GET /list` against a real
temp directory tree (exercises `getDirSizeSync`'s recursive size sum and
the newest-first `createdAt` sort) and its 500 path; `POST /perform`'s
500 path; and `POST /restore/:fileName`'s success, service-reported-failure
(400), path-traversal-basename-sanitization (404), and 500 paths. No bugs
found — the only remaining gap is the `fileName` falsy-guard branch,
which isn't reachable through Express's `:fileName` route matching (a
missing/empty segment doesn't match the route at all), so it's dead code
in practice; not worth a bug filing for a defensive guard that can never
fire from HTTP.

**Slice (2026-07-05):** `src/services/sensor.service.js` 62.02% → 100%
lines, 87.03% branches (isolated run combining `sensor.service.test.js`
and `sensor.service.quarantine.test.js`). Added catch-block/rethrow
coverage for `createSensor`/`getSensor`/`listSensors`/`updateSensor`/
`collectReading`/`deleteSensor`, plus the one previously-missing
`updateSensor` branch: quarantine triggered but no session support
(`db.client.startSession` unavailable), which must call
`quarantineBySensorStatus` without a `session` in its options. No product
bugs found. Along the way, found and fixed a **test-infra measurement
bug** (not product code): `sensor.service.quarantine.test.js` imported
the singleton via ESM `import`, while `sensor.service.test.js` used
`createRequire`+`require` for the same file — v8/vitest coverage does
not merge these two loader paths for the same source file, so running
both together silently under-reported coverage (was showing 64.55%,
masking real per-file coverage of 92.4% alone / 100% combined). Switched
the quarantine test to `createRequire` to match, which fixed the
merge. Worth checking other split test files for the same
`import` vs `createRequire` mismatch if their combined coverage looks
suspiciously low relative to per-file isolated runs.

**Slice (2026-07-05):** `src/services/fhir-sync.service.js` 67.29% →
99.52% lines (isolated run). The existing test file already covered the
pure mapping helpers and the "-First" single-doc read paths
(`getPatientFhirFirst`, `upsertXFromLegacy`, `syncAllLegacyData`); the gap
was the remaining FHIR-first list/search read paths (lines 181-334):
`listPatientsFhirFirst`, `searchPatientsFhirFirst`, `getSampleFhirFirst`,
`getSampleByBarcodeFhirFirst` (all three fallback query tiers: exact,
uppercase-variant, case-insensitive regex), `listSamplesFhirFirst`, and
`getPatientConsentFhirFirst`. Added 24 tests covering canReadCollection
gating, default/overridden limit-skip, filter-to-query construction, and
error-swallowing on each. No bugs found.

**Slice (2026-07-05):** `src/services/import-lgpd.service.js` 56.01% →
67.28% lines (isolated run across its six test files). Added
`tests/unit/import-lgpd.service.importSamples.unit.test.js`, covering
`importSamples` (previously exercised only via a fully-mocked
`importLGPDService.importSamples` spy at the controller level, so the
real method body had never run under test) and `getNextAvailableLocation`
(start-location-not-found, N-steps-forward sorted by block/rack/drawer/box,
offset-past-end, and the catch-and-return-null-on-query-failure path).

Found a severe real bug while writing the happy-path test: `importSamples`
calls `SampleModel.validate(sampleData)`, but `SampleModel` there is
`require('../models/Sample')`, which exports the **mongoose Model**
(the hand-written validator class is attached separately as
`SampleModel.SampleModel`). Mongoose's own static `Model.validate()`
returns a Promise, not `{isValid, errors}`, so `!validation.isValid` is
always `true` — **every row is rejected regardless of actual validity**,
`insertOne` is never reached, and the pushed error entry has
`errors: undefined` (a Promise has no `.errors`), which will itself
crash any caller iterating that array. As a corollary the duplicate-barcode
check (which sits after the `SampleModel.validate` call) is now dead
code. GitHub issue filing for this was auto-blocked by the permission
classifier this session (see wrap-up) — flagged to Dennis directly
instead of a filed issue number. The new tests assert the actual (buggy)
"every row always rejected, errors array undefined" behavior, with inline
comments pointing at this bug.

Remaining gaps in this file after the slice: `importPatientsSmart` (only
the mapping-required guard is tested; the full happy/error path mirrors
`importPatients`' shape but isn't covered), and `readExcel`'s
sheet-fallback edge cases beyond what `import-lgpd.service.readers.test.js`
already covers.

**Slice (2026-07-05):** `src/routes/dictionary.js` 56.16% → 96.57% lines
(isolated run across its three test files). Added
`tests/unit/dictionary-search-suggest.test.js` covering the two routes
that had no coverage yet: `GET /search` (Neo4j ORPHA lookup with redis
cache hit/miss/connect-failure paths, normalization filtering out
records with no code or display) and `GET /suggest` (Neo4j disease +
phenotype + biomarker lookup, 404 when not found, cache hit/miss,
500 on session throw). `dictionary.js` destructures `getNeo4jDriver`
from `../database/neo4j` at require-time, so the route file is loaded
via `require.cache` clearing + a fake `getNeo4jDriver` swapped onto the
dependency module (same pattern as `hpo.routes.test.js`); `redis` is
referenced as `redis.createClient(...)` (not destructured), so a plain
`vi.spyOn` on the shared module object was enough there. No new bugs
found in this slice; remaining uncovered lines are the redis
`on('error')` handler body, the `ensureMedicationDictionarySeeded`
bulk-write body (covered indirectly, not through the "actually seeds"
branch), and one `/atc/search` catch line — all thin enough not to
chase further this slice.

**Slice (2026-07-05):** `src/controllers/paciente.controller.js` 57.3% →
94.38% lines (isolated run). Added
`tests/unit/paciente.controller.test.js` covering all 11 methods:
`sanitizePatientPayload`/`validateDeceasedRepresentative` helpers,
`cadastrar` (503/400/create/audit-log/error-status mapping),
`listar`/`buscar` (operational vs. cadastro role LGPD field-stripping),
`resendConsentNotification`/`atualizar` (sample-revalidation call,
verified via require.cache-clearing since `revalidateSamplesByPatientID`
is destructured at module scope in the controller — see
`testing-conventions`' CJS mocking reference), `deletar`, `validateID`,
`findForEdit`, `search`, and `listBiomarkerObservations`/
`createBiomarkerObservation`. Filed issue #83:
`search()`'s catch block references `db` from the try block's scope,
which is out of scope in catch — throws `ReferenceError` instead of a
clean 500 response when `req.user` is set and the service call fails;
test asserts the actual (buggy) throw, not the intended behavior.

**Slice (2026-07-04, post-reconcile):** `src/models/StorageContainer.js`
32.69% → 100% lines. Added `tests/unit/StorageContainer.model.test.js`
covering the `pre('save')` hierarchy-validation hook (FREEZER/parent_id
rejection, SHELF/RACK requiring parent_id, temperature restricted to
FREEZER, missing/wrong-typed parent lookups for both RACK→SHELF and
SHELF→FREEZER) plus the `getFullPath` and `getChildren` instance
methods. The hook is defined inline in the schema and isn't exported,
so the test locates it among mongoose's internal `save` hooks
(validateBeforeSave, subdocs, sharding, ...) by matching its source text
and invokes it directly against a plain (unconnected) document — calling
`.save()` would need a live DB connection this unit test doesn't have.
No bugs found; existing `tests/unit/storage.models.test.js` (statics
`.validate()` coverage) left untouched.

**Slice (2026-07-04):** `src/interface/routes/sample.routes.js` 33.33%
→ 45.15% lines. Added `tests/unit/sample.routes.test.js` covering
`POST /` payload validation (`validateCreateSamplePayload`'s aggregated
422 errors, patientID/registerDate-vs-registrationDate branches) and its
success/error-mapping branches (201, 202 partial-success/quarantine
fallback, 403 STRICT_MODE_BLOCKED, 409, 404 "não encontrado", 500), plus
`GET /:id/label` (404 + XML-escaped SVG output), `GET /search/by-term`
(400 short-term guard, WITHDRAWN exclusion), `GET /by-barcode/:barcode`
(404 with audit-log warning, 200), and `GET /:id/movements` (503/200/500).
`authenticate`/`requirePermission`/`enforceCommercialConsent` and the
`RegisterSampleUseCase`/`LineageRepository` classes are all captured by
reference at require-time in this route file, and `vi.mock()` did not
reliably intercept this file's CJS `require()` graph (all requests came
back 401 as if unmocked, confirmed by a scratch debug test) — worked
around with the same require-cache-clear-and-replace technique as
`hpo.routes.test.js` (see that file's comment) generalized to multiple
dependencies, including injecting fake `require.cache` entries whose
`exports` is a real `function`/`class` (a first mock using a `vi.fn()`
arrow-function implementation failed `new` construction with
"is not a constructor" — Vitest mocks need `function`/`class` syntax to
be invocable via `new`, plain arrow functions can't be). No bugs found.
Remaining gaps in this file: `GET /:id/miabis-compliance`,
`GET /:id/compliance-graph`, `GET /`, `GET /:id`, `POST /:id/withdraw`,
`PUT /:id`, `DELETE /:id`, `POST /:id/return`,
`GET /by-barcode/:barcode/symbology-assets`, `GET /:id/results`, and the
`files/*` sub-routes (already thin pass-throughs to
`sample-file.controller`, mocked out here) — good candidates for a
follow-up slice.

**Slice (2026-07-04):** `src/models/StorageBox.js` 41.74% → 98.05%
lines. Added `tests/unit/StorageBox.model.test.js` covering the inline
`pre('save')` hook (dimension.rows/cols required + range checks, rack
parent-existence and containerType checks, currentOccupancy
resynchronization from occupancyGrid, ACTIVE↔FULL status transitions,
updatedAt/lastModified touch — same "locate the hook by source-text
match, invoke directly against a plain unconnected document" pattern as
`StorageContainer.model.test.js`), the `addSample`/`removeSample`/
`getAvailablePositions`/`getStats` instance methods (existing
`storage.models.test.js` only covered `getAllValidPositions`,
`isValidPosition`, `checkPositionOccupancy`, `toJSON`), and the
`validate` static. One gotcha: `occupancyGrid` is a
`Map<string, ObjectId>` — seeding test fixtures with plain strings as
values (e.g. `'sample-1'`) silently fails Mongoose's cast (not a valid
ObjectId hex string) and the value comes back `undefined`, which made
`addSample`/`removeSample`'s occupied-position checks pass when they
should have blocked — always use `new mongoose.Types.ObjectId()` for
occupancyGrid values in this schema, not string placeholders. No bugs
found. Two uncovered lines remain (schema-level trivial branches) but
not worth chasing given `>=98%` is deep in diminishing-returns
territory.

**Slice (2026-07-04):** `src/services/import-lgpd.service.js` 43.05% →
55.55% lines. Added `tests/unit/import-lgpd.service.readers.test.js`
covering `readCSV` (missing file, comma/semicolon delimiter
auto-detection from the header line, blank-row filtering, header-only
file rejection) and `readExcel` (missing file, no-worksheets, "Pacientes"
sheet-name preference for patients / "Amostras" for samples, fallback to
the first non-"Instruções" sheet, header-row auto-location by matching
`patientname`/`patientid`/`sampletype` tokens, `(*)`-suffix header
cleanup, empty-row skipping, no-header/no-data rejections) — both
against real temp CSV/xlsx fixtures written with Node's `fs` and the
real `exceljs` package (via `os.tmpdir()`, cleaned up in `afterEach`),
not mocks, since both methods are pure file-parsing with no DB
dependency. No bugs found. Remaining gaps in this file:
`importSamples` (694-1007, DB-backed) and `importPatientsSmart`'s
mapped-row/DB paths (1458-1596) — both need a mocked `db`/collection
harness like `import-lgpd.service.importPatients.unit.test.js` used for
`importPatients`, good candidate for a follow-up slice.

**Slice (2026-07-04):** `src/services/import.service.js` 44.04% →
61.91% lines. Added
`tests/unit/import.service.importLocationsTemperature.test.js` covering
`importLocations` (JSON single-object and array payloads, CSV rows,
parse-error/model-validation-error/duplicate-locationID branches,
locationID auto-generation via `generateUniqueLocationID`, and the CSV
structural-validation short-circuit) and `importTemperature` (success,
model-validation failure, invalid `temperatureUnit`, multi-row
success+failure counting) — all against a hand-rolled fake `db`/
collection (`findOne`/`insertOne`) and real temp CSV/JSON fixture files,
no mocking framework needed since `import.service.js`'s
`module.exports = new ImportService()` singleton is consumed directly
(no destructuring-at-require gotcha here). **Found a real bug while
writing the counting test, did not fix it inline:**
`importTemperature`'s per-row loop does `continue` immediately after
logging a validation failure, which skips the `results.total++` at the
bottom of the loop body — so `total` under-counts any row that fails
`TemperatureModel.validate()` (same shape as the already-known
`import-lgpd.service.js` bug in issue #65). Filed as issue #79 instead
of fixing inline, per explicit instruction that test-loop iterations
should raise issues, not patch product code, when the bug isn't
required to make the slice's own test pass — the two affected tests
assert the current (buggy) `total` value with a comment pointing at
#79 rather than the corrected value, so they won't spuriously fail
once someone fixes it. Remaining gaps in this file: `importPatients`
(208-375) and `importSamples` (376-530), both DB-backed and similar in
shape to `import-lgpd.service.js`'s already-tested `importPatients`.

**Slice (2026-07-04, post-reconcile):** `reports.routes.js` 30.2% →
71.84% lines. Extended `tests/integration/reports.api.test.js` with a
generic collection-backed mock db (`buildCollectionDb`) to exercise
`buildPreviewData`'s report-type branches: samplesbypatient grouping,
`buildSampleQuery` filter combinations (drug/treatment/sprec/release
status via `$and`), temperature statistics + critical-alerts filter,
withdrawal-history date range, extracellular-network regex match,
sensor/equipment/resultado generic collections, unknown-type default
message, and a real-data CSV export row. Found and filed a real bug:
issue #78 — the `isSampleAnalysis` branch is unreachable because the
generic `amostra`/`sample` substring check (line 353) always matches
first for any type string containing "sample"/"amostra", so the
sample-analysis grouping logic never runs; a test documents this actual
(broken) behavior rather than the intended one.

Since baseline: `MongoStorageTopologyReadRepository.js`, `database/mongo.js`,
and `sample-file.controller.js` moved off the LOW bucket by a
parallel-test-agents slice (63 new targeted tests, all green) — exact new
percentages not yet re-measured, will land at the next full reconcile.

Since baseline (2nd slice): `SampleFile.js`, `ImportMetrics.js`, and
`import.controller.js` moved off the LOW bucket by a parallel-test-agents
slice (90 new targeted tests, all green) — exact new percentages not yet
re-measured, will land at the next full reconcile. This slice also
surfaced two real product bugs, filed as issues #25 and #26 (see below).

Since baseline (3rd slice): `IntelligentAssistant.js`, `import-async.service.js`,
and `import-async.controller.js` moved off the LOW bucket by a
parallel-test-agents slice (107 new targeted tests, all green) — exact new
percentages not yet re-measured, will land at the next full reconcile. This
slice surfaced a real crash-risk bug, filed as issue #27 (see below).

Since baseline (4th slice): `assistant.service.js`, `MongoPatientConsentReadRepository.js`,
and `terminologySync.service.js` moved off the LOW bucket by a
parallel-test-agents slice (58 new targeted tests, all green) — exact new
percentages not yet re-measured, will land at the next full reconcile. This
slice surfaced a consent-bypass compliance risk (#28) and two terminology-sync
bugs (#29, #30) — see below.

Since baseline (5th slice): `consentNeo4jSync.service.js`, `analysisValidation.service.js`,
and `config/redis.js` moved off the LOW bucket by a parallel-test-agents slice
(67 new targeted tests, all green) — exact new percentages not yet re-measured,
will land at the next full reconcile. This slice surfaced a minor real bug
(#31 — REDIS_URL-embedded username always ignored) — see below.

Since baseline (6th slice): `LineageRepository.js`, `neo4j/connection.js`, and
`import-lgpd.service.js` moved off the ZERO/LOW buckets by a parallel-test-agents
slice (87 new targeted tests, all green) — exact new percentages not yet
re-measured, will land at the next full reconcile. This slice surfaced one
confirmed bug (#35 — missing eventType validation in recordCustodyEvent) and two
lower-confidence findings (#36, #37 — sanitizeRowForError over-stripping,
lenient birth-date parsing) — see below.

Since baseline (7th slice): `sample.service.js` and
`infrastructure/database/influxdb/connection.js` moved off the LOW bucket, and
`security.routes.js` got integration coverage extended (pre-existing test file),
by a parallel-test-agents slice (77 new targeted tests, all green) — exact new
percentages not yet re-measured, will land at the next full reconcile. This
slice surfaced two confirmed bugs (#38 — SampleModel export shadowing breaks
sample creation/withdrawal/return validation in production, #39 — returnSample's
PT-BR condition literals never match the real English RETURN_CONDITIONS values),
one lower-confidence route inconsistency (#40 — /consent-queue missing the db
availability check its siblings have), and one test-tooling finding affecting
other files too (#41 — `await import()` on CJS sources defeats `vi.spyOn` the
same way `vi.mock()` does) — see below.

Since baseline (8th slice): `infrastructure/database/mongodb/connection.js`,
`controllers/upload.controller.js`, and `services/staging-import.service.js` moved off
the LOW bucket by a parallel-test-agents slice (38 new targeted tests, all green) —
exact new percentages not yet re-measured, will land at the next full reconcile. This
slice surfaced two confirmed bugs (#42 — upload.controller.js's consent-pending branch
never actually returns 409/CONSENT_PENDING correctly since `patientStatus` is never the
literal string `'PENDING_CONSENT'`, always falls through to 400; #43 —
staging-import.service.js writes failure records to a schema field key (`errors`) that
doesn't exist on the `StagingImport` model, which only declares `importErrors`, so
Mongoose's strict mode silently drops them) — see below.

Since baseline (9th slice): `sensor.service.js` (non-quarantine paths),
`saveTelemetryPoint.js`, and `biomarker-xai.service.js` moved off the LOW
bucket by a parallel-test-agents slice (63 new targeted tests, all green) —
exact new percentages not yet re-measured, will land at the next full
reconcile. This slice surfaced two findings for domain/design review (#44 —
sensor.service.js's `updateSensor` mutates the caller's `updateData` object
plus its `quarantineService` singleton state has no reset guard;
#45 — biomarker-xai.service.js's alphaGal rule table has no elevated-value
zone, unlike lysoGb3's full three-zone scheme) — see below.

Since baseline (16th slice): `result-worker.js` moved off the LOW bucket
(24.21%) with 7 new targeted tests covering CSV/RAW/ZIP processing paths,
all green — no bugs found, product behavior matched expectations across
every path tested.

Since baseline (17th slice, parallel-test-agents): `storage-query.controller.js`,
`result.routes.js`, and `fhir-sync.service.js` moved off the LOW bucket by a
3-agent parallel-test-agents slice (25 + 38 + 45 = 108 new targeted tests, all
green, independently re-verified) — exact new percentages not yet re-measured,
will land at the next full reconcile. This slice surfaced three findings: #50
(storage-query.controller.js's getAvailablePositions catch assumes
error.message is always a string, crash risk on non-Error rejection), #51
(result.routes.js: enforceCommercialConsent runs before multer parses the
multipart body on POST /api/results/upload, so every upload is unconditionally
rejected with 403 in production — confirmed production-breaking), and #52
(fhir-sync.service.js: mapSampleStatusToFhir's substring `includes('available')`
check swallows any status containing the literal word "unavailable", so it's
mapped to 'available' instead) — see below.

Since baseline (18th slice, parallel-test-agents): `NotificationService.js`,
`fhir-validator.service.js`, and `move-sample.controller.js` moved off the LOW
bucket by a 3-agent parallel-test-agents slice (72 + 26 + 9 = 107 new targeted
tests, all green, independently re-verified together) — exact new percentages
not yet re-measured, will land at the next full reconcile.
`sendCriticalTempAlertFromInflux` in NotificationService.js was left
untested (its InfluxDB dependencies are destructured at module scope, making
them unspyable per this file's own `vi.spyOn` gotcha, and exercising it for
real would hit a live InfluxDB connection) — noted as a known gap rather than
forced. This slice surfaced one finding: #53 (fhir-validator.service.js's
`friendlyMessageFromError` gates its localized messages on `instancePath`
substring checks, but AJV's `required`-keyword errors always report an empty
`instancePath`, so every "missing required field" case across every resource
type falls through to the raw AJV message instead of the intended friendly
Portuguese diagnostic — confirmed, not just theoretical) — see below. Also
filed #54 (move-sample.controller.js: no 500 path, fragile substring-based
error-status routing).

Since baseline (19th slice, parallel-test-agents): `Result.js` and
`hpo.js` moved off the LOW bucket, and `dictionary.js` had its previously
uncovered `/medications/search` and `/disease-profile` routes covered
(its `/atc/search` route already had coverage from a prior slice) — a
3-agent parallel-test-agents slice (17 + 10 + 20 = 47 new targeted tests,
all green, independently re-verified together) — exact new percentages
not yet re-measured, will land at the next full reconcile. This slice
surfaced four findings, all filed: #55 (Result.js `create()` uses `||`
instead of `??` for `fileSize` etc., coercing a legitimate `0` to `null`),
#56 (hpoService.searchHpoLocal builds a RegExp directly from unescaped
user input — SyntaxError/low-severity ReDoS risk), #57 (hpo.js opens a
fresh raw MongoClient per request on `GET /:id`/local search, plus an
inconsistent result-count log on the fallback path), #58
(dictionary.js's `/medications/search` re-runs index-creation/seeding
on every request; minor normalizer gaps in disease-profile/ATC-level
fallback).

Since baseline (10th slice): `import-worker.js` moved off the ZERO bucket by a
test-writer slice (19 new targeted tests, all green) — exact new percentage
not yet re-measured, will land at the next full reconcile. This slice
surfaced one confirmed bug (#46 — the batch-import branch runs before the
processor's surrounding try/catch, so its dedicated failure-handling catch
block that marks batch progress as `'failed'` is dead code; a rejected
batch-import job just propagates the error with no progress update) — see
below.

Since baseline (11th slice): `ExtractionProtocol.js`, `QualityDescription.js`,
`SampleOrigin.js`, and `SampleType.js` moved off the LOW bucket by a
parallel-test-agents slice (32 new targeted tests, all green — these four
models are byte-for-byte identical in shape, so one `describe.each`-driven test
file covered all four with no bugs found). In the same iteration,
`reports.routes.js` got 10 new integration tests added to its existing test
file (13 total now green), covering the `:id`/`:type` route family
(get-by-id/delete dual reportID-then-ObjectId resolution, preview/export/
export-pdf, a 503-without-db case) — but only exercises the trivial
`audit`/logs branch of `buildPreviewData`'s ~10-branch type dispatch, so it's
left in the LOW bucket rather than moved off; the other branches (notably
`samplesByPatient`'s cross-collection `distinct`/grouping logic) are a good
candidate for a follow-up slice. Exact new percentages not yet re-measured,
will land at the next full reconcile. No bugs surfaced this slice.

Since baseline (12th slice): `importFhirIntelligent.js` moved off the LOW
bucket by a test-writer slice (9 new integration tests, all green) covering
the Bundle-validation 400 path, the full Patient/Specimen/Observation happy
path with exact filter/update assertions, non-strict-mode semantic-contract
warnings (missing ORPHA coding, invalid HPO coding), strict-mode 422
rejection with no model writes, skip-on-no-resource and
skip-on-unrecognized-resourceType, and a 500 error path confirming the
`finally`-block Neo4j session close still runs. In the same iteration, the
six tiny `src/core/use-cases/*UseCase.js` files (`CheckStorageBoxIntegrityUseCase`,
`GetFreezerOccupancyStatsUseCase`, `GetFreezerTreeUseCase`,
`GetSampleStorageLocationUseCase`, `SearchAllocatableSamplesUseCase`,
`ValidateStoragePositionUseCase`) moved off the LOW bucket by a second,
independent test-writer slice (19 new targeted tests, all green — each is a
thin constructor-injected delegate to a repository method, following the
existing `GetBoxAvailablePositionsUseCase.test.js` pattern). Exact new
percentages not yet re-measured, will land at the next full reconcile. No
bugs surfaced this slice; one minor response-shape inconsistency noted and
filed as issue #47 — `importFhirIntelligent.js`'s strict-mode 422 body
returns `semanticContract: { strictMode, violations }` while non-strict 200
returns `semanticContract: { strictMode, warnings }`, a differently-keyed
shape for the same concept depending on status code.

Since baseline (13th slice): `compliance.routes.js` moved off the LOW bucket
(28 new integration tests, all green) in
`api/backend/tests/integration/compliance.api.test.js`, covering all 8
routes (`/dashboard`, `/report` including CSV export, `/alerts` list +
acknowledge + resolve, `/scopes` including category/highRiskOnly filters,
`/verify-biomarker/:id`) — happy paths, missing-db 503s, validation 400s,
service-error 500s including custom-statusCode propagation, and an invalid
ObjectId falling through to the generic 500 path. Exact new percentage not
yet re-measured, will land at the next full reconcile. No bugs surfaced
this slice.

Since baseline (14th slice): `cid.controller.js` moved off the LOW bucket —
4 new integration tests added to
`api/backend/tests/integration/cid.api.test.js` (the `GET /api/cids/search`
route's short-query no-op, default page/limit delegation, and service-error
500) plus a new `api/backend/tests/unit/cid.controller.test.js` (5 tests)
calling the controller function directly to cover the `req.app.locals.db`
falsy 503 branch, which is dead code when reached through the real
`/api/cids/search` route — `authenticate` middleware already checks
`req.app.locals.db` first and 503s with a different message
(`"Banco de dados não disponível para validar sessão"`) before the
controller ever runs, since both checks read the same `app.locals.db`
reference. Filed as issue #48 (labels: documentation, test-branch) per
the wrap-up "found a problem → file it" rule, and noted here since it
also explains why that branch needed a direct unit test instead of an
integration test. Exact new
percentage not yet re-measured, will land at the next full reconcile. No
bugs surfaced this slice.

Since baseline (15th slice): `temperature.controller.js` moved off the
LOW bucket — 21 new unit tests added in a new
`api/backend/tests/unit/temperature.controller.test.js`, covering all six
handlers (`createReading`, `getHistory`, `getAlerts`, `getAll`, `getById`,
`getControl`) via direct calls with a mocked `temperatureService`: each
handler's `req.app.locals.db` falsy 503 branch, its success delegation
(including param defaulting/mapping), and its own error-handling branch.
Found a real routing bug while reading `temperature.routes.js`: `GET
/control` is registered *after* `GET /:id`, so Express matches `/:id`
first (`req.params.id === 'control'`) and `getControl` is unreachable via
the real running app — filed as issue #49 (labels: documentation,
test-branch). This is why `getControl` needed direct unit tests rather
than an integration test through the real route (same shape as the
`cid.controller.js` finding in the prior slice, different root cause).
Exact new percentage not yet re-measured, will land at the next full
reconcile.

Since baseline (16th slice): `src/workers/workers/result-worker.js` moved
off the LOW bucket — 7 new unit tests added in a new
`api/backend/tests/unit/result-worker.test.js`, covering paths the
pre-existing `workers.unit.test.js` (missing-file + unsupported-extension
guards only) left untouched: the CSV row pipeline
(`processResultRow` success path with a mocked `fhirService.resultToFHIR`,
the missing-identifier validation error, and the sample-not-found error),
the RAW path (`processRawFile`'s not-yet-implemented stub), the ZIP path
(`processZip` extracting and dispatching a real CSV entry via a fixture
built with `archiver`, plus an unsupported-entry-type error through
`processGenericFile`), and the top-level try/catch that logs and rethrows
when `db.collection()` itself throws. No product bug found this slice.
Note: `archiver` is used only as a transitive dependency (present in
`package-lock.json` via other packages, not a direct `devDependency`) to
build the zip fixture — flagging in case a future `npm` lockfile change
drops it as unavailable, in which case swap to a hand-built minimal zip.
Exact new percentage not yet re-measured, will land at the next full
reconcile.

Since baseline (20th slice, parallel-test-agents): `incident.controller.js`,
`semantic-pointer.js`, and `allocate-sample.controller.js` +
`release-sample.controller.js` moved off the LOW bucket — a 3-agent
parallel-test-agents slice (25 + 17 + 19 = 61 new targeted tests, all
green, independently re-verified together) — exact new percentages not
yet re-measured, will land at the next full reconcile. This slice
surfaced two findings, both filed: #59 (`release-sample.controller.js`
has no 409/`STORAGE_COLLISION` branch, unlike
`allocate-sample.controller.js` — a real status-code asymmetry) and #60
(`semantic-pointer.js`'s `buildNeo4jSemanticPointer` uses a truthiness
check, so a legitimate numeric `mongoId` of `0` is incorrectly rejected
while the string `'0'` passes — likely dormant today since Mongo `_id`s
are never numeric `0`, but worth a presence-check fix).

Since baseline (21st slice, parallel-test-agents): `consent.service.js`,
`security.service.js`, and `auth.routes.js` moved off the LOW bucket — a
3-agent parallel-test-agents slice (34 + 37 + 43 new/added tests
respectively — consent.service.unit.test.js went from 35→69 tests,
security.service.unit.test.js from 13→50, and auth.routes.test.js's
entire prior content was replaced, from 0 real tests to 43 — all green,
independently re-verified together). `auth.routes.test.js` previously
existed but was a fully fake placeholder file (every test body was
`expect(true).toBe(true)` under comments describing what "should" be
tested) despite being named an integration test — replaced entirely
with real supertest tests mounting the actual router via
`createRequire`, which is almost certainly why the route file sat at
28% coverage despite "having tests." Exact new percentages not yet
re-measured, will land at the next full reconcile. This slice surfaced
three findings, all filed: #61 (`POST /two-factor/disable` is gated
behind `authenticate`, but `disable` is missing from `authenticate`'s
MFA-setup-route exemption list unlike `/two-factor/qr`/`enable`/
`mfa/setup`/`enable`, so a caller needs a fully live session just to
reach a stub endpoint that always 501s), #62 (`consent.service.js`'s
`createTemplate` rejects any template without an explicit `caae` even
though `validateTemplatePayload` treats it as optional — a normalize-
vs-model-validate mismatch), and #63 (`consent.service.js`'s ajv
`removeAdditional: 'all'` on the `patientConsentSchema` strips every
key out of a submitted `responses` object before
`validateResponsesAgainstTemplate` ever sees it, so
`createPatientConsent` always operates on `{}` regardless of what the
client submits — confirmed with a failing-if-fixed test, likely
production-impacting). Also noted for awareness, out of scope:
`authenticate`'s `isSecurityMFASetupRoute` check uses
`req.path.includes(...)` (substring match) rather than an exact route
match, a possible accidental path-prefix bypass surface.

Since baseline (22nd slice): `log.service.js` moved off the LOW bucket —
23 new unit tests added in a new `tests/unit/log.service.test.js` (all
green), covering `sanitizeLogData`'s Patient-message stripping/entityID
normalization, `createLog`'s validation/audit-hash/insert-failure paths,
`getLogs`'s filter-combination logic ($or/$and merging across
resourceType/status/search/userId aliases) and pagination defaults,
`getUserLogs`/`getEntityLogs` query shapes, and `exportLogsToCSV`/
`exportLogsToExcel`'s success and failure paths. No product bugs found;
one gnarly regex behavior confirmed by test (`sanitizeLogData`'s message
regex consumes to end-of-string when no digit follows "Paciente ",
rather than just stripping the name). Exact new percentage not yet
re-measured, will land at the next full reconcile.

Since baseline (23rd slice, parallel-test-agents): `integrityCheckService.js`,
`patientBiomarkerTimeseries.service.js`, `miabisValidator.service.js`, and
`sampleComplianceSync.service.js` moved off the ZERO/LOW bucket — a 4-agent
parallel-test-agents slice (16 + 19 + 9 + 11 = 55 new targeted tests, all
green, independently re-verified together) — exact new percentages not yet
re-measured, will land at the next full reconcile. This slice surfaced one
finding, filed as #64: `miabisValidator.service.js`'s `consentStatus:
'not_found'` value is produced by two semantically different situations
(sample missing from MongoDB vs. sample complete but no Neo4j consent
record found) with no way to distinguish them except also checking
`missingFields` for the `'sampleNotFound'` sentinel, and its Neo4j
try/catch swallows errors into `consentStatus: 'error'` with no actual
logging despite a comment saying `// Log error or handle as needed`.

Since baseline (24th slice): `auth.service.js` moved off the LOW bucket —
43 new targeted tests covering `processLogin`'s full MFA-setup/MFA-verify/
lockout/success branches plus the previously-untested
`setupMFAFirstLogin`, `enableMFAFirstLogin`, `setupMFA`, `enableMFA`,
`requestPasswordReset`, and `resetPassword` methods, all green
(`tests/unit/auth.service.processLogin.unit.test.js`). No product bugs
found; exact new percentage not yet re-measured, will land at the next
full reconcile.

Since baseline (25th slice): `session.service.js` moved off the LOW
bucket — 27 new unit tests added to the existing
`tests/unit/session.service.unit.test.js` (20 → 47 total), covering all
the db-backed methods the prior tests skipped: `createSession`
(cache+persist, error propagation), `updateActivity` (cache hit, legacy
plain-token fallback, expired-session invalidation, db-write-error
swallowing), `verifySession` (not-found/revoked/expired/valid/error
paths), `invalidateSession`/`invalidateUserSessions` (cache eviction +
db update, error swallowing), `cleanupExpiredSessions`,
`listUserSessions` (summary-shape mapping, current-session detection),
`revokeSessionById`, `revokeAllOtherSessions`, `getSessionByRefreshToken`,
and `rotateSessionTokens`. All green. No product bugs found. Exact new
percentage not yet re-measured, will land at the next full reconcile.

Since baseline (27th slice, parallel-test-agents): `src/routes/orphanet.js`,
`src/interface/routes/location.routes.js`, and
`src/interface/routes/terminologies.routes.js` moved off/further off the
LOW bucket — a 3-agent parallel-test-agents slice (6 + 19 + 5 = 30 new
targeted tests, all green, independently re-verified together) — exact new
percentages not yet re-measured, will land at the next full reconcile.
`orphanet.js` (the real handler mounted at `/api/orphanet` via the
`orphanet.routes.js` re-export — previously untested; the pre-existing
`orphanet-count.test.js` tests a different, unrelated file
`orphanet-count.js`) got a new
`tests/unit/routes/orphanet.test.js` covering its one `GET /search` route:
the missing-`q` 400 guard, lang-scoped-vs-fallback query branching, the
error 500 path, and `client.close()` running on both success and error.
This surfaced that `vi.mock('mongodb', ...)` does not intercept a CJS
`require('mongodb')` inside a `.js` source file any more than `vi.mock`
does for the repo's own CJS sources — the workaround used instead was
patching the `mongodb` module's `MongoClient` export via
`Object.defineProperty` before `createRequire`-loading the router,
documented in the test file. `location.routes.js` got 19 new tests added
to the existing `tests/integration/location.api.test.js` (8 → 27 total)
covering `GET/PUT/DELETE /:id` and `PATCH /fix-missing-locationids` (none
had any coverage before), plus previously-untested `POST /` branches
(numeric coercion, validation 400, duplicate-locationID 400,
auto-generated locationID). `terminologies.routes.js` got 5 new tests
added to `tests/integration/terminologies.api.test.js` (7 → 12 total)
covering the live-Orphadata-fetch fallback path end to end (using a
`require.cache`-reset + fresh env var to get a real per-test module
instance, since `ORPHADATA_BASE_URL` is captured into a module-level
`const` at require time), its disabled/unset-base-URL early return, its
per-URL fetch-error swallowing, and ORPHA-code-normalization idempotency.
No product bugs confirmed as failing-if-fixed this slice, but three
findings worth a maintainer's attention were surfaced (not filed as
issues — descriptive/design-review-shaped rather than clear regressions):
`orphanet.js` constructs `new MongoClient(MONGO_URI)` outside its own
`try` block, so a synchronous throw from the driver's URI parsing bypasses
the route's 500 JSON error path entirely; its `finally`-block
`client.close()` is itself unguarded against throwing; and
`location.routes.js`'s per-route `if (!db) return 503` guards on
`GET/PUT/DELETE /:id` and the `PATCH` route are dead code in normal
operation since `authenticate` middleware already 503s first on a falsy
`req.app.locals.db`, with a *different* error message/shape than the
route's own guard — the route-level message is only reachable if `db`
becomes falsy in the narrow window between the middleware's check and the
handler running.

Since baseline (26th slice): `import-lgpd.service.js`'s `importPatients` method
got 11 new DB-backed unit tests in a new
`tests/unit/import-lgpd.service.importPatients.unit.test.js` (all green),
covering the empty-file/missing-headers throws, per-row rejection branches
(invalid email, missing/invalid/not-found consentTemplateId, duplicate
patient), the full success path (ID generation, PENDING_CONSENT status,
insert, consent notification enqueue + `consentNotifiedAt` update), the
notification-enqueue-failure-is-non-fatal path, and the `groupFields`
consentTemplateId fallback. `getCollection`/`generateUniquePatientID` are
destructured at module scope in the source, so per `testing-conventions`'
`vi.spyOn`-on-destructured-import gotcha, these were driven for real against
a fake `db.collection()` rather than mocked; `notificationService`/
`patientService` are required as whole module objects (not destructured), so
`vi.spyOn` on the real singletons worked normally. This slice surfaced one
confirmed bug, filed as #65: `results.total++` sits after the row's `try`
block, so the `continue` on every early per-field validation rejection (bad
email, missing/invalid consentTemplateId, template-not-found, missing name/
birthDate/sex, duplicate patient) skips it — `total` only counts rows that
fully succeed or throw an uncaught exception, under-reporting the
success/total progress ratio whenever rows are rejected by these specific
checks. `importSamples` (the other large DB-backed method in this file) and
the file/Excel-parsing paths (`readCSV`/`readExcel`) remain untested — good
candidates for a follow-up slice. Exact new file percentage not yet
re-measured, will land at the next full reconcile.

Since baseline (28th slice, parallel-test-agents): `src/services/fhir.service.js`,
`src/services/patient.service.js`, and `src/services/storageService.js` moved
further off the LOW bucket — a 3-agent parallel-test-agents slice
(29 + 12 + 13 = 54 new targeted tests, all green, independently re-verified
together) — exact new percentages not yet re-measured, will land at the next
full reconcile. `fhir.service.js` got its four composite FHIR-resource
builders (`patientToFHIR`, `sampleToFHIR`, `resultToFHIR`,
`temperatureToFHIR`) plus `getSampleTypeDisplay` covered for the first time
(previously only the small pure mapping/formatting helpers had tests); no
bugs found, only minor shape-asymmetry observations (e.g. `resultToFHIR`'s
Observation vs. DiagnosticReport `extension` field presence differs when
`filePath`/`fileType` are absent). `patient.service.js` got its main
DB-backed CRUD methods covered for the first time (`createPatient`,
`getPatient`, `listPatients`, `searchPatients`, `updatePatient`,
`deletePatient`) via hand-built fake `db`/collection objects plus
`vi.spyOn` on already-required singleton collaborators
(`fhirSyncService`, `biomarkerXaiService`, `patientBiomarkerTimeseriesService`)
— surfaced a real compliance-relevant bug, filed as #70:
`createPatient` never encrypts `alphaGal`/`lysoGb3` because
`PatientModel.create()` folds them into a nested `dadosEspecificos` blob
before `encryptSensitivePatientFields()` ever sees them at the top level,
while `updatePatient`'s equivalent path does encrypt them correctly — an
inconsistent create-vs-update gap. `storageService.js` got its write-path
methods covered (`allocateSampleToPosition`, `autoAssignSampleToBox`,
`releaseSampleFromPosition`) — surfaced a second real bug, filed as #69:
`allocateSampleToPosition`'s in-transaction `STORAGE_COLLISION` guard reads
`updateBoxResult.matchedDocuments` (always `undefined` on the real MongoDB
driver) instead of `matchedCount`, so the guard can never fire and the
method's only real protection against a same-position race is the
non-atomic pre-write `validatePositionAvailability` check — a TOCTOU gap.

Since baseline (29th slice, parallel-test-agents): `src/services/temperature.service.js`,
`src/services/DrugService.js`, and `src/interface/routes/logs.routes.js` moved off the
LOW bucket — a 3-agent parallel-test-agents slice (18 + 30 + 21 = 69 new/extended
targeted tests, all green, independently re-verified together) — exact new percentages
not yet re-measured, will land at the next full reconcile. `logs.routes.js` already had
a pre-existing partial `tests/integration/logs.api.test.js` (8 tests) which was extended
to 21 covering all 7 routes plus `requireAuditReader`'s substring-match branch. This
slice surfaced three findings, all filed: #71 (`DrugService.searchAndCacheDrug`'s
`||`-based limit clamp silently coerces an explicit `limit: 0` to the default of 10
instead of clamping to 1), #72 (`logs.routes.js` `GET /:id`'s ObjectId lookup always
wins over a colliding `logId` value, same shape as the already-tracked #34), and #73
(`temperature.service.js`'s `checkPolicyAndAlert` falls through to an unscoped
`findOne({})` — matching a random/first policy — when called with no policy identifier;
currently unreachable from its only caller's guard, but live public-method logic).

Since baseline (30th slice, parallel-test-agents): `src/services/import.service.js`,
`src/services/hl7.service.js`, and `src/interface/routes/equipment.routes.js` moved
further off the LOW bucket — a 3-agent parallel-test-agents slice (32 + 60 + 19 = 111
new/extended targeted tests, all green, independently re-verified together, plus a
combined run of all three files' tests together to catch cross-slice interaction) —
exact new percentages not yet re-measured, will land at the next full reconcile.
`import.service.js` got its pure parsers/validators covered for the first time
(`validateFileFormat`, `validateCSVStructure`, `validateFHIRFile`, `parsePatientCSV`,
`parseSampleCSV`, `parseLocationData`, `parseLocationCSV`, `parseTemperatureCSV`,
`cleanupFile`) — the big DB-backed `importPatients`/`importSamples`/`importLocations`/
`importTemperature` methods remain untested and are a good candidate for a follow-up
slice. `hl7.service.js` got its pure segment-builders/mappers covered
(`buildSPM`, `buildOBR`, `buildOBX`, `mapStatusToFHIR`, `mapInterpretationToFHIR`,
`mapSampleTypeToSNOMED`, `getSampleTypeDisplay`, `getMimeType`, `escapeXML`,
`formatFileSize`) — the DB-backed `generateHL7v2Message`/`generateFHIRResource`/
`generateCDA` remain untested. `equipment.routes.js` got 19 new integration tests
covering validation/duplicate-ID paths on `POST /`, malformed-ObjectId handling on
`GET/PUT/DELETE /:id`, numeric-`equipmentID` fallback lookups, and the quarantine-
service trigger/non-trigger branches on `PUT /:id`. This slice surfaced four
findings, all filed: #74 (`hl7.service.js`'s `getSampleTypeDisplay` has no fallback
for an unknown/undefined `sampleType`, unlike its sibling mappers, and leaks the
literal string `"undefined"` into generated FHIR output), #75
(`equipment.routes.js`'s `GET /:id` returns 500 on a malformed id where `PUT`/`DELETE`
correctly return 400, and `POST /`'s catch block maps even infra-level errors to 400),
#76 (`equipment.routes.js`'s six per-route 503 db-unavailable guards are dead code,
same pattern as the already-filed #67/#48), and #77 (`import.service.js`'s
`validateCSVStructure` silently no-ops validation for an unrecognized `dataType`, and
`parseTemperatureCSV`/`parsePatientCSV` let `NaN`/`Invalid Date` pass through
unflagged at parse time).

Since baseline (31st slice): `src/services/integrityCheckService.js` was found
stale in this file (listed at 36.84% LOW, but a full test file already existed
at `tests/unit/integrityCheckService.test.js` covering the bulk of
`buildMerkleForDate`, actually measuring 92.1% lines before this slice) — 9 new
targeted tests closed the remaining gaps: `stableStringify`'s ObjectId-like
(`toHexString`/`_bsontype`) branches, array recursion, Date-instance
serialization, the plain-`JSON.stringify` fallback for values with no
dedicated branch (e.g. functions), and `getTimestampISO`'s explicit
`timestampISO`/derived-date/invalid-date branches. Now at 100% statements/
lines, 99% branches, all 25 tests green. Removed from the LOW bucket table.

Since baseline (32nd slice): `src/services/fhir.service.js` was found stale
in this file (listed at 36.92% LOW, but a full test file already existed at
`tests/unit/fhir.service.unit.test.js`, actually measuring 90.76% lines
before this slice) — 12 new targeted tests closed the remaining gaps: the
four `catch`-block/error-rethrow branches in `patientToFHIR`/`sampleToFHIR`/
`resultToFHIR`/`temperatureToFHIR`, the previously-untested
`findResourceByIdentifier` (happy path + rejected-promise path), the
`mapSensorStatusToFHIR('maintenance')` and `mapQualityToFHIR(0)`/`(2)`
numeric branches, and `sampleToFHIR`'s `receivedTime`/`protocolApplied`/
`specimenCollection` fields. Now at 100% lines/functions, 96.47% statements,
85.18% branches, all 60 tests green. Removed from the LOW bucket table.

Since baseline (33rd slice): `src/services/storageService.js` moved off the
LOW bucket for good (46.06% -> 93.01% statements / 92.88% lines / 80.45%
branches, 16 new targeted tests, all green) by directly covering
`autoAssignSampleToBox`'s in-transaction race-retry paths (ALREADY_ALLOCATED/
BOX_FULL re-checks, STORAGE_COLLISION) and its Neo4j persist +
rollback-on-failure path, plus `allocateSampleToPosition`'s
already-allocated/modifiedCount-0 branches and the remaining generic catch
clauses in `findAvailablePosition`/`getSampleStorage`/`verifyBoxIntegrity`/
`getFreezerOccupancyStats`. This slice reconfirmed #69
(`allocateSampleToPosition`'s STORAGE_COLLISION guard checks
`matchedDocuments`, a field the real MongoDB driver never sets, so the
guard is provably dead even under a `matchedCount: 0` result) with a test
proving the silent pass-through — no new bugs found beyond the
already-filed #69.

Since baseline (34th slice): `src/config/uploadConfig.js` moved off the
LOW bucket (35.89% -> covered) with 12 new targeted tests covering
`fileFilter` (blocked extensions win over an allowed mimetype,
case-insensitive extension match, either allowed-extension-or-allowed-mimetype
acceptance, both-unrecognized rejection, missing-originalname fallback),
`storage.getFilename` (sanitization of unsafe characters/path traversal
in `originalname`, extension preservation, default-name fallback), and
`storage.getDestination` (year/month directory creation only when
missing, and the try/catch routing thrown `fs` errors to the callback
instead of throwing). No new product bugs found — the module's error
handling and filter logic behaved as written.

`src/services/batch-validation-engine.service.js` moved from 45.76% to
72.59% lines (2026-07-04) with 32 new targeted tests covering
`buildSampleRow` (header mapping, unknown-column and empty-row cases),
`classifyPatientRow`/`classifySampleRow` (each warning branch and the
clean no-warning case), `buildPatientLinkageQuery` (criteria ordering
across patientID/cpf/recordNumber/_id, and the empty/invalid-ObjectId
cases), `buildBiomarkerObservationPayloads` (valid payload construction,
negative-value rejection, no-biomarker-fields case),
`detectDataType`'s filename-hint fallback and default-to-patients
paths, `persistPatient`'s validation-error, success, warning (PARTIAL),
and thrown-error branches (mocking only `patientService.createPatient`,
exercising real `import-lgpd.service.parsePatientRow` validation), and
`readJsonRows`/`detectCsvSeparator`/`readCsvRows`/`readRowsFromFile`
against real temp-file fixtures (array/FHIR-bundle/single-object JSON,
separator detection, extension dispatch). `persistSample`'s DB-linkage
branches and `processBatchImport`'s chunking/progress loop remain
untested — good next slice. No new product bugs found; existing
behavior matched the tests written.

Follow-up same file (2026-07-04): `src/services/batch-validation-engine.service.js`
moved from 72.59% to 75.98% lines with 4 more tests on `persistSample`
covering its remaining branches — missing-required-field INVALID,
disease-text-without-ORPHA-code INVALID, no-patient-link-and-insufficient-
data-to-create-one INVALID, and the thrown-error-from-`sampleService.
createSample` INVALID path. `processBatchImport`'s chunking/progress
loop (mocking `StagingImport.findOne`/`updateOne`) is the only
remaining large gap in this file. No new product bugs found.

Second follow-up same file (2026-07-04): `src/services/batch-validation-engine.service.js`
moved from 75.98% to 88.7% lines with 6 new tests on `processBatchImport`,
using real temp-file JSON fixtures and `vi.spyOn(StagingImport, 'findOne'/
'updateOne')` (the established pattern from `import-batch.controller.test.js`):
missing-StagingImport throw, missing-file-on-disk throw, empty-rows
throw, an end-to-end run mixing a PARTIAL and an INVALID row (confirms
`completed` status fires whenever partialRows or validRows > 0), an
all-INVALID run confirming the `failed` status branch, and
`job.updateProgress` being called with 100 when a job is supplied. No
new product bugs found. Remaining gap in this file is `readXlsxRows`
(not exercised — low priority, exceljs-specific) and a couple of
defensive catch branches in `readRowsFromFile`'s extension-sniffing
fallback.

`src/database/neo4j.js` moved from 40% to 100% lines (2026-07-04) with
3 new tests in `tests/unit/database-neo4j.test.js`, reusing the
require.cache-injection mechanic from `tests/unit/neo4j-connection.test.js`
(this module does `const neo4j = require('neo4j-driver')` without
destructuring, so the cached module's `exports` can be swapped for a
fake before re-requiring): env-var-driven URI/username/password
construction, the bolt://localhost:7687 / neo4j / password default
fallback, and singleton memoization across repeated `getNeo4jDriver()`
calls. No new product bugs found — this is a thin, still-used (routes
`importFhirIntelligent.js` and `dictionary.js`) singleton wrapper
distinct from the richer `infrastructure/database/neo4j/connection.js`
module.

`src/controllers/audit.controller.js` moved from 47.56% to 100% lines
(2026-07-04) with 28 new tests in `tests/unit/audit.controller.test.js`,
mocking `integrityService`/`auditRootService`/`hl7AuditService`/
`merkleTree` via `vi.spyOn` (the `cid.controller.test.js` req/res-mock
pattern). Covers every handler's 503-db-unavailable, success, and
500-catch paths, plus `report`'s optional hash-query proof lookup and
`compare`'s three-way diff array (`no_saved_root`/`root_mismatch`/
`no_diff`). One real behavior surfaced (not a bug, just non-obvious):
`compare`'s `tampered` field is `saved && recalculated && ...`, so when
`saved` is `null` the field comes back as `null` rather than coercing
to `false` — asserted as-is in the test, no product change needed.
Branch coverage on this file settled at 81.25% (a few defensive
`?:`-style fallbacks inside already-covered lines); line/statement/
function coverage is 100%. No new product bugs found.

`src/routes/eConsent.js` moved from 47.88% to 91.54% lines (2026-07-04)
with 10 new tests in `tests/unit/eConsent.routes.test.js` (supertest +
a real express app with the router mounted, following the
`equipment.routes.quarantine.test.js` pattern). This slice found two
real, unrelated bugs in the same file, both filed rather than fixed
inline:
- **Issue #80**: `POST /generate-link`'s `sendConsentLink` import from
  `notification.service` resolves to `undefined` (that service only
  exports `sendConsentEmail`/`sendConsentSmsFallback`/
  `sendConsentWhatsappFallback`), so the happy path throws inside an
  uncaught-by-try/catch async handler and hangs the request. Not
  exercised via supertest (would hang the test run) — instead asserted
  the `undefined` export directly with a comment pointing at #80, and
  only tested the route's safe 400-validation branch.
- **Issue #81**: `GET /validate/:token` calls `PatientModel.findOne`,
  but `src/models/Patient.js` is a plain class with only static
  utility helpers and no `findOne` — every call throws and is caught
  by the route's blanket catch, so the endpoint always returns 401
  regardless of token validity. Asserted this actual behavior (with a
  comment pointing at #81) instead of the originally-intended
  200/404 responses.

`POST /update` (JWT verify, per-consent Neo4j MERGE, REVOKED→quarantine
and ACTIVE/GRANTED→release branches, socket emit) works correctly and
is fully covered with mocked `PatientModel`-adjacent dependencies
(`connection.getNeo4jDriver`, `Sample.updateMany`). Remaining gap is
the module-load `CONSENT_SECRET` guard (line 15, requires a fresh
require with the env var unset — low value) and the two bug-blocked
happy paths above.

`src/controllers/import-lgpd.controller.js` moved from 48.74% to
83.64% lines (2026-07-04) by adding 9 tests to the existing
`tests/unit/import-lgpd.controller.test.js` (which already covered
`listSmartImportReports`/`getPatientsSmartImportMetadata`/
`importPatients`/`predictPatientsMapping`/`importSamples`/
`importPatientsSmart`'s core paths) for the three previously entirely
untested template-download handlers. Covers
`downloadPatientTemplateExcel` and `downloadSampleTemplateExcel`'s
success/500-catch paths (forcing the catch via
`vi.spyOn(ExcelJS.Workbook.prototype, 'addWorksheet')`, since
`workbook.xlsx.writeBuffer` isn't easily mockable per-instance), and
`downloadSampleTemplateCSV`'s db-present/db-absent/db-collection-
throws-and-warns/csv-stringify-throws-500 branches (forcing the last
via `vi.spyOn(require('csv-stringify/sync'), 'stringify')`). No new
product bugs found. This closes out the LOW coverage bucket entirely —
see `COVERAGE_NOTES.md` for the note that the next session should run
a fresh `--coverage --reporter=basic` reconcile to regenerate real
buckets rather than continue from an empty list.

`src/services/equipment-sensor-quarantine.service.js` moved from 50%
to 96.25% lines (2026-07-04) via new
`tests/unit/equipment-sensor-quarantine.service.test.js` (8 tests).
Covers `isQuarantineTriggerStatus` (case/whitespace normalization),
`quarantineByEquipmentStatus` and `quarantineBySensorStatus`'s
short-circuit (non-trigger status), no-resolvable-identifier, and
full happy-path branches (location lookup, sample filter building,
per-sample quarantine update incl. the object-vs-non-object `location`
shape branch, and the append-only movement-ledger write). Mocking
followed the CJS require.cache-injection pattern from
`sampleComplianceSync.service.test.js` (`vi.spyOn` on the real
`collectionResolver`/`sampleMovementLedger`/`SampleMovement` module
objects, set before the service's first `require` so its module-scope
destructuring captures the spied bindings, reloaded via
`delete require.cache[...]` each test) rather than `vi.mock` factories,
which don't interop cleanly with this codebase's plain
`module.exports = { fn }` / `module.exports = ClassName` CJS shapes.
No new product bugs found; remaining 3.75% is the two-branch
`normalizeStatus`/`buildStatusChangeReason` default-string fallbacks
and one Number.isFinite edge, not worth chasing further.

`src/interface/routes/sample.routes.js` moved from 45.15% to 90% lines
(2026-07-04), extending the existing
`tests/unit/sample.routes.test.js` (19 → 53 tests) with the routes it
hadn't touched yet: `GET /:id/miabis-compliance`,
`GET /:id/compliance-graph`, `GET /` (including all three consent-
enrichment branches: active consent, pending consent, patient not
found), `GET /:id`, `PUT /:id`, `DELETE /:id`, `POST /:id/withdraw`,
`POST /:id/return`, `GET /:id/results`, and
`GET /by-barcode/:barcode/symbology-assets`. Reused the file's own
require.cache-injection harness (`loadRoute`/`clearCache`), extended
with two new fakes (`miabisValidator.service`'s destructured
`validateMiabisCompliance`, and a `FakeSampleGraphValidator` class
swapped into `require.cache` the same way `RegisterSampleUseCase`/
`LineageRepository` already were). No new product bugs found.
Remaining ~10%/34% branch gap is mostly the file-upload/export routes
at the bottom (`sampleFileController`-delegated, already exercised at
the controller level per earlier slices) and a couple of defensive
`req.t`/optional-chaining fallbacks not worth a dedicated test.

`src/infrastructure/persistence/mongo/MongoStorageRepository.js`
moved from 50.74% to **100% lines / 97.22% branches / 100% functions**
(2026-07-04). The existing `tests/unit/MongoStorageRepository.test.js`
(38 tests) already covered every method's happy path and error branches
except two untested one-liners, `findSampleById` and `findBoxById` —
added 2 tests for those (40 tests total). The file's isolated
`--coverage.include` run initially reported an implausible 60%
lines/40% functions despite the suite's real completeness; root-caused
to the test file's plain ESM `import` of this CJS class file
undercounting v8 coverage (confirmed via a minimal repro: identical
test body counted 2 vs. 3 covered functions under `import` vs.
`require()`). Fixed by switching the test file's import to
`createRequire(import.meta.url)` + `require(...)`, which alone took the
measured number from 60%/40% to 100%/100% with the same 40 tests,
same assertions. Root cause and the general rule (use `require()` for
CJS class files, not just for CJS-mocking cases) are now documented in
`testing-conventions`. No product bugs found. Remaining 2.78% branch
gap is 3 defensive `|| 0`/box-not-found fallbacks not worth a
dedicated test.

`src/interface/routes/cid.routes.js` moved from 51.16% to 72.09% lines
(2026-07-04) via new `tests/unit/cid.routes.test.js` (8 tests, using
the repo's require.cache-injection route-testing pattern). Covers
`GET /` (db-unavailable 503, normalized-document happy path including
the `Codigos_CID10` fallback-to-`Codigo_Tabulacao` branch and the
`normalizeBoolean` string-to-false branch, and the 500-on-throw path),
`GET /search`'s delegation to `cidController.search`, and the three
read-only routes' 405 responses. Remaining gap is two dead functions,
`buildCidPayload`/`validateCidPayload`, defined but never called now
that the write routes are all hardcoded 405s — filed as issue #82
(documentation, test-branch) rather than tested, since testing
unreachable/unexported code isn't meaningful. No other product bugs
found.

`src/controllers/sample-file.controller.js` moved from 51.86% to 69%
lines (2026-07-04), extending the existing
`tests/unit/sample-file.controller.test.js` (21 → 33 tests). Added the
`exportFHIR` branches the existing single happy-path test hadn't
covered (503/404-file/404-sample/audit-log/500), plus a full
`exportCDA` describe block (503/404-file/400-mismatch/404-sample/
happy-path/audit-log/500) mirroring the `exportHL7v2`/`exportFHIR`
pattern already in the file. No product bugs found. Remaining gap is
the `multer.diskStorage`'s `destination`/`filename`/`fileFilter`
callbacks defined in the constructor (lines ~24-66) — these are
multer's internal disk-storage hooks, not reachable by calling the
controller's own methods the way this test file does, and exercising
them would mean testing multer's internals rather than this
controller's logic; left untested as disproportionate for the value,
same call as `worker.js` in the ZERO bucket.

`src/routes/intakeWizard.js` moved from 52.7% to 95.94% lines
(2026-07-04) via new `tests/unit/intakeWizard.routes.test.js` (12
tests), alongside the existing `intakeWizard.helpers.test.js` (which
already covered the `router._test`-exposed pure helper functions).
The new file covers the two Express handlers the helpers file
couldn't reach: `POST /` (`handleIntakeWizard` — 400 invalid body,
503 db-unavailable, 400 missing-TCLE-template, 502 email-provider-
failure, full happy path persisting the sample and linking the
patient, and 502-on-throw) and `GET /patient-match` (503, 400 missing
query params, matched/unmatched by patientID, name+birthDate
normalization matching, and 500-on-throw). Used the repo's
require.cache-injection route-testing pattern for the route's two
destructured imports (`getCollection`, `generateSampleHash`) and
direct reassignment for its whole-module imports
(`notificationService`, `patientIdentityService`, `auditLogger`,
`qualityDomain`). No product bugs found.

`src/interface/routes/policy.routes.js` moved from 54.16% to 98.95%
lines (2026-07-04) via new `tests/unit/policy.routes.test.js` (25
tests, no prior test file existed). Covers all 6 CRUD routes: `GET /`,
`GET /:id` (numeric-policyId lookup, ObjectId fallback, 404, 500),
`GET /:id/active-limit` (max/min threshold selection, unit default,
404, 500), `POST /` (validation failure, happy path, insert-throws),
`PUT /:id` (404, happy path, throws), `DELETE /:id` (404, happy path,
throws). `PolicyModel` is a plain static class referenced as
`PolicyModel.validate`/`.create` (not destructured), so no
require.cache trick was needed for it — only `authenticate`/
`requirePermission` needed the route-testing pattern. No product bugs
found; remaining gap is one branch in the `GET /:id` numeric-then-
ObjectId fallback not worth a dedicated test.

`src/services/patient.service.js` (2026-07-04): this is a large
1074-line/32-function service; `getPatient`/`listPatients`/
`searchPatients`/`updatePatient`/`deletePatient`/`createPatient`
already had partial coverage from earlier work. Added 11 tests to
`tests/unit/patient.service.unit.test.js` (38 → 49) for the three
consent-token methods that had zero coverage: `validateConsentToken`
(missing-args, not-found, wrong-status, token-mismatch, expired,
valid), `acceptConsentToken` (happy path + propagated validation
failure), `resendConsentNotification` (missing-patientID, not-found,
wrong-status, new-token-generation, existing-valid-token-reuse).
Function coverage for the file moved 50% → 71.87% (16 → 23 of 32).
Overall line % barely moved in an isolated 2-test-file run — the
full-suite 55.5% baseline includes coverage from other test files/
routes that call into this service, which an isolated run can't see —
so the file stays listed in MID-LOW rather than claiming a number
this slice can't confirm. **Remaining for a future slice**:
`createPatient`/`updatePatient`'s many untested branches,
`resolveClinicalUnitSnapshot`, `checkIdentifierConflict`,
`checkDuplicatePatient`, `syncPatientPhoneToGraph`,
`ensurePatientIndexes` — this file is too large for one iteration,
treat it as an ongoing multi-slice target. No product bugs found this
slice.

## user-security.service.js (2026-07-05)

Added `tests/unit/user-security.service.db.unit.test.js` (24 tests)
covering the DB-dependent methods that had zero coverage:
`getMFAStatus`, `getPasswordStatus`, `getSecurityStatus` (happy paths,
weak/strong levels, not-found errors), `updatePassword` (wrong current
password, weak new password, password reuse, success path rotating
history), `generateRecoveryCodes`, `revokeSession`/`revokeAllSessions`
(exercising the real `session.service` singleton's in-memory `sessions`
Map directly rather than mocking the require), `requestPasswordReset`,
`getUserAnonId`, `getActivities` (classification branches: login,
mfa_change, password_change, suspicious, failed_attempt), and
`getSessions` (DB-backed session with parsed device/browser/OS/location,
and the synthetic-current-session fallback when nothing is stored).
Isolated run: 91.02% lines (from 68.57%), 76.85% branches, 95.65%
functions. Remaining gap is defensive `logger.error`/rethrow branches
in a few catch blocks and one edge case in `revokeSession`'s cache
cleanup loop — low value to chase further. No product bugs found this
slice.

**Slice (2026-07-05):** `src/services/log.service.js` 69.84% → 99.47%
lines, 91.58% branches (isolated run: `log.service.test.js` +
`log.service.unit.test.js`). Extended the existing test file with 23
new tests covering `getLogs`'s remaining filter branches (userName
regex, action/entity/severity/result/module array-vs-scalar `$in`
branches, ip/ipSource/sourceIP aliases, startDate/endDate merged into
an existing `$and`, merged into a bare `$or`, and set fresh with no
prior filter, custom `sortBy` without the default tiebreaker),
`getUserLogs`/`getEntityLogs`'s error-rethrow paths, and
`exportLogsToExcel`'s defensive branches (non-object `getLogs` result,
non-array `.logs`, missing `.logs` key, empty-logs warn path, per-row
ip/timestamp/id fallback extraction, and the per-row `catch` that
returns an all-`N/A` row). The `anonymizeLogs`-throws catch
(lines 447-452) needed the `require.cache` injection technique from
`testing-conventions/references/cjs-mocking.md` — `log.service.js`
destructures `const { anonymizeLogs } = require(...)` at module scope,
so `vi.spyOn` on the `userAnonymization` module object silently no-ops.
One line (477, the `catch` inside the timestamp-parsing try) stays
uncovered — `new Date(x)` returns `Invalid Date` rather than throwing
for any malformed input reachable here, so the catch is defensive/
unreachable without mocking `Date` itself; not worth it. No bugs found.

**Fix (2026-07-08, issue #78):** `src/interface/routes/reports.routes.js` 71.84% -> 77.41% lines, 58.21% -> 66.43% branches. Fixed the `isSampleAnalysis` branch being unreachable (shadowed by the generic `amostra/sample` check that ran first and matched the substring in "sampleanalysis"); moved the dedicated analysis/grouping branch ahead of the generic one. Un-weakened the pinned test in reports.api.test.js to assert the correct grouped-analysis shape instead of documenting the bug.

**Slice (2026-07-13):** `src/interface/routes/label.routes.js` 11.76% -> 97.64% lines (68.29% branches), new file `tests/unit/label.routes.test.js` (13 tests). Covers both routes (`GET /samples/:sampleId` and `GET /samples/:sampleId/print-job`): db-unavailable 503, sample-not-found 404, missing-physical-location 409, all four response formats (json/zpl/svg/html), XML-escaping of special characters in svg/html output, and the generic 500 catch path. No bugs found; only remaining uncovered lines are the ObjectId-vs-string boxId branch in `resolveStoragePathText` and one location-text fallback branch, both low-value edge cases.

**Slice (2026-07-13):** `src/services/graphProjection.service.js` 50.00% -> 100% lines (97.18% branches), new file `tests/unit/graphProjection.service.test.js` (17 tests). Covers `stableHash` (key-order stability, differing payloads, hex-digest shape) and all four `GraphProjectionService` methods (`appendConsentEvent`, `appendLineageEvent`, `appendQualityEvent`, `appendTelemetryEvent`) via an injected fake outbox: happy paths, every `||`-fallback chain for aggregateId/payload fields, default-status/sourceService/traceId/timestamp branches, and the `score ?? null` nullish-coalescing distinction (score of `0` preserved, not coalesced away). Found a real bug: exported `stableHash(undefined)` throws a `TypeError` from `crypto.createHash().update(undefined)`, because `JSON.stringify(undefined, replacer)` is always `undefined` regardless of the `payload || {}` guard on `Object.keys`; `stableHash(null)` does not hit this (stringifies to the string `"null"`) but hashes differently than `stableHash({})` despite the same guard treating them alike for key extraction. Filed as issue #176; test asserts the actual throwing behavior with a comment pointing at the issue, not weakened to hide it.

**Slice batch (2026-07-21, #228 batch-1, parallel fan-out via 3 test-writer agents):**
- `src/models/MeasurementUnit.js` 75.00% -> full validation-branch coverage, new file `tests/unit/MeasurementUnit.model.test.js` (12 tests). Covers `validate()`'s falsy-vs-zero `unitID` special case, `description` type/empty checks, and `create()`'s `abbreviation` falsy-fallback default. No bugs found.
- `src/routes/orphanet.js` 72.26%/52.04% -> 99.15% lines / 83.62% branches (isolated run), extended `tests/unit/orphanet.routes.test.js` (+19 cases). Covers limit clamping, lang-filter broadening/skip, ORPHA code-prefix regex construction, cids/orphanet_diseases dedup merge, Orphadata remote-sync fallback paths (disabled, non-OK, abort/timeout), and local-search retry/fallback error handling. Two findings filed: #231 (lang=<whitespace> bypasses language filter differently than omitted lang) and #232 (local-search retry logs a misleading "external failed" message even when the original failure was local).
- `src/interface/routes/terminologies.routes.js` 76.66%/51.50% -> extended, extended `tests/integration/terminologies.api.test.js` (+14 cases). Covers the sync-route error path, code-prefix filter branch, non-ORPHA system guard, local-redundancy hydration (cids + orphanet_diseases), and Orphadata live-fallback edge cases (non-2xx, abort/timeout, non-resolvable result, non-numeric search term). Two findings filed: #229 (inconsistent search-string normalization between inline filter and hydrateFromLocalRedundancy) and #230 (dead redundant fallback in bulkUpsertOrphanetRedundancy's source field).

All three slices verified individually and together (56 tests, single `vitest run`, no cross-slice interaction). Not yet re-measured by a full reconcile — numbers above are isolated-file runs.

**Slice (2026-07-21):** `src/services/hl7.service.js` 73.45%/47.15% -> 100%/81.81% (isolated run). See prior commit for detail; noted here to keep this archive in sync with the batch-1 push.

**Slice (2026-07-21):** `src/interface/routes/result.routes.js` 80.97%/55.45% -> 87.61% lines / 59.09% branches (isolated run), extended `tests/integration/result.routes.api.test.js` (+14 cases, 38 -> 52 tests). Covers db-unavailable (503) branches across POST/PUT/DELETE handlers, outer-catch (400/500) branches when the underlying collection call throws (`insertOne`/`updateOne`/`deleteOne`/`findOne` rejections), the numeric-sampleID fallback lookup in the upload route's ObjectId-cast catch, the `GET /:id/download` success path (actual file streamed via `res.download`), and the `GET /` list without an `importJobID` filter. No bugs found. Remaining uncovered lines (~12%) are defensive/unreachable in practice: the multer `diskStorage` destination/filename error callbacks, and the in-route `fileType`/`sampleID` re-checks in the upload handler that can never fail because multer's `fileFilter` and `diskStorage.destination` already gate those same conditions before the handler body runs.

**Slice (2026-07-21):** `src/utils/portManager.js` 78.48%/62.85% -> 100% lines / 80% branches, extended `tests/unit/portManager.test.js` (13 -> 21 tests). The prior file already covered the real-OS happy paths (`isPortAvailable`, `findAvailablePort`, real process kill/detect via `spawnPortHolder`); the gap was the POSIX-only code paths unreachable on this Windows dev machine (`_getProcessUsingPortPosix`, `killProcessOnPort`'s `process.kill` branch) plus a couple of Windows-side inner-catch branches. Covered by spying on `child_process.exec` (mocked per source file, since `exec` is destructured at module scope — see cjs-mocking.md) and re-requiring a fresh module instance so the destructuring picks up the mock, plus temporarily overriding `process.platform` to exercise the non-win32 dispatch/kill branches. No bugs found; remaining ~20% branch gap is unreachable pid-parse guards (`pid && !isNaN(pid)` when the command's stdout is empty/garbage, never hit by any exec output shape this code actually issues).

**Slice (2026-07-21):** `src/interface/routes/logs.routes.js` 81.81%/61.19% -> 100% lines / 91.04% branches (isolated run), new file `tests/integration/logs.routes.test.js` (33 tests, no pre-existing test file). Covers `requireAuditReader`'s accessType-4/roleName-admin/accented-"administradór"/role-contains-auditor allow branches (with the diacritic-stripping `normalizeRoleName` exercised), the denied and missing-req.user cases, the 503-no-db branch on all seven routes, `GET /`/`GET /all`/`POST /query`'s success/500 paths (`/all`'s default-limit-1-page vs. explicit-query-limit branches), `POST /register`'s 201/400 paths and that it is deliberately not gated by `requireAuditReader` (asserted directly), the CSV/XLSX export routes' content-type/content-disposition headers, `buildCsv`'s quote-escaping and empty-logs-array fallback, and `GET /:id`'s valid-ObjectId-hit, invalid-ObjectId-falls-back-to-logId, valid-ObjectId-miss-falls-back-to-logId, 404, and 500 paths. No bugs found; remaining ~9% branch gap is the same kind of unreachable defensive fallback seen elsewhere in this batch (optional-chaining branches on already-guaranteed-present request fields).
