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

**2026-07-04**, snapshot from commit `4a708d8c` (user-run
`npx vitest run --coverage --reporter=basic`, full suite; only
`coverage/coverage-summary.json` was read and re-derived from, exit
status not independently captured this reconcile).

Statements 74.14%, Branches 66.55%, Functions 79.31%, **Lines 74.62%**
(12934/17331) — up from the prior reconcile's 65.73% lines (commit
`1ac77354`, 2026-07-03). See `COVERAGE_HISTORY.md` for what happened
between the two reconciles (slices 21-33) and the issues each one filed.

## How to use this when picking a slice

1. Prefer a **ZERO** file with real logic (not a script/model/port
   interface) over a **LOW** file — bigger jump per slice.
2. Skip `src/scripts/*` (one-off migration/seed scripts, not exercised in
   prod request paths) and `src/core/application/ports/*` (interfaces,
   zero logic) unless a slice specifically needs them — low value.
3. After landing a slice, delete the file's line from whichever bucket it
   was in (or move it, if now partial). Don't leave stale entries. Add a
   short entry to `COVERAGE_HISTORY.md` for what the slice covered/found
   — not here.

## ZERO coverage (0% lines) — 20 files, re-measured 2026-07-04

Real logic, worth prioritizing:
- `src/workers/worker.js` (self-executing bootstrap entrypoint — calls
  `startWorker()`/`process.exit` at module load; disproportionately
  expensive to test honestly, lower priority than it looks)

Low priority (models/interfaces/one-off scripts — thin or non-request-path):
- `src/core/application/ports/IAuditRepository.js`
- `src/core/application/ports/ILineageRepository.js`
- `src/core/application/ports/IPatientConsentReadRepository.js`
- `src/core/application/ports/IStorageRepository.js`
- `src/core/application/ports/IStorageTopologyReadRepository.js`
- `src/models/Cid.js`
- `src/models/ClinicalRecord.js`
- `src/models/Disease.js`
- `src/models/DrugDictionary.js`
- `src/models/Equipment.schema.js`
- `src/models/StoragePath.js`
- `src/models/TemperaturePolicy.schema.js`
- `src/models/Withdrawal.js`
- `src/scripts/migrate-rcs-governance-indexes.js`
- `src/scripts/migrateUserAnonIds.js`
- `src/scripts/seed-admin.js`
- `src/scripts/seedDiseaseValidationRules.js`
- `src/scripts/seedOrphanetCid.js`
- `src/scripts/seeder.js`

## LOW coverage (1-49% lines) — re-measured 2026-07-04, commit `4a708d8c`

Sorted ascending (worst first), all 32 files under 50% lines this
reconcile (list re-derived from a real `coverage/coverage-summary.json`
run, not hand-maintained):

```
```

The LOW bucket is currently empty — every previously-listed file is now
above 50% lines. Next session should run a fresh
`npx vitest run --coverage --reporter=basic` reconcile to regenerate
this table from real numbers rather than continuing to pick from a
stale/empty list.

Note: this table only lists files still under 50% lines as of the
2026-07-04 reconcile — many previously-listed files (storageService.js,
hl7.service.js, patient.service.js, miabisValidator.service.js,
sampleComplianceSync.service.js, DrugService.js, logs.routes.js,
equipment.routes.js, location.routes.js, orphanet.js,
terminologies.routes.js) moved above 49% since the last reconcile and
have been dropped from this table — see `COVERAGE_HISTORY.md` for what
covered them. `src/config/uploadConfig.js` also moved above 49% this
session (fileFilter/storage.getFilename/storage.getDestination covered).
`src/interface/routes/reports.routes.js` moved from 30.2% to 71.84%
lines this session (buildPreviewData's report-type branches now
covered; see COVERAGE_HISTORY.md). `src/models/StorageContainer.js`
moved from 32.69% to 100% lines this session (pre-save hierarchy hook
+ getFullPath/getChildren now covered; see COVERAGE_HISTORY.md).
`src/interface/routes/sample.routes.js` moved from 33.33% to 45.15%
lines this session (POST / payload validation + create error-mapping
branches, GET /:id/label, GET /search/by-term, GET /by-barcode/:barcode,
GET /:id/movements now covered; see COVERAGE_HISTORY.md).
`src/models/StorageBox.js` moved from 41.74% to 98.05% lines this
session (pre-save hook, addSample/removeSample/getAvailablePositions/
getStats instance methods, and the `validate` static now covered; see
COVERAGE_HISTORY.md). `src/services/import-lgpd.service.js` moved from
43.05% to 55.55% lines this session (`readCSV`/`readExcel` now covered
with real temp-file fixtures; `importSamples`/`importPatientsSmart`
DB-backed paths still untested — see COVERAGE_HISTORY.md).
`src/services/import.service.js` moved from 44.04% to 61.91% lines this
session (`importLocations` JSON/CSV paths and `importTemperature` now
covered; `importPatients`/`importSamples` still untested — see
COVERAGE_HISTORY.md; a real counting bug found in `importTemperature`
was filed as issue #79, not fixed inline).
`src/services/batch-validation-engine.service.js` moved from 45.76% to
88.7% lines this session (buildSampleRow, classifyPatientRow/
classifySampleRow, buildPatientLinkageQuery, buildBiomarkerObservation
Payloads, detectDataType filename fallback, persistPatient/persistSample
validation/success/error branches, readJsonRows/detectCsvSeparator/
readCsvRows/readRowsFromFile, and processBatchImport's end-to-end
chunking/progress/status-transition loop now covered; only readXlsxRows
and a couple of catch-branches remain — see COVERAGE_HISTORY.md).
`src/database/neo4j.js` moved from 40% to 100% lines this session (the
env-var-driven URI/username/password construction, default fallback,
and singleton memoization all covered via the require.cache-injection
mechanic from `neo4j-connection.test.js`; see COVERAGE_HISTORY.md).
`src/controllers/audit.controller.js` moved from 47.56% to 100% lines
this session (all 8 handlers' 503-db-unavailable/success/500-catch
branches covered; see COVERAGE_HISTORY.md).
`src/routes/eConsent.js` moved from 47.88% to 91.54% lines this session
(the remaining uncovered lines are the module-load CONSENT_SECRET guard
and two happy paths that are unreachable due to real bugs found and
filed — issues #80 and #81 — see COVERAGE_HISTORY.md).
`src/controllers/import-lgpd.controller.js` moved from 48.74% to 83.64%
lines this session (all three template-download handlers —
`downloadPatientTemplateExcel`/`downloadSampleTemplateCSV`/
`downloadSampleTemplateExcel` — now covered, including their db-present/
db-absent/db-throws branches and 500-catch paths; see
COVERAGE_HISTORY.md).

## MID coverage (50-84% lines) — GOOD (>=85%)

Not listed here (lower priority for slice-picking; a full reconcile
regenerates these buckets if needed). Ask for a fresh
`--coverage --reporter=basic` run if you need this detail.

## Maintaining this file

If `test-loop` finds this file stale (a listed ZERO/LOW file turns out
already well-tested, or vice versa), fix the entry in the same commit —
don't just work around it. If the reconcile cadence above stops making
sense (too frequent/rare), update it and say why in the session's
wrap-up. Detailed per-slice writeups go in `COVERAGE_HISTORY.md`, never
back into this file.
