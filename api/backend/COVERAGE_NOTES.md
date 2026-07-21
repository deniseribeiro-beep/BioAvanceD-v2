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
src/services/patient.service.js                  70.64 / 60.63
src/models/PatientConsent.js                      70.83 / 85.24
src/services/mqtt-telemetry.service.js            71.42 / 78.09   (issue #160 — HMAC bypass bug)
src/infrastructure/middleware/auth.js             71.66 / 68.18
src/services/hl7.service.js                       100.0 / 81.81  (covered — see history archive)
src/controllers/iot.controller.js                 79.76 / 73.52  (branches covered — see history archive; applyColdChainQuarantine catch + a couple of resolveTemperaturePolicy edge branches remain)
src/controllers/sensor.controller.js              75.29 / 68.18
src/utils/fieldEncryption.js                      76.19 / 69.56
src/infrastructure/persistence/mongo/MongoAuditRepository.js 76.66 / 84.61
src/workers/workers/result-worker.js              76.66 / 66.07   (issue #146/#164 — rename + yauzl)
src/interface/routes/reports.routes.js            76.83 / 65.75
src/controllers/analysis-type.controller.js       77.14 / 57.14
src/scripts/createFirstAdmin.js                   77.27 / 65.00
src/core/use-cases/RegisterSampleUseCase.js       77.33 / 69.31
src/services/SampleGraphValidator.js              77.69 / 66.66   (issue #222 — legacy-schema migration, design fork)
src/utils/portManager.js                          78.48 / 62.85
src/models/User.js                                79.59 / 53.68
src/workers/neo4jProjection.worker.js             79.62 / 73.33
src/interface/routes/clinical-unit.routes.js      79.76 / 63.15
src/models/AnalysisType.js                        80.00 / 75.00
src/reference-data/essential/manifest.js          80.00 / 0
src/database/mongo.js                             80.10 / 76.51
src/services/merkle-envelope.service.js           80.30 / 66.21
src/interface/routes/analysis-file.routes.js      80.95 / 87.50
src/interface/routes/master-data.routes.js        81.42 / 68.75
src/config/redis.js                               81.76 / 70.45
src/interface/routes/logs.routes.js               81.81 / 61.19
src/interface/routes/equipment.routes.js          81.92 / 74.11
src/utils/auditLogger.js                          82.00 / 67.96
src/controllers/import.controller.js              82.23 / 75.86
src/services/security.service.js                  82.51 / 72.26
src/controllers/import-lgpd.controller.js         82.66 / 54.41
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
`COVERAGE_HISTORY.md`).

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
