# HANDOFF

**Written:** 2026-07-28, end of a `work-issue` → `fix-bugs` session —
closed #305 (Neo4j reconnect retry-storm).

**Branch:** `test/e2e-real-backend-foundation`, pushed to
`origin/test/e2e-real-backend-foundation` this session (f0a1ce5f).

## What happened this session

1. Routed #305 (filed by the prior #299 session) through `work-issue` →
   `fix-bugs`. Confirmed it was a genuine, reproducible bug (not a
   design fork): `connectNeo4j()`
   (`api/backend/src/infrastructure/database/neo4j/connection.js`)
   cleared `connectingPromise` on failure but kept no memory of the
   failure itself, so every caller (TelemetryMonitor's cron tick, the
   quarantine worker's `getLineageRepository`, request-time lineage
   lookups) independently re-paid the full ~60s exponential-backoff
   retry chain whenever Neo4j stayed down.
2. Reproduced with a new test first (`neo4j-connection.test.js`, "fails
   fast without retrying while a prior failure is within the cooldown
   window (#305)") — it failed against pre-fix code (a second call
   during the cooldown window silently succeeded / retried instead of
   rejecting fast), confirming the bug before touching product code.
3. Fixed: added a `lastFailureAt` timestamp and a new
   `NEO4J_CONNECT_FAILURE_COOLDOWN_MS` env var (default 30000ms,
   `api/backend/src/config/env.js`). A `connectNeo4j()` call made while
   a prior failure is still within the cooldown now throws immediately
   instead of re-running the retry/backoff loop; a successful connection
   clears `lastFailureAt`.
4. Un-weakened the existing "subsequent call must retry from scratch"
   test by pinning its cooldown to `0` (so its original intent —
   immediate retry with no failure history — still holds), rather than
   changing what it asserts.
5. All 11 tests in `neo4j-connection.test.js` pass on the merged tree
   (native, no Docker). Also spot-checked `neo4jProjection.worker.test.js`
   and `testEnvironment.script.test.js` (both touch Neo4j-adjacent code)
   — 31/31 passing.
6. Branched `fix/neo4j-connect-failure-cooldown` off
   `test/e2e-real-backend-foundation`, committed (`Fixes #305`), pushed,
   commented the commit hash on the issue, merged `--no-ff` into
   `test/e2e-real-backend-foundation` (f0a1ce5f), re-verified on the
   merged tree, pushed, deleted the fix branch (local + remote), closed
   #305.

## Repo state

- Working tree clean, `test/e2e-real-backend-foundation` is pushed and
  up to date with `origin/test/e2e-real-backend-foundation` at f0a1ce5f.
- `fix/neo4j-connect-failure-cooldown` was deleted both locally and on
  origin after the merge landed.
- No Docker stack was brought up this session (fix verified natively;
  #303/#304, which actually exercise real Neo4j calls, are the next
  ones that will need it).
- `test/migrate-rcs-governance-indexes-coverage` still carries the
  unmerged coverage work from issue #285 (untouched, not in scope).
- The remote branch `origin/fix/mongo-audit-repo-generate-movement-id`
  (from the #296 session) may still be undeleted — not touched this
  session, carried forward from prior handoffs.

## Recommended next steps

None queued explicitly by Dennis this session. Open and unpicked, in
rough dependency order: **#306** (`getCollection()` async-footgun) is
the other small, well-scoped bug fix from the #299 session, no design
ambiguity. **#303** (real `findCriticalFreezers`) is the next RF009
build slice — now unblocked from the Neo4j retry-storm angle since #305
is fixed, though the underlying `neo4j-test` container's "Graph not
found: bioavanced_test" boot failure is a separate, still-open problem
#303/#304 will hit. **#304** (real `propagateCompromise` + AC#6 e2e)
depends on #303. **#307** (run-cycle route auth) needs Dennis's call on
whether the NODE_ENV gate alone is acceptable. Also still open and
unpicked from before: `#301`, `#302` (both #298-era), `#295` (RF004
AC#3 — needs Dennis), `#297` (RF006 AC#6 — needs Dennis), and remaining
Wave 1 RFs `#290` (RF018), `#291` (RF019), `#292` (RF023), `#293` (TOTP
helper).

## Which skills to use

`work-issue` to route the next issue. `fix-bugs` for #306; `build-loop`
+ `divide-and-conquer` for #303/#304; `bioavanced-v2-conventions`,
`bioavanced-v2-testing-conventions`, and `docker-workflow` all apply to
RF009-family work.
