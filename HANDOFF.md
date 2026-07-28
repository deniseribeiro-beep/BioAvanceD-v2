# HANDOFF

**Written:** 2026-07-28, end of a `work-issue` → `test-loop` session —
closed the last unpicked Wave 1 RF (#292, RF023 Outbox/Neo4j projection
real-backend spec).

**Branch:** `test/e2e-real-backend-foundation`, pushed to
`origin/test/e2e-real-backend-foundation` this session (c2ebab50).

## What happened this session

1. Routed #292 (RF023, last remaining unpicked Wave 1 RF per the prior
   handoff) through `work-issue` → `test-loop`.
2. Discovered the real scope before writing anything: nothing in the
   repo runs `neo4jProjection.worker.js` (the outbox → Neo4j drain) —
   not `compose.dev.yml`, not `compose.prod.yml`, and — until this
   session — not `compose.test.yml` either (`worker-test` runs the
   unrelated import worker). Without something draining
   `graph_projection_outbox`, outbox rows sit PENDING forever and no
   e2e assertion against real Neo4j state could ever pass.
3. Added a `neo4j-projection-worker-test` service to `compose.test.yml`
   running `npm run neo4j:canonical:worker` continuously, and published
   `neo4j-test`'s bolt port (7687) to the host — same
   published-port-for-host-run-Playwright pattern as `mongodb-test`
   (#294) and `influxdb-test` (#289).
4. Added `tests/e2e/helpers/queryNeo4j.ts` — a `neo4j-driver`-based
   helper with `waitForEthicalConsentStatus(consentId, status, opts)`
   that polls the real Neo4j instance (the projection is genuinely
   async), mirroring `queryInflux.ts`'s host-side direct-store-query
   precedent.
5. Added `tests/e2e/pipeline-continuity.spec.ts` — 2 real-backend
   tests: `POST /api/consents` projects a new `:EthicalConsent{status:
   ACTIVE}` node, and `POST /api/consents/:id/revoke` flips the same
   node to `REVOKED`. Both exercise the real
   `consent.service.js` → `graphProjection.service.js` →
   `neo4jOutbox.service.js` → `neo4jProjection.worker.js` →
   `neo4jCanonicalProjection.service.js` chain end to end.
6. Verified against real product logic natively: ran
   `neo4jProjection.worker.test.js`, `neo4jCanonicalProjection.service.test.js`,
   `neo4j-outbox.service.test.js`, and `consent.service.unit.test.js`
   (149 tests, all passed) — confirmed the assumed event
   shapes/collection names/status transitions match actual code before
   writing the spec. Confirmed `playwright test --list` picks up both
   new tests. Did not bring up Docker this session — the spec still
   needs a Docker run (with the new `neo4j-projection-worker-test`
   service) to prove it against the live stack; not done this session,
   per this loop's native-only execution contract.
7. No product code edited — `compose.test.yml` is test infra (same
   category as the two prior ports precedents), not `api/backend/src`/
   `frontend/src`.
8. `COVERAGE_NOTES.md` untouched — same reasoning as #290/#291, this
   was an e2e gap, not a unit-coverage bucket move.
9. Filed **#309**: nothing outside the new test compose service runs
   the projection worker, so in dev/prod the outbox pipeline never
   actually drains — needs an owner call on wiring it into
   `compose.dev.yml`/`compose.prod.yml` (new service vs. folding into
   the existing `worker` process).
10. Wrap-up audit: the one finding (#309) is filed; no other friction.

## Repo state

- Working tree clean, `test/e2e-real-backend-foundation` is pushed and
  up to date with `origin/test/e2e-real-backend-foundation` at
  c2ebab50.
- `test/migrate-rcs-governance-indexes-coverage` still carries the
  unmerged coverage work from issue #285 (untouched, not in scope).
- The remote branch `origin/fix/mongo-audit-repo-generate-movement-id`
  (from the #296 session) may still be undeleted — not touched this
  session, carried forward from prior handoffs.
- #292 is not closed — this session covered both the ACTIVE and
  REVOKED projection paths, but leaving the issue open for Dennis/owner
  to confirm and close, per the same established pattern as #290/#291.
- **All Wave 1 RFs are now covered** (per `E2E_TRACEABILITY_PLAN.md`) —
  no more unpicked Wave 1 items remain.
- `dyeallpies-skills-pack#138` (stale branch name in the test-loop
  overlay) still open, filed last session, not touched this session.

## Recommended next steps

None queued explicitly by Dennis this session. Open and unpicked, in
rough order: **#309** (new, this session — wire the projection worker
into dev/prod compose) is a natural next pickup since it's fresh and
self-contained. Also **#308** (owner decision on sensor→sample
`freezerKey` linkage, unblocks #304's real `propagateCompromise`).
Also still open and unpicked: `#301`, `#302` (both #298-era), `#295`
(RF004 AC#3 — needs Dennis), `#297` (RF006 AC#6 — needs Dennis), `#307`
(run-cycle route auth — needs Dennis's call), `#115` (Orphadata
partial-coverage design call — needs Denise, asked to wait for a
specific PR merge), and `#293` (TOTP helper — needs Dennis, no
test-side TOTP generator exists). With Wave 1 done, the next `test-loop`
pickup should be whichever Wave 2 RF the traceability doc lists next
(not checked this session — read `E2E_TRACEABILITY_PLAN.md` fresh).

## Which skills to use

`work-issue` to route the next issue. `test-loop` applies to whichever
Wave 2 RF gets picked next (check `E2E_TRACEABILITY_PLAN.md`);
`build-loop` applies to #304 (and whatever #308/#309 resolve into);
`bioavanced-v2-conventions`, `bioavanced-v2-testing-conventions`, and
`docker-workflow` all apply to this family of work.
