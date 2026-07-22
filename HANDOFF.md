# HANDOFF

**Written:** 2026-07-22, end of a test-loop iteration.
**Branch:** `test/mid-high-coverage-batch-1` (pushed, commit `5187ec12`).
**No issue was resolved this session** — one test-writing slice landed,
picked from `api/backend/COVERAGE_NOTES.md`'s MID-HIGH bucket. Filed
issue #236 (dead/unreachable db-check code in analysis-file.routes.js's
`/validate` handler, superseded by an identical check in the
`authenticate` middleware) — not fixed, per test-loop's no-product-code
rule.

## Repo state

- Working tree clean; `test/mid-high-coverage-batch-1` up to date with
  origin. Nothing pending to merge/delete.
- `main` remains frozen — do not branch off it, merge into it, or push
  to it. `feature/docker-e2e-backend-integration` is the base for new
  branches; `test/mid-high-coverage-batch-1` is the active work branch
  for this coverage push.

## This session's slice

- Extended `api/backend/tests/integration/analysis-file.api.test.js`
  (4 → 6 tests, all passing): added `GET /validate/:sampleIdentifier`
  cases for db-not-available (503) and validation-service-throws (500).
- Isolated coverage on `src/interface/routes/analysis-file.routes.js`:
  80.95%/87.50% → 90.47%/87.50% (lines/branches) — clears the GOOD
  (>=85%) threshold, so the entry was removed from `COVERAGE_NOTES.md`'s
  MID-HIGH bucket (23 → 22 files) in the same commit. The route's own
  db-not-available guard (line 16) stays structurally uncovered — see
  filed issue below; the `/upload` route (line 54) is intentionally
  untested here since it's covered by `upload.controller.test.js`.
- **Bug/gap found and filed:** issue #236 — the route's own
  `if (!db)` 503 guard in the `/validate` handler is unreachable, since
  `authenticate` middleware performs the identical check first for this
  route and returns 503 before the handler runs. Not fixed (test-only
  loop); owner's call whether to remove it or accept it as defensive
  dead code.

## Recommended next slices

Still open in `COVERAGE_NOTES.md`'s MID-HIGH (70-84% lines) bucket, not
issue-tagged — worst-first by lines% (`patient.service.js` excluded from
a quick pick; it needs a fan-out, see its bucket note):

1. `src/interface/routes/master-data.routes.js` — 81.42 / 68.75
2. `src/config/redis.js` — 81.76 / 70.45
3. `src/interface/routes/equipment.routes.js` — 81.92 / 74.11
4. `src/controllers/import.controller.js` — 82.23 / 75.86
5. `src/services/security.service.js` — 82.51 / 72.26
6. `src/infrastructure/queue/Neo4jQuarantineService.js` — 83.33 / 82.75
7. `src/models/User.js` — 83.67 / 78.94 (reconcile's raw number)
8. `src/services/fhir-import-staging.service.js` — 84.15 / 77.86
9. `src/controllers/import-async.controller.js` — 84.29 / 79.66

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
