# HANDOFF

**Written:** 2026-07-22, end of a test-loop iteration.
**Branch:** `test/mid-high-coverage-batch-1` (pushed, commit `1d95a6ff`).
**No issue was resolved this session** — one test-writing slice landed,
picked from `api/backend/COVERAGE_NOTES.md`'s MID-HIGH bucket.

## Repo state

- Working tree clean; `test/mid-high-coverage-batch-1` up to date with
  origin. Nothing pending to merge/delete.
- `main` remains frozen — do not branch off it, merge into it, or push
  to it. `feature/docker-e2e-backend-integration` is the base for new
  branches; `test/mid-high-coverage-batch-1` is the active work branch
  for this coverage push.

## This session's slice

- Extended `api/backend/tests/unit/createFirstAdmin.script.test.js`
  (4 → 12 tests, all passing): `requireBootstrapEnv` missing-env
  permutations (all-missing message, whitespace-only value) and
  normalization (trim, email lowercase, password preserved verbatim),
  weak-password rejection before any DB access, and the no-`options.db`
  path — `connectDB` fallback plus `closeConnection` in the `finally`
  on both success and error, via require-cache re-require against
  patched `mongo` exports (source destructures at module scope; see
  `cjs-mocking.md`'s destructure gotcha).
- Isolated coverage on `src/scripts/createFirstAdmin.js`:
  77.27%/65% → 90.9%/75% (lines/branches). Remaining lines 108-112 are
  the `require.main` CLI entry block — not coverable in-process
  (subprocess coverage isn't collected); accepted gap, recorded in the
  commit message. Removed from `COVERAGE_NOTES.md`'s MID-HIGH bucket in
  the same commit.
- No bugs found; nothing filed.
- Loader-style note: the existing test file loads sources via bare
  `require` (works under this vitest setup). The slice **extended that
  file** rather than adding a `.gaps` file with `createRequire`, to
  avoid the mixed-loader coverage under-report trap
  (`cjs-mocking.md`, `sensor.service.js` incident). If a future slice
  adds a second test file for a source, match the existing file's
  loading style first.

## Recommended next slices

Still open in `COVERAGE_NOTES.md`'s MID-HIGH (70-84% lines) bucket, not
issue-tagged — worst-first by lines% (`patient.service.js` excluded from
a quick pick; it needs a fan-out, see its bucket note):

1. `src/workers/neo4jProjection.worker.js` — 79.62 / 73.33
2. `src/database/mongo.js` — 80.10 / 76.51
3. `src/interface/routes/analysis-file.routes.js` — 80.95 / 87.50
4. `src/interface/routes/master-data.routes.js` — 81.42 / 68.75
5. `src/config/redis.js` — 81.76 / 70.45
6. `src/interface/routes/equipment.routes.js` — 81.92 / 74.11
7. `src/controllers/import.controller.js` — 82.23 / 75.86
8. `src/services/security.service.js` — 82.51 / 72.26
9. `src/infrastructure/queue/Neo4jQuarantineService.js` — 83.33 / 82.75
10. `src/models/User.js` — 83.67 / 78.94 (reconcile's raw number)
11. `src/services/fhir-import-staging.service.js` — 84.15 / 77.86
12. `src/controllers/import-async.controller.js` — 84.29 / 79.66

Skip anything issue-tagged in that bucket: `mqtt-telemetry.service.js`
(#160), `result-worker.js` (#146/#164), `SampleGraphValidator.js` (#222).

**Before picking any of the above, measure isolated coverage first**
(`npx vitest run <existing test files> --coverage
--coverage.include='<source path>'`) — the reconcile percentage is
reliable, the prose guess at *why* isn't always. Route tests land at
`tests/integration/<name>.api.test.js` — list the actual directory, and
check the existing file's loader style before adding a sibling file.

## Which skills to use

Same as last handoff: `bioavanced-v2-conventions` first, `test-loop` per
slice, `bioavanced-v2-testing-conventions` for mechanics (plus its
`references/cjs-mocking.md` before any mocking), `wrap-up` every
iteration.

## Dependency notes

None queued.
