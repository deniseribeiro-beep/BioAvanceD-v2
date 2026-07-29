# HANDOFF

**Written:** 2026-07-29, a `work-issue` → `build-loop` session closing #304
(RF009 AC#6, real Neo4j `propagateCompromise`).

**Branch:** `test/e2e-real-backend-foundation`, now at `93800401`
(pushed, clean), 2 commits ahead of the prior handoff's `5c2fb60c`.

## What happened this session

1. Read the prior handoff — Wave 1 not fully closed, next step was #304
   first (RF009 real Neo4j `propagateCompromise` + full AC#6 e2e),
   depends on #303 (confirmed closed/landed).
2. Routed #304 through `work-issue` → `build-loop` (capability-doesn't-
   exist-yet shape — `propagateCompromise()` was a log-only stub).
3. Implemented `propagateCompromise()` in `TelemetryMonitor.js`: opens a
   Neo4j session (`this.database`, new field, same `NEO4J_DATABASE`
   convention as sibling services), matches the root `:Sample {id}`
   node plus every descendant reachable via `DERIVED_FROM` (root
   `<-[:DERIVED_FROM*0..]-` descendant — child points at parent per
   `neo4jCanonicalProjection.service.js`/`LineageRepository.js`), and
   sets `status='COMPROMISED'` plus freezer/breach metadata on all of
   them in one write. No-ops (skips the Neo4j call entirely) when
   `rootSampleId` is null.
4. Added 4 unit tests (`TelemetryMonitor.test.js`, replacing the old
   stub test) covering the real write, the database-scoped session, the
   session-closes-on-throw path, and the null-rootSampleId skip. 28/28
   unit tests pass.
5. Added a new test-support route,
   `/api/iot/telemetry-monitor/run-cycle-full` (same auth/NODE_ENV gate
   as the existing `run-cycle`/`find-critical-freezers` routes), that
   runs the *full* `runCycle()` (unlike `run-cycle`, which deliberately
   only calls `checkMissingReadings()`) — needed since this issue's
   e2e proof is exactly the `findCriticalFreezers` → `propagateCompromise`
   chain.
6. Added e2e fixtures: `seedSensorWithFreezerSample()` /
   `removeSeededFreezerSample()` (`tests/e2e/helpers/seedSensor.ts`) —
   seeds a real FREEZER→SHELF→RACK→StorageBox hierarchy plus a Sample
   doc so `resolveRootSamples()` resolves a real id (the existing
   `seedSensorWithPolicy()` fixture has no `storageContainer` link, so
   always resolves `[]`); and `seedSampleNode()` / `readSampleStatus()`
   / `removeSampleNodes()` (`tests/e2e/helpers/queryNeo4j.ts`) to seed
   bare `:Sample` graph nodes directly (not via the outbox projection
   pipeline — out of this issue's scope) and read back `.status`.
7. Added 2 e2e tests to `interop-monitoring.spec.ts` (new `#304`
   `describe` block): a sustained breach marks both root and a seeded
   descendant `COMPROMISED`; a too-short breach leaves the root
   untouched (`null` status). Ran the **full** `interop-monitoring.spec.ts`
   file against the real compose stack: **17/17 passing, no
   regressions** to the existing 15 (ingestion, EnvironmentalExcursion,
   missing-reading, #303 find-critical-freezers cases).
8. Docker Desktop was not running at session start — started it, waited
   for the engine, rebuilt `backend-app-test`/`worker-test`/
   `neo4j-projection-worker-test` (this issue's code changes), brought
   the full stack up, and ran the one-shot `admin-bootstrap-test`
   (no-op: users collection already non-empty from a prior session).
9. Committed on `test/rf009-propagate-compromise-304`, merged
   (`--no-ff`) into `test/e2e-real-backend-foundation`, deleted the
   slice branch, pushed. Closed #304 with the merge hash.
10. `wrap-up` audit: filed
    `deniseribeiro-beep/BioAvanceD-v2#319` — `.env.test.example`'s
    `TEST_SUPPORT_SECRET=vitest-test-support-secret` is stale/unused;
    `compose.test.yml`'s `x-test-env` anchor hardcodes a *different*
    literal (`e2e-test-support-secret`) directly, not a substitution, so
    a host process copying `.env.test.example`'s value gets 403s from
    the `/api/iot/telemetry-monitor/*` test-support routes. No other
    friction: scope stayed inside build-loop's normal pattern, no lazy
    fixes, no ambiguous sub-points closed without a live issue.

## Repo state

- `test/e2e-real-backend-foundation` at `93800401`, pushed, clean.
- **#304 closed** (RF009 AC#6, real Neo4j `propagateCompromise` —
  proven against the real compose stack).
- The real compose test stack is currently **running** on this machine
  (rebuilt this session with the `propagateCompromise`/`run-cycle-full`
  changes baked in) — not torn down; next session should
  `docker compose --env-file .env.test.example -f compose.test.yml down
  --volumes --remove-orphans` if it doesn't need it, or reuse it if
  continuing e2e work immediately.
- **#290, #291, #292, #307, #314, #313, #302, #285, #304** all closed.
- New this session: **`dyeallpies-skills-pack#146`** (from the prior
  handoff, still open — build-loop's BioAvanceD-v2 local-env gap) and
  **`deniseribeiro-beep/BioAvanceD-v2#319`** (this session's
  `TEST_SUPPORT_SECRET` drift finding).
- Carried forward untouched, still open: the possibly-undeleted remote
  `origin/fix/mongo-audit-repo-generate-movement-id`,
  `dyeallpies-skills-pack#141` (unassigned),
  `dyeallpies-skills-pack#144` (branch-deletion permission-classifier
  block). `test/close-environmental-excursion-301` (merged feature
  branch, still exists locally/remotely — safe to delete once confirmed
  no longer needed, not done this or prior sessions).
- **#295, #297** still open, per #318's checklist — code gaps (Study/
  Protocol/Collection linkage not modeled; sample quantity updates not
  atomic), likely `fix-bugs` shape. Not touched this session.
- **#115** still open, not actionable (Denise's decision already on
  record).
- **#293** still open, an implementation gap (no test-side TOTP
  generator), not a design call.
- **#228** open (coverage snapshot tracking issue, see
  `api/backend/COVERAGE_NOTES.md`).
- **#286, #283, #282, #284** untouched (frontend Docker flake, docs
  drift, CI Playwright wiring).
- Wave 1 of `E2E_TRACEABILITY_PLAN.md` remains fully closed. #318's
  integration-merge checklist now has **two** items left: #295, #297.

## Recommended next steps

**#318's gate still isn't clear — #295 and #297 are the only remaining
items before the integration merge onto
`feature/docker-e2e-backend-integration`.** Both are code gaps (not
missing tests), so route each through `work-issue` — likely `fix-bugs`
shape, but confirm against `docs/docs-7-27-2026/extracted/` per #318's
own checklist reasoning before assuming the fix shape. Once both close,
re-run `test:e2e:docker` against the merged tree per #318's definition
of done, then proceed with the integration merge (confirmed
fast-forward-clean as of the prior session — no divergent history to
reconcile, unless #295/#297's fixes touch files also changed upstream).

Also still outstanding from earlier handoffs: the real-backend e2e proof
for #314's `sensor-registration.spec.ts` fix has still not been re-run
against the real compose stack.

## Which skills to use

`work-issue` → `build-loop` is the right route for issues that name a
capability with existing test/unit scaffolding but no real-backend e2e
proof (#290/#291/#292/#304's shape) — Docker on by default, no opt-in
gate. #295/#297 are different: described as code gaps, not missing
proof, so check whether they're `fix-bugs` shape before defaulting to
`build-loop` again.
