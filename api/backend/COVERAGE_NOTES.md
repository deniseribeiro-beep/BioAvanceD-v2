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
MID-LOW both empty, the next slice-picking
tier is ZERO's one real-logic file (`worker.js`) or a MID-HIGH
(70-84%) file picked via a fresh isolated `--coverage` run — see "How to
use this when picking a slice" above.

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
