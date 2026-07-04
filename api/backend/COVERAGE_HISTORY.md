# Backend coverage history (archive)

Slice-by-slice narrative for the test-loop coverage push, split out of
`COVERAGE_NOTES.md` on 2026-07-04 because the combined file had grown
too large to read cheaply every session. **This file is for occasional
reference only** (e.g. tracing back why a file/bug was flagged) — the
per-session read is `COVERAGE_NOTES.md`, which holds only the current
ZERO/LOW buckets and reconcile numbers. Do not read this file as part
of normal slice-picking.

Entries below predate the 2026-07-04 reconcile; percentages mentioned
inline were provisional at the time and have since been superseded by
that reconcile's real `coverage-summary.json` numbers (see
`COVERAGE_NOTES.md`). Numbered slice ordinals are non-contiguous /
non-sequential in places (multiple concurrent authoring passes) — trust
the issue numbers and file names, not the slice ordinal.

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
