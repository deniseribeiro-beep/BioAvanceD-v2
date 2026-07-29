# HANDOFF

**Written:** 2026-07-29, a `work-issue` → `build-loop` session for Wave 1
of the e2e milestone (#290, #291, #292).

**Branch:** `test/e2e-real-backend-foundation`, now at `3e4cbf5d`
(pushed, clean), 1 commit ahead of the prior handoff's `98d4e607`.

## What happened this session

1. Read the prior (#285 resolve-issue) handoff — no next step queued
   explicitly. User asked to "work a wave 1 issue" with Docker on.
2. Found the three Wave 1 issues via `gh issue list --search wave`:
   #290 (RF018 SPREC/RCS), #291 (RF019 logical quarantine), #292 (RF023
   outbox→Neo4j projection). Routed #290 through `work-issue` →
   `build-loop` (capability-doesn't-exist-yet shape).
3. Discovered #290's and #291's real-backend specs already existed on
   this branch (commits 324c9931/73d120b2 — prior sessions built and
   committed them but never closed the tracker issues). Started the
   real `compose.test.yml` stack, ran both, confirmed 5/5 passing
   against the real backend. Closed both as already-done.
4. #292 (RF023) was genuinely broken — running its spec
   (`pipeline-continuity.spec.ts`, commit c2ebab50) against the real
   stack for the first time surfaced 3 real bugs stacked on top of each
   other:
   - Spec posted to `/api/consents`; the real route is
     `/api/e-consent/consents` (eConsent.js), and
     `createPatientConsent` requires non-empty
     `signatureName`/`signatureImageBase64` (Ajv schema minLength,
     even though neither is in the schema's `required` array).
   - **Product bug**: `neo4jOutbox.service.js`'s `appendEvent()` put
     `updatedAt` in both `$setOnInsert` (via the whole built doc) and
     `$set` — MongoDB rejects that as a path conflict, so every outbox
     write failed and consent creation itself 400'd.
   - **Test-env config bug**: `compose.test.yml`/`.env.test.example`
     set `NEO4J_DATABASE=bioavanced_test`, but `neo4j:5-community` only
     supports the default `neo4j` database (multi-database is
     Enterprise-only) — every Neo4j query failed with "Graph not
     found".
   Fixed all three (commit 3e4cbf5d). Verified: both RF023 tests pass,
   plus the full `pipeline-continuity.spec.ts` +
   `specimen-quality-inventory.spec.ts` suites (19/19) against the real
   stack, no regressions. Also re-ran `neo4j-outbox.service.test.js`
   (14/14 unit tests still pass after the `$setOnInsert` fix). Closed
   #292 with the bug breakdown.
5. `wrap-up` audit: filed
   `dyeallpies-skills-pack#146` — build-loop's BioAvanceD-v2 local-env
   says "Docker on by default" but doesn't give the actual
   `compose.test.yml` startup recipe (had to reverse-engineer from
   `.github/workflows/ci-pipeline.yml`), doesn't mention the separate
   one-shot `admin-bootstrap-test` service (skip it and every
   `realLogin()` 401s), and doesn't list the env vars a host-run
   Playwright process needs beyond `PLAYWRIGHT_*`
   (`TEST_USER`/`TEST_PASS`/`E2E_MONGO_URI`/`E2E_MONGO_DB`/
   `E2E_NEO4J_DATABASE`/`TEST_SUPPORT_SECRET`). No other friction: scope
   stayed inside build-loop's normal "prove, then build" pattern (edited
   product code because the loop's premise allows it), no lazy fixes,
   no ambiguous sub-points closed without a live issue.

## Repo state

- `test/e2e-real-backend-foundation` at `3e4cbf5d`, pushed, clean.
- **#290, #291, #292 closed** (Wave 1 of the e2e milestone — all three
  now proven against the real `compose.test.yml` stack).
- The real compose test stack is currently **running** on this machine
  (started this session, includes the rebuilt `backend-app-test`/
  `worker-test`/`neo4j-projection-worker-test` images with the
  `neo4jOutbox.service.js` fix baked in) — not torn down; next session
  should `docker compose --env-file .env.test.example -f
  compose.test.yml down --volumes --remove-orphans` if it doesn't need
  it, or reuse it if continuing e2e work immediately.
- **#307, #314, #313, #302, #285** closed (carried from earlier
  handoffs, untouched this session).
- Carried forward untouched, still open: the possibly-undeleted remote
  `origin/fix/mongo-audit-repo-generate-movement-id`,
  `dyeallpies-skills-pack#141` (unassigned),
  `dyeallpies-skills-pack#144` (branch-deletion permission-classifier
  block), `dyeallpies-skills-pack#146` (this session's local-env gap).
  `test/close-environmental-excursion-301` (merged feature branch, still
  exists locally/remotely — safe to delete once confirmed no longer
  needed, not done this or prior sessions).
- **#295, #297** still open with doc-evidence drafted in a prior
  session's conversation but never posted as issue comments — still
  pending a decision to de-scope them from "needs owner call."
- **#115** still open, not actionable (Denise's decision already on
  record).
- **#293** still open, an implementation gap (no test-side TOTP
  generator), not a design call.
- **#228** open (coverage snapshot tracking issue, see
  `api/backend/COVERAGE_NOTES.md`).
- **#286, #283, #282, #284** untouched (frontend Docker flake, docs
  drift, CI Playwright wiring).
- Wave 1 of `E2E_TRACEABILITY_PLAN.md` is now fully closed (RF001,
  RF002, RF004, RF006, RF009, RF012, RF018, RF019, RF023 per the plan's
  wave list) — Wave 2 (RF003, RF007, RF011, RF020, RF021, plus
  red-first issue filing for RF005/RF010/RF022/RF028) is the natural
  next milestone slice, but not queued as a specific issue by the user
  this session.

## Recommended next steps

None queued explicitly by the user. Wave 2 of the e2e milestone (see
above) is the obvious next `build-loop` target once picked up. Still
outstanding from earlier handoffs: the real-backend e2e proof for
#314's `sensor-registration.spec.ts` fix and #307's
`interop-monitoring.spec.ts` header addition should be re-run now that
Docker is actually being exercised regularly — neither has been proven
against the real compose stack yet.

## Which skills to use

`work-issue` → `build-loop` is the right route for Wave-1/2-style e2e
milestone issues that name a capability with existing unit coverage but
no e2e proof (#290/#291/#292's shape) — Docker on by default, no opt-in
gate, per `build-loop`'s BioAvanceD-v2 overlay. Don't assume a spec
file's existence on the branch means the issue is resolved — run it
against the real stack before closing (2 of this session's 3 issues
were already-written-but-unverified; the third had 3 stacked bugs
hiding behind "the spec exists").
