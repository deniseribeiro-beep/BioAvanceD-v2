# HANDOFF

**Written:** 2026-07-22, end of a test-loop iteration.
**Branch:** `test/mid-high-coverage-batch-1` (pushed, commit `8d7a4c75`).
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

- Extended `api/backend/tests/unit/database-mongo.test.js` (20 → 30
  tests, all passing): `connectDB`'s auth-retry-also-fails propagation
  path (lines 282-284), `connectNewDB`'s client/newDb reuse branch
  (line 308) and its full auth-failure retry cycle — success and
  double-failure (lines 340-373), and `closeConnection`'s error
  propagation when `client.close()` rejects (line 395).
- Isolated coverage on `src/database/mongo.js`: 80.10%/76.51% →
  88.14%/80.3% (lines/branches). Remaining uncovered lines are
  `encodeMongoURI`'s debug-flag-only logging branches (171-172,
  179-180, 185-186) — low-value padding for a debug flag, not pursued.
  Removed from `COVERAGE_NOTES.md`'s MID-HIGH bucket in the same
  commit.
- Also measured `src/workers/neo4jProjection.worker.js` (79.62/73.33)
  before picking mongo.js instead: its only remaining gap is the
  `require.main === module` CLI entry block (lines 82-99, SIGTERM/SIGINT
  handlers + worker start/stop) — same not-coverable-in-process pattern
  as `createFirstAdmin.js`'s CLI block. Recorded as an accepted gap in
  `COVERAGE_NOTES.md` rather than picked as a separate slice; skip it
  in future passes unless someone finds a subprocess-coverage approach.
- No bugs found; nothing filed.
- Mocking pattern: `mongo.js`'s existing test file already uses the
  `installFakeMongoClient()` + `require.cache` re-require pattern for
  the CJS `MongoClient` destructure — this slice's new tests followed
  the same fixture (`FakeClientInstance.connectBehavior` /
  `.prototype.close` overrides), no new mocking approach introduced.

## Recommended next slices

Still open in `COVERAGE_NOTES.md`'s MID-HIGH (70-84% lines) bucket, not
issue-tagged — worst-first by lines% (`patient.service.js` excluded from
a quick pick; it needs a fan-out, see its bucket note):

1. `src/interface/routes/analysis-file.routes.js` — 80.95 / 87.50
2. `src/interface/routes/master-data.routes.js` — 81.42 / 68.75
3. `src/config/redis.js` — 81.76 / 70.45
4. `src/interface/routes/equipment.routes.js` — 81.92 / 74.11
5. `src/controllers/import.controller.js` — 82.23 / 75.86
6. `src/services/security.service.js` — 82.51 / 72.26
7. `src/infrastructure/queue/Neo4jQuarantineService.js` — 83.33 / 82.75
8. `src/models/User.js` — 83.67 / 78.94 (reconcile's raw number)
9. `src/services/fhir-import-staging.service.js` — 84.15 / 77.86
10. `src/controllers/import-async.controller.js` — 84.29 / 79.66

Skip anything issue-tagged in that bucket: `mqtt-telemetry.service.js`
(#160), `result-worker.js` (#146/#164), `SampleGraphValidator.js` (#222).
Skip `neo4jProjection.worker.js` — remaining gap is an accepted,
not-coverable-in-process CLI entry block (see above).

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
