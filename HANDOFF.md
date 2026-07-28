# HANDOFF

**Written:** 2026-07-28, end of a `work-issue` → `resolve-issue` session —
closed #309 (wire the Neo4j projection worker into dev/prod compose).

**Branch:** `test/e2e-real-backend-foundation`, pushed to
`origin/test/e2e-real-backend-foundation` this session (8bc7238e).

## What happened this session

1. Routed #309 (fresh follow-up from #292/RF023, flagged in the last
   handoff as a natural next pickup) through `work-issue` →
   `resolve-issue`. The issue needed an owner decision (standalone
   compose service vs. folding into the existing `worker.js`) — asked
   Dennis directly rather than guessing; Dennis said check the docs
   first.
2. Initially answered "no docs settle this" having only grepped
   `COVERAGE_NOTES.md`/`HANDOFF.md` by filename — Dennis caught that I
   hadn't actually looked for a docs directory. Found
   `docs/architecture/canonical-active-surface.md`, which lists
   `src/workers/worker.js` **and** `src/workers/workers/*.js` as
   distinct active worker entrypoints (per-entity worker files:
   `location-worker.js`, `patient-worker.js`, `result-worker.js`,
   `sample-worker.js`, `temperature-worker.js`) — supporting a
   standalone-service pattern over folding into `worker.js`. Dennis
   then confirmed: standalone compose service.
3. Added a `neo4j-projection-worker` service to `compose.dev.yml`
   (added to `compose:up`'s explicit service list too) and
   `compose.prod.yml`, both running `npm run neo4j:canonical:worker`
   (`neo4jProjection.worker.js`) — mirroring the
   `neo4j-projection-worker-test` service added for #292, the only
   existing precedent.
4. Discovered along the way: `compose.prod.yml` has **no** `worker`
   service at all (unlike `compose.dev.yml`) — there's also no npm
   script combining `compose.yml` + `compose.prod.yml` the way
   `compose:up` does for dev. So the existing import-worker pipeline
   never runs in a production compose deployment today, independent of
   the Neo4j projection worker gap. Out of scope for #309 — filed as
   **#310** rather than fixed here (needs an owner call on whether
   `compose.prod.yml` is a literal deployment artifact or a
   reference/template).
5. Validated both compose files parse (`docker compose ... config
   --services`, prod validated with dummy required env vars since
   `.env.production.example` doesn't set real secrets).
6. Closed **#309** with a resolution comment pointing at 8bc7238e and
   #310.
7. Filed `dyeallpies-skills-pack#139`: `work-issue`'s routing step (and
   `bioavanced-v2-conventions`) don't currently require enumerating a
   repo's actual docs directories before an agent claims "no docs
   settle this" and escalates to the user — this session's near-miss is
   the concrete case.
8. No product code edited (`api/backend/src`/`frontend/src` untouched) —
   this was compose/infra wiring only, plus one `package.json` script
   line update.

## Repo state

- Working tree clean, `test/e2e-real-backend-foundation` is pushed and
  up to date with `origin/test/e2e-real-backend-foundation` at
  8bc7238e.
- `test/migrate-rcs-governance-indexes-coverage` still carries the
  unmerged coverage work from issue #285 (untouched, not in scope).
- The remote branch `origin/fix/mongo-audit-repo-generate-movement-id`
  (from the #296 session) may still be undeleted — not touched this
  session, carried forward from prior handoffs.
- **#309 is closed.** **#310** (new, this session) is open: prod compose
  has no worker service at all, needs an owner call.
- `dyeallpies-skills-pack#139` (new, this session): work-issue doc-search
  diligence gap. `dyeallpies-skills-pack#138` (stale branch name in the
  test-loop overlay) still open from a prior session, not touched this
  session.

## Recommended next steps

None queued explicitly by Dennis this session. Open and unpicked, in
rough order: **#310** (new, this session — prod worker service gap,
needs owner call on whether compose.prod.yml is a real deployment
artifact) and **#308** (owner decision on sensor→sample `freezerKey`
linkage, unblocks #304's real `propagateCompromise`) are both
self-contained and fresh. Also still open and unpicked: `#301`, `#302`
(both #298-era), `#295` (RF004 AC#3 — needs Dennis), `#297` (RF006
AC#6 — needs Dennis), `#307` (run-cycle route auth — needs Dennis's
call), `#115` (Orphadata partial-coverage design call — needs Denise,
asked to wait for a specific PR merge), and `#293` (TOTP helper — needs
Dennis, no test-side TOTP generator exists). All Wave 1 RFs are done
per `E2E_TRACEABILITY_PLAN.md` — the next `test-loop` pickup should be
whichever Wave 2 RF the traceability doc lists next (not checked this
session — read `E2E_TRACEABILITY_PLAN.md` fresh).

## Which skills to use

`work-issue` to route the next issue. `test-loop` applies to whichever
Wave 2 RF gets picked next (check `E2E_TRACEABILITY_PLAN.md`);
`build-loop` applies to #304 (and whatever #308/#310 resolve into);
`bioavanced-v2-conventions`, `bioavanced-v2-testing-conventions`, and
`docker-workflow` all apply to this family of work.
