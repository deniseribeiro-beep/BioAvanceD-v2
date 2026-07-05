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

**2026-07-05**, snapshot from commit `aef22577` (user-run
`npx vitest run --coverage --reporter=basic`, full suite; only
`coverage/coverage-summary.json` was read and re-derived from, exit
status not independently captured this reconcile).

Statements 87.61%, Branches 78.51%, Functions 88.83%, **Lines 88.13%**
(15275/17331) — up from the prior reconcile's 81.63% lines (commit
`393edf91`). The jump reflects the full run of slices landed between the
two reconciles (see `COVERAGE_HISTORY.md` for the per-slice list,
including the `patient.service.js` `createPatient`/`updatePatient` slice
and issue #90). ZERO bucket is unchanged (20 files, none touched). LOW
and MID-LOW are both now confirmed **empty** — every previously-tracked
MID-LOW file has moved to MID-HIGH/GOOD or higher.

## How to use this when picking a slice

1. With ZERO the only non-empty bucket now, prefer its one real-logic
   file (`worker.js`) over the models/interfaces/scripts also listed
   there — bigger jump per slice, and those low-priority entries are
   thin/non-request-path by design (see note below).
2. Skip `src/scripts/*` (one-off migration/seed scripts, not exercised in
   prod request paths) and `src/core/application/ports/*` (interfaces,
   zero logic) unless a slice specifically needs them — low value.
3. With LOW/MID-LOW empty, the next tier for a slice with a meaningful
   jump is picking a MID-HIGH (70-84%) file via a fresh isolated run —
   this file doesn't track individual MID-HIGH files (see that section
   below), so ask for a quick `--coverage` run scoped to a candidate
   file/directory if you want a specific number before committing to it.
4. After landing a slice, delete the file's line from whichever bucket it
   was in (or move it, if now partial). Don't leave stale entries. Add a
   short entry to `COVERAGE_HISTORY.md` for what the slice covered/found
   — not here.

## ZERO coverage (0% lines) — 20 files, re-measured 2026-07-05

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

## LOW coverage (1-49% lines) — confirmed empty, full reconcile 2026-07-05, commit `aef22577`

**Empty.** No file below 50% lines across the whole suite.

## MID-LOW coverage (50-69% lines) — confirmed empty, full reconcile 2026-07-05, commit `aef22577`

**Empty.** `patient.service.js` was the last file in this bucket (see
`COVERAGE_HISTORY.md` for its slice); the full-suite reconcile confirms
no other file has since dropped into this range either. With LOW and
MID-LOW both empty, the next slice-picking tier is ZERO's one
real-logic file (`worker.js`) or a MID-HIGH file below.

## MID-HIGH coverage (70-84% lines) — 36 files, full reconcile 2026-07-05, commit `aef22577`

Sorted ascending (worst first) — lines% / branches%. The next tier up
once ZERO's `worker.js` is done; a lower branch% relative to lines%
usually means untested error paths, a good tie-breaker when picking
among these.

```
src/models/PatientConsent.js                                70.83 / 85.24
src/interface/routes/equipment.routes.js                     70.93 / 61.05
src/utils/fieldEncryption.js                                 71.42 / 69.56
src/infrastructure/middleware/auth.js                         71.66 / 67.44
src/interface/routes/reports.routes.js                       71.84 / 58.21
src/interface/routes/cid.routes.js                            72.09 / 46.47
src/services/auditRoot.service.js                             73.33 / 54.54
src/services/hl7.service.js                                   73.45 / 46.85
src/services/patient.service.js                                74.15 / 59.95
src/models/MeasurementUnit.js                                  75.00 / 40.00
src/controllers/sensor.controller.js                           75.29 / 68.18
src/services/mqtt-telemetry.service.js                         75.94 / 79.61
src/interface/routes/terminologies.routes.js                   76.12 / 51.09
src/services/SampleGraphValidator.js                           76.25 / 66.04
src/controllers/analysis-type.controller.js                    77.14 / 57.14
src/core/use-cases/RegisterSampleUseCase.js                    77.33 / 69.31
src/interface/routes/assistant.routes.js                       78.64 / 63.76
src/database/mongo.js                                          79.22 / 76.00
src/models/User.js                                             79.59 / 53.68
src/interface/routes/clinical-unit.routes.js                   79.76 / 63.15
src/models/AnalysisType.js                                     80.00 / 75.00
src/controllers/iot.controller.js                              80.88 / 66.66
src/interface/routes/analysis-file.routes.js                   80.95 / 87.50
src/interface/routes/result.routes.js                          80.97 / 54.54
src/interface/routes/master-data.routes.js                     81.42 / 68.75
src/models/SampleMovement.js                                   81.57 / 82.71
src/interface/routes/logs.routes.js                            81.63 / 61.53
src/services/security.service.js                               82.51 / 72.26
src/utils/collectionResolver.js                                82.69 / 78.94
src/config/redis.js                                            83.01 / 72.72
src/infrastructure/queue/Neo4jQuarantineService.js             83.33 / 82.75
src/controllers/import-lgpd.controller.js                      83.64 / 57.26
src/utils/auditLogger.js                                       83.67 / 70.87
src/controllers/import.controller.js                           83.85 / 75.25
src/controllers/import-async.controller.js                     84.29 / 79.66
src/config/queue.js                                            84.50 / 50.00
```

Note: `patient.service.js` already has substantial partial coverage from
the 2026-07-05 slice (see `COVERAGE_HISTORY.md`) — its remaining gap is
`getPatient`/`listPatients`/`searchPatients`'s FHIR-first branches and
`validateConsentToken`/`acceptConsentToken`/`resendConsentNotification`.

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
