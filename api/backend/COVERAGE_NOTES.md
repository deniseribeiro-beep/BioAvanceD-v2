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

**2026-07-04**, snapshot from commit `393edf91` (user-run
`npx vitest run --coverage --reporter=basic`, full suite; only
`coverage/coverage-summary.json` was read and re-derived from, exit
status not independently captured this reconcile).

Statements 81.2%, Branches 72.43%, Functions 85.35%, **Lines 81.63%**
(14148/17331) — up from the prior reconcile's 79.3% lines (commit
`7826467c`). The jump comes from the slices between the two reconciles:
`equipment-sensor-quarantine.service.js`, `sample.routes.js`,
`MongoStorageRepository.js`, `cid.routes.js`,
`sample-file.controller.js`, `intakeWizard.js`, `policy.routes.js`, and
a partial slice on `patient.service.js` — see `COVERAGE_HISTORY.md` for
what each covered and any issues filed. ZERO bucket is unchanged (20
files, none touched this round) and LOW is still empty.

## How to use this when picking a slice

1. Prefer a **ZERO** file with real logic (not a script/model/port
   interface) over a **LOW** or **MID-LOW** file — bigger jump per slice.
   With LOW currently empty, MID-LOW is the next-best fallback tier.
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

## LOW coverage (1-49% lines) — re-measured 2026-07-04, commit `393edf91`

**Empty**, confirmed again at this reconcile — no file dropped below
50% lines. Next slice should either work through the ZERO bucket above
(real-logic file first: `worker.js`) or pick from the MID-LOW bucket
just below for a smaller, incremental gain.

## MID-LOW coverage (50-69% lines) — re-measured 2026-07-04, commit `393edf91`

Sorted ascending (worst first), 26 files — the next tier up once the
ZERO bucket's real-logic file (`worker.js`) is done. Re-derived from
`coverage/coverage-summary.json`, not hand-maintained.

```
src/services/patient.service.js                                       57.2%
src/services/import-lgpd.service.js                                   67.28%
src/infrastructure/queue/TopologicalQuarantine.js                     68.08%
src/routes/orphanet-count.js                                          68.42%
src/controllers/sample-file.controller.js                            68.87%
src/controllers/import-batch.controller.js                            69.49%
src/services/log.service.js                                           69.84%
```

`patient.service.js` at 57.2% lines (isolated run across its own +
related test files, 2026-07-05) — `resolveClinicalUnitSnapshot`,
`checkIdentifierConflict`, `checkDuplicatePatient`,
`syncPatientPhoneToGraph`, and `applyDeceasedRepresentativeRules`
branches now covered; the number barely moved from 56.35% because the
remaining gap is concentrated in the large `createPatient`/
`updatePatient` bodies (multi-branch, DB/notification/FHIR/neo4j/
biomarker side effects) rather than the smaller helper methods just
closed — see `COVERAGE_HISTORY.md`. `sample-file.controller.js`
confirmed at 68.87%, matching the isolated-run estimate from its own
slice.

Note: several of these (`import-lgpd.service.js`, `import.service.js`,
`patient.service.js`, `Patient.js`, `Sample.js`) already have partial
coverage from earlier slices — see `COVERAGE_HISTORY.md` for what's
already covered before picking one, so a slice doesn't re-cover the
same ground.

`paciente.controller.js` moved out of this bucket 2026-07-05 (isolated
run: 94.38% lines) — see `COVERAGE_HISTORY.md`.

`dictionary.js` moved out of this bucket 2026-07-05 (isolated run:
96.57% lines) — see `COVERAGE_HISTORY.md`.

`backup.routes.js` moved out of this bucket 2026-07-05 (isolated run:
98.07% lines) — see `COVERAGE_HISTORY.md`.

`fhir-sync.service.js` moved out of this bucket 2026-07-05 (isolated run:
99.52% lines) — see `COVERAGE_HISTORY.md`.

`sensor.service.js` moved out of this bucket 2026-07-05 (isolated run:
100% lines, 87.03% branches) — see `COVERAGE_HISTORY.md`.

`Session.js` moved out of this bucket 2026-07-05 (isolated run: 100%
lines/branches/functions/statements) — see `COVERAGE_HISTORY.md`.

`i18n/index.js` moved out of this bucket 2026-07-05 (isolated run: 100%
lines/statements/functions, 86.15% branches) — see `COVERAGE_HISTORY.md`.

`import.service.js` moved out of this bucket 2026-07-05 (isolated run:
88.86% lines, now MID-HIGH) — `importPatients` and `importSamples`
covered; remaining gaps are `importLocations`/`importTemperature`
require() dynamic-import lines and a few defensive branches — see
`COVERAGE_HISTORY.md`.

`mqtt-signature.service.js` moved out of this bucket 2026-07-05 (isolated
run: 100% lines/branches/functions/statements) — see `COVERAGE_HISTORY.md`.

`patientAnonymization.js` moved out of this bucket 2026-07-05 (isolated
run: 100% lines/statements/functions, 95% branches) — see
`COVERAGE_HISTORY.md`.

`biomarker-observation.service.js` moved out of this bucket 2026-07-05
(isolated run: 98.61% lines, 93.33% branches) — see `COVERAGE_HISTORY.md`.

`mqtt-telemetry.service.js` moved out of this bucket 2026-07-05 (isolated
run: 75.94% lines, 79.61% branches, now MID-HIGH) — `stop()` now covered;
the remaining gap (`start()`'s real `mqtt.connect(...)` call and its
handlers) is not honestly mockable, see `COVERAGE_HISTORY.md`.

`ConsentPolicy.js` moved out of this bucket 2026-07-05 (isolated run:
100% lines/branches/functions/statements) — see `COVERAGE_HISTORY.md`.

`Sample.js` moved out of this bucket 2026-07-05 (isolated run: 98.3%
lines, 93.65% branches) — see `COVERAGE_HISTORY.md`.

`user-security.service.js` moved out of this bucket 2026-07-05 (isolated
run: 91.02% lines, 76.85% branches, now MID-HIGH) — see
`COVERAGE_HISTORY.md`.

`logSerializer.js` moved out of this bucket 2026-07-05 (isolated run:
97.87% lines, 89.43% branches) — see `COVERAGE_HISTORY.md`.

`ListOperationalFreezersUseCase.js` moved out of this bucket 2026-07-05
(isolated run: 100% lines/branches/functions/statements) — see
`COVERAGE_HISTORY.md`.

`Patient.js` moved out of this bucket 2026-07-05 (isolated run: 98.66%
lines, 97.13% branches) — see `COVERAGE_HISTORY.md`.

`ConsentTemplate.js` moved out of this bucket 2026-07-05 (isolated run:
100% lines/branches/functions/statements) — see `COVERAGE_HISTORY.md`.

## MID-HIGH coverage (70-84% lines) — GOOD (>=85%)

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
