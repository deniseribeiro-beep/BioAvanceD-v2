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

**2026-07-09**, snapshot from commit `2848ab1f` on
`feature/docker-e2e-backend-integration` (`npx vitest run --coverage`,
full suite; `coverage/coverage-summary.json` read and re-derived from).

Statements 79.71% (14764/18521), Branches 69.34% (11566/16678), Functions
82.36% (1849/2245), **Lines 80.25%** (14228/17728) — **down** from the
prior reconcile's 88.13% lines (commit `aef22577`, 2026-07-05).

**This drop is not a real coverage regression — read before picking a
slice from the buckets below.** The same full-suite run backing this
reconcile also showed 92/264 test files (629/4692 tests) failing — see
issues #146-#164, filed the same session. Those failures are almost
entirely product code drifting out from under still-passing-shaped test
files (a `sampleId`->`specimenId`/`patientID`->`participantId` canonical
rename in #146, a handful of rewritten service APIs, etc.), not files
that were never tested. A failing/erroring test file contributes ~0
coverage for the source it targets even though a real test suite exists
for it — so several files below (`MoveSampleUseCase.js`,
`AllocateSampleUseCase.js`, `ReleaseSampleUseCase.js`,
`LineageRepository.js`, `Neo4jQuarantineService.js`, `fhir.service.js`,
`patient.service.js`, `PatientIdentityService.js`,
`daily-merkle.job.js`, `mqtt-telemetry.service.js`, `scheduler.service.js`,
`result-worker.js`) look like fresh coverage gaps but are actually
**already-tested files whose tests are currently broken**. Fixing the
filed issues first, then re-reconciling, will very likely restore most
of the 88.13% baseline without writing a single new test. Don't spend a
test-loop slice writing new tests for those specific files until their
linked issue is resolved and a fresh run confirms they're still low.

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

## ZERO coverage (0% lines) — 19 files, full reconcile 2026-07-09, commit `2848ab1f`

Real logic, but broken-by-issue — see caveat above, not a real gap:
- `src/services/scheduler.service.js` (issue #147 — cascading
  module-not-found from deleted `consentNeo4jSync.service`)
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

## LOW coverage (1-49% lines) — 14 files, full reconcile 2026-07-09, commit `2848ab1f`

Sorted ascending (worst first) — lines% / branches%. Most of these are
broken-by-issue, not genuinely untested — check the caveat above before
picking one for a slice.

```
src/services/auditRoot.service.js                6.95 / 0        (issue #146 cluster — audit/rename drift)
src/services/audit-tree.service.js               7.89 / 0        (issue #146 cluster)
src/services/PatientIdentityService.js          11.53 / 0        (issue #146 — matchOrUpsertPatient rename)
src/services/audit-signing.provider.js          14.81 / 0        (issue #146 cluster)
src/interface/routes/intakeWizard.routes.js     16.98 / 0        (issue #146 cluster)
src/core/use-cases/MoveSampleUseCase.js         18.18 / 14.49    (issue #146 — specimenId rename)
src/services/audit-tsa.service.js               21.42 / 0        (issue #146 cluster)
src/utils/sampleIDGenerator.js                  21.42 / 0        (issue #146 cluster)
src/core/use-cases/ReleaseSampleUseCase.js      22.91 / 13.51    (issue #146 — specimenId rename)
src/services/audit-witness.service.js           27.27 / 0        (issue #146 cluster)
src/controllers/fhir-import-staging.controller.js 30.23 / 41.17  (issue #146 cluster)
src/core/use-cases/AllocateSampleUseCase.js     31.91 / 12.5     (issue #146 — specimenId rename)
src/infrastructure/middleware/authConsent.js    34.24 / 55.1     (issue #146 cluster)
src/services/patientBiomarkerTimeseries.service.js 46.34 / 51.35 (issue #146 cluster)
```

Genuinely low (no matching filed issue found) — real slice candidates: none
currently listed (`label.routes.js` covered 2026-07-13, now >=85%).

## MID-LOW coverage (50-69% lines) — 20 files, full reconcile 2026-07-09, commit `2848ab1f`

Sorted ascending (worst first) — lines% / branches%. Same caveat: check
against #146-#164 before picking.

```
src/workers/jobs/daily-merkle.job.js            55.17 / 45       (issue #159 — stale test mock)
src/services/audit-v2.service.js                60.81 / 43.75   (issue #146/#152 cluster)
src/services/neo4jCanonicalProjection.service.js 65.00 / 63.36  (issue #146 cluster)
src/services/fhir.service.js                    66.66 / 27.27   (issue #149 — API shrunk)
src/workers/workers/result-worker.js            67.36 / 48      (issue #146/#164 — rename + yauzl)
src/infrastructure/database/neo4j/LineageRepository.js 67.69 / 58.33 (issue #146 — specimenId rename)
src/services/analysisValidation.service.js      68.08 / 53.84   (issue #146 cluster)
src/services/SampleGraphValidator.js            68.34 / 59.25   (issue #151 — collectionResolver)
src/services/import-lgpd.service.js             68.52 / 64.17   (issue #146 cluster)
src/services/mqtt-telemetry.service.js          68.60 / 78.18   (issue #160 — HMAC bypass bug)
src/services/patient.service.js                 69.14 / 50.72   (issue #146 cluster)
src/services/consent.validator.js               69.69 / 54.16   (issue #146 cluster)
```

Genuinely low (no matching filed issue found) — real slice candidates:
`neo4jProjection.worker.js`.
(`interface/routes/equipment.routes.js` covered 2026-07-13, now 100% lines,
moved to GOOD bucket.
`routes/intakeWizard.js` covered 2026-07-13, now 92.82% lines.
`neo4jOutbox.service.js` covered 2026-07-13, now 100% lines.
`utils/fieldEncryption.js` covered 2026-07-13, now 100% lines.
`rfc3161-adapter.service.js` covered 2026-07-13, now 100% lines.
`config/keyRegistry.js` covered 2026-07-13, now 100% lines.
`neo4jProjection.worker.js` covered 2026-07-13, now 85.1% lines (moved to
MID-HIGH bucket; remaining gap is the module-level connectDB/connectNeo4j
defaults and the require.main bootstrap block, not practically unit-testable).)

## MID-HIGH coverage (70-84% lines) — 44 files, full reconcile 2026-07-09, commit `2848ab1f`

Sorted ascending (worst first) — lines% / branches%. Not cross-checked
against filed issues line-by-line (MID-HIGH files are closer to "done"
regardless); a lower branch% relative to lines% usually means untested
error paths, a good tie-breaker when picking among these.

```
src/controllers/iot.controller.js                70.00 / 58.82
src/services/import.service.js                   70.36 / 64.55
src/core/use-cases/RegisterSampleUseCase.js       70.66 / 64.77
src/models/PatientConsent.js                      70.83 / 85.24
src/services/quality-compatibility.service.js     71.42 / 65.51
src/infrastructure/middleware/auth.js             71.66 / 68.18
src/core/use-cases/RegisterSample.js              71.95 / 54.76
src/controllers/upload.controller.js              73.17 / 53.84
src/services/hl7.service.js                       73.45 / 46.59
src/models/MeasurementUnit.js                     75.00 / 40.00
src/controllers/sensor.controller.js              75.29 / 68.18
src/infrastructure/persistence/mongo/MongoAuditRepository.js 76.66 / 84.61
src/interface/routes/terminologies.routes.js      76.66 / 51.50
src/interface/routes/reports.routes.js            76.83 / 65.75
src/controllers/analysis-type.controller.js       77.14 / 57.14
src/scripts/createFirstAdmin.js                   77.27 / 65.00
src/infrastructure/queue/Neo4jQuarantineService.js 77.77 / 75.86
src/interface/routes/sample.routes.js             78.09 / 37.90
src/utils/portManager.js                          78.48 / 62.85
src/models/User.js                                79.59 / 53.68
src/services/NotificationService.js               79.61 / 66.36
src/interface/routes/clinical-unit.routes.js      79.76 / 63.15
src/core/use-cases/GetSampleStorageLocationUseCase.js 80.00 / 50.00
src/models/AnalysisType.js                        80.00 / 75.00
src/reference-data/essential/manifest.js          80.00 / 0
src/database/mongo.js                             80.10 / 76.51
src/services/merkle-envelope.service.js           80.30 / 66.21
src/interface/routes/analysis-file.routes.js      80.95 / 87.50
src/interface/routes/result.routes.js             80.97 / 55.45
src/interface/routes/master-data.routes.js        81.42 / 68.75
src/config/redis.js                               81.76 / 70.45
src/interface/routes/logs.routes.js               81.81 / 61.19
src/services/audit-canonicalization.service.js    81.81 / 65.71
src/controllers/import.controller.js              82.23 / 75.86
src/services/security.service.js                  82.51 / 72.26
src/utils/auditLogger.js                          82.65 / 69.60
src/controllers/import-lgpd.controller.js         82.66 / 54.41
src/services/batch-validation-engine.service.js   83.52 / 80.39   (issue #162 — ReferenceError bug)
src/services/fhir-import-staging.service.js       84.15 / 77.11
src/controllers/sample-file.controller.js         84.23 / 53.93
src/controllers/import-async.controller.js        84.29 / 79.66
src/controllers/audit.controller.js               84.54 / 48.64   (issue #152 — contract changed)
src/services/sample.service.js                    84.54 / 72.83
src/routes/orphanet.js                            84.87 / 65.49
```

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
