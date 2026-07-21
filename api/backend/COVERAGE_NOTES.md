# Backend coverage tracker

Purpose: let `test-loop` pick the next slice by reading this file instead
of running `npx vitest run --coverage` (~2-3 min, 258 files) at the start
of every session. This file is a snapshot, not a live number — it goes
stale as slices land and as source files change. Keep it honest:

- **Every commit that adds/extends a test for a file listed here must
  move that file to a truer bucket (or off the ZERO/LOW list) in the same
  commit.** Don't let the tracker and the code diverge silently.
- **Reconcile with a real coverage run periodically**, not every
  iteration: at the `ship-to-main` gate, or if a session's own targeted
  runs stop matching what this file claims (a sign of drift). Full
  regenerate command:
  `cd api/backend && npx vitest run --coverage --reporter=basic`, then
  re-derive buckets from `coverage/coverage-summary.json` (`lines.pct`
  per file). `coverage/` is gitignored — this file is the durable record.
- **This file stays lean on purpose** — only the current buckets and the
  latest reconcile numbers. Slice-by-slice narrative history (what each
  past slice covered, which issues it filed) lives in
  `COVERAGE_HISTORY.md` instead, so a normal test-loop session doesn't
  pay to read hundreds of lines of past-slice prose it doesn't need.
  Append new slice narrative there, not here.

## Last full reconcile

**2026-07-15**, snapshot from commit `94e2fc62` on
`feature/docker-e2e-backend-integration` (`npx vitest run --coverage
--reporter=basic`, full suite; buckets below re-derived directly from
`coverage/coverage-summary.json`, not read off printed totals).

Statements 85.73% (16008/18671), Branches 75.66% (12629/16690), Functions
86.58% (1956/2259), **Lines 86.33%** (15429/17871) — **up** from the prior
reconcile's 82.4% lines (commit `28adc855`, 2026-07-14), consistent with
#146-#164 fixes and #203/#212/#227 landing since.

The same run showed 5/265 test files (123/4739 tests) failing — all five
are the currently-open design-fork issues (`sample.model.gaps.test.js`,
`sample.model.unit.test.js`, `sample.models.test.js` → #208/#224;
`patient.model.unit.test.js` → #218; `SampleGraphValidator.js`'s gaps are
tracked separately as #222 but don't yet have a failing test file of
their own). No new, previously-unseen failures found this reconcile —
don't re-file these, they're already tracked and blocked on Dennis's
design calls per the fix-bugs backlog. The `NotificationService.test.js`
> `buildConsentLink` failure noted at the 2026-07-14 reconcile is gone —
resolved by intervening fixes, no issue needed.

**Bucket lists below are freshly regenerated this session** (previous
reconcile's buckets were one cycle stale, now current). Cutoffs unchanged:
ZERO = 0%, LOW = 1-49%, MID-LOW = 50-69%, MID-HIGH = 70-84%, GOOD = >=85%.

## How to use this when picking a slice

1. **Check whether a candidate file is on the list above (broken by a
   filed issue) before treating its low number as an untested gap** —
   if so, skip it for slice-picking; it needs a fix, not a new test.
2. Among genuinely low-coverage files, prefer real-logic files over thin
   ones: `src/core/application/ports/*` (interfaces, zero logic) and
   `src/scripts/*` (one-off migration/seed scripts, not exercised in prod
   request paths) are low priority regardless of bucket.
3. This reconcile has real (non-drift) entries in every bucket again —
   ZERO/LOW/MID-LOW are no longer empty. Pick from LOW or MID-LOW first
   for the biggest jump per slice, same as before the 2026-07-05
   reconcile emptied them.
4. For a MID-HIGH (70-84%) file not already flagged above as
   issue-linked, the number here is trustworthy — no fresh isolated run
   needed before committing to it.
5. After landing a slice, delete the file's line from whichever bucket it
   was in (or move it, if now partial). Don't leave stale entries. Add a
   short entry to `COVERAGE_HISTORY.md` for what the slice covered/found
   — not here.

## ZERO coverage (0% lines) — 18 files, full reconcile 2026-07-15, commit `94e2fc62`

Real logic, but broken-by-issue — see caveat above, not a real gap:
- `src/workers/worker.js` (self-executing bootstrap entrypoint — calls
  `startWorker()`/`process.exit` at module load; disproportionately
  expensive to test honestly, lower priority than it looks even once
  untangled from #147)

Low priority (models/interfaces/one-off scripts — thin or non-request-path):
- `src/core/application/ports/IAuditRepository.js`
- `src/core/application/ports/ILineageRepository.js`
- `src/core/application/ports/IPatientConsentReadRepository.js`
- `src/core/application/ports/IStorageRepository.js`
- `src/core/application/ports/IStorageTopologyReadRepository.js`
- `src/models/Cid.js`
- `src/models/Disease.js`
- `src/models/DrugDictionary.js`
- `src/models/Equipment.schema.js`
- `src/models/StoragePath.js`
- `src/models/TemperaturePolicy.schema.js`
- `src/models/Withdrawal.js`
- `src/scripts/migrate-rcs-governance-indexes.js`
- `src/scripts/migrateUserAnonIds.js`
- `src/scripts/seedDiseaseValidationRules.js`
- `src/scripts/testEnvironment.js`
- `src/services/orphanet/orphacodeApiClient.js` (issue #163 — routes.js
  returning 503 may be the same terminologySync gate; check before
  treating as a genuine gap)

## LOW coverage (1-49% lines) — 7 files, full reconcile 2026-07-15, commit `94e2fc62`

Sorted ascending (worst first) — lines% / branches%. All seven are the
same audit/rename-drift cluster (issue #146) already tracked; none are
genuinely untested slice candidates.

```
src/services/auditRoot.service.js                6.95 / 0        (issue #146 cluster — audit/rename drift)
src/services/audit-tree.service.js               7.89 / 0        (issue #146 cluster)
src/services/audit-signing.provider.js          14.81 / 0        (issue #146 cluster)
src/interface/routes/intakeWizard.routes.js     16.98 / 0        (issue #146 cluster)
src/services/audit-tsa.service.js               21.42 / 0        (issue #146 cluster)
src/services/audit-witness.service.js           27.27 / 0        (issue #146 cluster)
src/controllers/fhir-import-staging.controller.js 30.23 / 41.17  (issue #146 cluster)
```

Genuinely low (no matching filed issue found) — real slice candidates:
none currently listed. Moved to GOOD (>=85%) since the 2026-07-14
reconcile: `PatientIdentityService.js`, `MoveSampleUseCase.js`,
`sampleIDGenerator.js`, `ReleaseSampleUseCase.js`,
`AllocateSampleUseCase.js`, `authConsent.js`,
`patientBiomarkerTimeseries.service.js` — all #146-family fixes landed.

## MID-LOW coverage (50-69% lines) — 3 files, full reconcile 2026-07-15, commit `94e2fc62`

Sorted ascending (worst first) — lines% / branches%.

```
src/workers/jobs/daily-merkle.job.js            60.00 / 52.17   (issue #159 — stale test mock)
src/services/audit-v2.service.js                60.81 / 43.75   (issue #146/#152 cluster)
src/services/neo4jCanonicalProjection.service.js 65.00 / 58.41  (issue #146 cluster)
```

Genuinely low (no matching filed issue found) — real slice candidates:
none currently listed. Moved to GOOD (>=85%) since the 2026-07-14
reconcile: `fhir.service.js`, `result-worker.js` (now MID-HIGH, see
below), `LineageRepository.js`, `analysisValidation.service.js`,
`import-lgpd.service.js`, `consent.validator.js`.

## MID-HIGH coverage (70-84% lines) — 39 files, full reconcile 2026-07-15, commit `94e2fc62`

Sorted ascending (worst first) — lines% / branches%. Not cross-checked
against filed issues line-by-line (MID-HIGH files are closer to "done"
regardless); a lower branch% relative to lines% usually means untested
error paths, a good tie-breaker when picking among these.

```
src/models/PatientConsent.js                      70.83 / 85.24
src/services/mqtt-telemetry.service.js            71.42 / 78.09   (issue #160 — HMAC bypass bug)
src/services/hl7.service.js                       100.0 / 81.81  (covered — see history archive)
src/controllers/iot.controller.js                 79.76 / 73.52  (branches covered — see history archive; applyColdChainQuarantine catch + a couple of resolveTemperaturePolicy edge branches remain)
src/utils/fieldEncryption.js                      76.19 / 69.56
src/infrastructure/persistence/mongo/MongoAuditRepository.js 76.66 / 84.61
src/workers/workers/result-worker.js              76.66 / 66.07   (issue #146/#164 — rename + yauzl)
src/scripts/createFirstAdmin.js                   77.27 / 65.00
src/core/use-cases/RegisterSampleUseCase.js       77.33 / 69.31
src/services/SampleGraphValidator.js              77.69 / 66.66   (issue #222 — legacy-schema migration, design fork)
src/utils/portManager.js                          100.0 / 80.00   (covered — see history archive)
src/models/User.js                                98.03 / 97.89   (covered — see history archive)
src/workers/neo4jProjection.worker.js             79.62 / 73.33
src/models/AnalysisType.js                        80.00 / 75.00
src/reference-data/essential/manifest.js          80.00 / 0
src/database/mongo.js                             80.10 / 76.51
src/services/merkle-envelope.service.js           80.30 / 66.21
src/interface/routes/analysis-file.routes.js      80.95 / 87.50
src/interface/routes/master-data.routes.js        81.42 / 68.75
src/config/redis.js                               81.76 / 70.45
src/interface/routes/equipment.routes.js          81.92 / 74.11
src/utils/auditLogger.js                          82.00 / 67.96
src/controllers/import.controller.js              82.23 / 75.86
src/services/security.service.js                  82.51 / 72.26
src/infrastructure/queue/Neo4jQuarantineService.js 83.33 / 82.75
src/services/fhir-import-staging.service.js       84.15 / 77.86
src/controllers/import-async.controller.js        84.29 / 79.66
```

Note: `sample.service.js` (85.15%) and `import.service.js` (89.92%)
moved into GOOD since the 2026-07-14 reconcile; `batch-validation-engine.service.js`
(88.20%), `audit.controller.js`, and `audit-canonicalization.service.js`
(87.87%) also moved to GOOD — not cross-checked against #152/#162
line-by-line since they're now well above the MID-HIGH cutoff.

Removed 2026-07-21 (#228 batch-1 slices, not yet re-measured by a full
reconcile): `src/routes/orphanet.js` (branch tests added, isolated run
now 99.15% lines / 83.62% branches — see `COVERAGE_HISTORY.md`),
`src/interface/routes/terminologies.routes.js` (branch/error-path tests
added), `src/models/MeasurementUnit.js` (moved out of this bucket
entirely, was 75.00/40.00 — full validation-branch coverage added),
`src/interface/routes/result.routes.js` (was 80.97/55.45, isolated run
now 87.61% lines / 59.09% branches — 503/catch-block and download-success
paths added; remaining gap is mostly unreachable defensive code, see
`COVERAGE_HISTORY.md`), `src/controllers/analysis-type.controller.js`
(was 77.14/57.14, isolated run now 100% lines / 100% branches — no
pre-existing test file, full new suite added, see `COVERAGE_HISTORY.md`),
`src/services/patient.service.js` (was 70.64/60.63, isolated run across
its full unit-test set now 74.78% lines / 57.45% branches —
`resolveClinicalUnitSnapshot`, `ensurePatientIndexes`,
`checkIdentifierConflict`, `checkDuplicatePatient`, ObjectId-lookup
branches in `getPatient`/`updatePatient`/`deletePatient`, and
`searchPatients`' date-parsing branches added; remaining gap is mostly
`createPatient`/`updatePatient` error-path permutations already
partially covered by `patient.service.createUpdate.gaps.unit.test.js`,
see `COVERAGE_HISTORY.md`), `src/infrastructure/middleware/auth.js` (was
71.66/68.18, isolated run now 100% lines / 95.45% branches — new
`tests/unit/infrastructure/middleware/auth.test.js`, no pre-existing
test file for this one; covers no-token/malformed-header,
TokenExpiredError vs. generic invalid-token, session-missing-db 503,
all three `verifySession` invalid reasons, the keepalive/mfa-setup
session-check bypass routes, the mfaSetupRequired/mfaVerified 403 gate,
the outer-catch 500, and `optionalAuth`'s no-op-on-error path),
`src/controllers/import-lgpd.controller.js` (was 82.66/54.41, isolated run
across its three test files now 100% lines / 87.9% branches — extended
`tests/unit/import-lgpd.controller.gaps.test.js` across two passes:
the multer storage/fileFilter config (destination/filename/blocked-
extension/disallowed-mimetype/allowed/zip branches, previously entirely
untested); `importPatientsSmart`'s invalid-format 400, string/object
groupFields+mapping parse branches, malformed-JSON-hits-outer-catch,
null-resourceId/default-message fallbacks, the partial-errors warning-
status audit event, the no-req.user skip of both audit calls, and the
catch block's failure-status audit event including its own inner
try/catch swallow of a failing audit-log call; `importPatients`'
object-groupFields branch, its catch block's `auditLogger.logError`
call (success, N/A-fileName fallback, and swallowed-failure variants),
and its default-message fallback; `importSamples`' req.user
success/partial audit-log branches (previously never exercised at
all); `listSmartImportReports`/`getPatientsSmartImportMetadata`'s
default-message fallbacks; and `downloadSampleTemplateCSV`/
`downloadSampleTemplateExcel`'s id/description/name/N/A fallback chains
per collection, plus a sampleTypes-lookup-itself-throws case and a
default-message fallback. Remaining ~12% branch gap is a mix of
genuinely unreachable defensive code (e.g. importPatients' catch-block
`if (req.file)` cleanup, dead given the function's own early
`if (!file) return 400` guarantees req.file truthy by the time a later
throw can occur) and the same V8-coverage merge/instrumentation
artifact already flagged in `reports.routes.js`'s history below — manually
verified via a standalone Node script that
`downloadSampleTemplateExcel`'s db-id ternaries (lines ~1036-1038) *do*
resolve to the DB-provided ids at runtime even though istanbul reports
their true branch as 0-hit; not chased further),
`src/interface/routes/clinical-unit.routes.js` (was 79.76/63.15, isolated
run across its two test files now 96.42% lines / 92.1% branches — new
`tests/integration/clinical-unit.routes.gaps.test.js` alongside the
existing `clinical-unit.api.test.js`; covers `GET /`'s includeInactive
query branch, limit clamping, and 500-on-throw; `GET /search`'s empty-`q`
default, sub-3-char terms skipping `$text` search, the `$text` query's
own try/catch falling back to regex, the early-return when text matches
already fill the limit, the text+regex merge/de-dup path, and the outer
500; and `POST /`'s name-length/active-type validation 400s, the
existing-normalizedName short-circuit, the duplicate-key (11000) race
recovering via a fallback lookup vs. falling through to 500 when no
fallback record exists, a non-duplicate insertion 500, and the
`requirePermission('createPatient')` 403 gate. The three routes' own
`if (!db) return 503` checks (lines 33/55/131) remain uncovered — verified
genuinely unreachable, not a test gap: `authenticate` already 503s on a
falsy `req.app.locals.db` before any route handler runs, and every route
reads that same `app.locals.db`, so the route-level check can never see
a falsy value that the middleware didn't already catch),
`src/interface/routes/logs.routes.js` (was 81.81/61.19, isolated run now
100% lines / 91.04% branches — new `tests/integration/logs.routes.test.js`,
no pre-existing test file for this one; covers `requireAuditReader`'s
accessType-4/roleName-admin/accented-administrador/role-contains-auditor
allow branches plus the denied and missing-req.user cases, the 503 on
every route, `GET /`/`GET /all`/`POST /query`'s success and 500 paths
(`/all`'s default-limit-and-page-1 vs. explicit-limit branches), 
`POST /register`'s 201/400 (and that it isn't gated by
`requireAuditReader`), the CSV/XLSX export routes' header/escaping and
empty-logs-array-fallback branches, and `GET /:id`'s valid-ObjectId-hit,
invalid-ObjectId-falls-back-to-logId, valid-ObjectId-miss-falls-back-to-
logId, 404, and 500 paths),
`src/controllers/sensor.controller.js` (was 75.29/68.18, isolated run now
100% lines / 97.72% branches — new `tests/unit/controllers/sensor.controller.test.js`,
no pre-existing test file for this one; covers all five CRUD handlers'
503/404/error-catch paths and the `req.user`-gated audit-log branches;
found and filed issue #233 — `list()` throws a 500 instead of falling
back to `[]` when `listSensors` resolves `null`, since `result.sensors`
is dereferenced before the `Array.isArray` fallback runs; test asserts
the current buggy 500 response, not the intended fallback),
`src/models/User.js` (was 79.59/53.68, isolated run now 98.03% lines /
97.89% branches — existing `tests/unit/models/User.test.js` only
covered `validate()`/`isValidEmail()`/`isValidAccessType()`; added
`create()` full-field and defaults-applied cases, `getRoleName()`
known/unknown accessType, and `normalizeStatus()`/`translateStatus()`
pt↔en mapping plus their unknown/absent-status fallbacks),
`src/interface/routes/reports.routes.js` (was 76.83/65.75, isolated run
now 99.12% lines / 90.41% branches — `tests/integration/reports.routes.gaps.test.js`
alongside the existing `reports.api.test.js`; covers the 503/500 branch
on every route, `generate`'s 400 for a missing `reportType`, the
remaining `buildSampleQuery` sprec/quality-category filters and
NAIVE/WASHOUT/QUARANTINE/BLOCKED status normalization, the plain
`paciente`/`patient` preview branch (with/without keyword, orphaCode,
and non-empty `matchingPatientIds`), `resolveCollection`'s falsy-candidate
fallback (both the recover-on-second-candidate case and the
all-candidates-falsy 500), `buildDateQuery`'s single-bound cases,
`sampleanalysis`/`samplesbypatient`'s falsy-key skip in their grouping
reduces, `tissueoriginhistory`/`withdrawalhistory`'s default-query path,
and `normalizeReport`'s missing-reportID/missing-generatedAt fallbacks.
Two lines are genuinely unreachable via any legitimate route call, not a
test gap: the `/:type/filters` catch block (nothing in its try can
throw) and `module.exports`. The remaining ~10% of branches are
`typeIncludes`/`normalizeTypeValue`'s defensive `|| ''` fallback on
`type`/`rawType` — dead code, since Express guarantees a non-empty
`:type` segment on every one of these routes — plus what looks like a
V8-coverage merge artifact across the two spec files (a branch this
session's own tests demonstrably exercise, e.g. `GET /` with `db`
present, shows as uncovered only in the *combined* two-file run, not
when either file runs alone); flagged, not chased further.

## GOOD coverage (>=85% lines)

Not listed here (lower priority for slice-picking by a wide margin; a
full reconcile regenerates this if needed). Ask for a fresh
`--coverage --reporter=basic` run if you need this detail.

## Maintaining this file

If `test-loop` finds this file stale (a listed ZERO/LOW file turns out
already well-tested, or vice versa), fix the entry in the same commit —
don't just work around it. If the reconcile cadence above stops making
sense (too frequent/rare), update it and say why in the session's
wrap-up. Detailed per-slice writeups go in `COVERAGE_HISTORY.md`, never
back into this file.
