# HANDOFF

**Written:** 2026-07-22, end of a test-loop iteration.
**Branch:** `test/mid-high-coverage-batch-1` (pushed, commit `8e179896`).
**No issue was resolved this session** — one test-writing slice landed,
picked directly from `api/backend/COVERAGE_NOTES.md`'s MID-HIGH bucket.

## Repo state

- Working tree clean, `test/mid-high-coverage-batch-1` up to date with
  `origin/test/mid-high-coverage-batch-1`.
- `main` remains frozen — do not branch off it, merge into it, or push
  to it. `feature/docker-e2e-backend-integration` is the base for new
  branches; `test/mid-high-coverage-batch-1` is the active work branch
  for this coverage push.
- Nothing pending to merge/delete.

## This session's slice

- Added `api/backend/tests/unit/RegisterSampleUseCase.test.js` (41
  tests, all passing). `src/core/use-cases/RegisterSampleUseCase.js`
  had no dedicated unit test before — it was only incidentally
  exercised via `sample.routes.test.js`. Note: this file is easy to
  confuse with the similarly-named but unrelated `RegisterSample.js`
  (different constructor shape, its own suite `RegisterSample.test.js`)
  — don't assume one file's test file covers the other.
- Isolated coverage on that file moved from 77.33%/69.31%
  (lines/branches) to 100%/95.45%. `COVERAGE_NOTES.md`'s MID-HIGH
  bucket entry for it was removed in the same commit.
- No bugs found; nothing filed.

## Recommended next slices

Still open in `COVERAGE_NOTES.md`'s MID-HIGH (70-84% lines) bucket, not
already tagged to a design-call issue — pick from here first, sorted
worst-first by lines%:

1. `src/services/patient.service.js` — 74.39 / 63.56 (partial —
   createPatient/updatePatient error-path permutations remain)
2. `src/infrastructure/persistence/mongo/MongoAuditRepository.js` —
   76.66 / 84.61 (existing suite is already thorough; remaining gap
   looks like the Proxy's `defineProperty`/`deleteProperty` traps in
   `createIsolatedCollectionView`, plus `assertExpectedCollectionName`'s
   throw branch, which may be genuinely dead code given the single
   hardcoded call site — check before spending a slice chasing it)
3. `src/scripts/createFirstAdmin.js` — 77.27 / 65.00 (existing suite
   covers the core flow; missing-env-var permutations beyond the one
   tested, and the `shouldClose`/`closeConnection` finally-block path
   when no `options.db` is passed, look like the real gaps)
4. `src/workers/neo4jProjection.worker.js` — 79.62 / 73.33
5. `src/database/mongo.js` — 80.10 / 76.51
6. `src/services/merkle-envelope.service.js` — 80.30 / 66.21
7. `src/interface/routes/analysis-file.routes.js` — 80.95 / 87.50
8. `src/interface/routes/master-data.routes.js` — 81.42 / 68.75
9. `src/config/redis.js` — 81.76 / 70.45
10. `src/interface/routes/equipment.routes.js` — 81.92 / 74.11
11. `src/controllers/import.controller.js` — 82.23 / 75.86
12. `src/services/security.service.js` — 82.51 / 72.26
13. `src/infrastructure/queue/Neo4jQuarantineService.js` — 83.33 / 82.75
14. `src/models/User.js` — 83.67 / 78.94 (distinct from `User.test.js`'s
    already-covered figure — this is the reconcile's raw number)
15. `src/services/fhir-import-staging.service.js` — 84.15 / 77.86
16. `src/controllers/import-async.controller.js` — 84.29 / 79.66

Skip anything issue-tagged in that bucket: `mqtt-telemetry.service.js`
(#160), `result-worker.js` (#146/#164), `SampleGraphValidator.js` (#222).

Most of the files above (unlike this session's `RegisterSampleUseCase.js`)
already have an existing partial test file — **check the actual
`tests/unit`/`tests/integration` listing before assuming a slice needs a
brand-new file**; several of these are "extend the existing suite's
branch coverage," not "write from scratch."

**`parallel-test-agents` is a good fit if 2-4 of the files above are
picked at once** — they're independent (no shared state). Fan out as
`test-writer` leaf agents per that skill; `agent-delegation` is the
mandatory read first, regardless.

## Which skills to use

Same as last handoff: `bioavanced-v2-conventions` first, `test-loop` per
slice, `bioavanced-v2-testing-conventions` for mechanics, `wrap-up` every
iteration. No `fix-bugs`/`resolve-issue` work is available — nothing new
surfaced this session that needs a fix.

## Dependency notes

None queued.
