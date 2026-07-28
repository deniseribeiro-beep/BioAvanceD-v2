# HANDOFF

**Written:** 2026-07-28, end of a `work-issue` → `resolve-issue` session —
closed #310 (compose.prod.yml missing a `worker` service).

**Branch:** `test/e2e-real-backend-foundation`, pushed to
`origin/test/e2e-real-backend-foundation` this session (f8bc5598).

## What happened this session

1. Routed #310 (filed last session as a follow-up discovery from #309)
   through `work-issue` → `resolve-issue`. The issue needed an owner
   decision: is `compose.prod.yml` a literal deployment artifact or a
   reference/template? Asked Dennis directly. Dennis: no deployments
   exist yet, but prod will eventually run on GCP — go with whatever fits
   that best if the docs don't settle it.
2. Checked `docs/docs-7-27-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md`
   (the only doc hit for deployment-related terms) — it only says the
   foundation-data container integrates with "Compose/Kubernetes," no
   explicit GCP guidance either way. Docs don't settle it.
3. Decided: an incomplete `compose.prod.yml` is strictly worse under any
   future GCP target (GCE+Compose, GKE via translation, or as a reference
   for Cloud Run job definitions), so added a `worker` service (running
   `npm run worker`) to `compose.prod.yml`, mirroring `compose.dev.yml`'s
   worker service and matching the hardening (`read_only`, `cap_drop`,
   `tmpfs`) used for the #309 `neo4j-projection-worker` fix.
4. Validated with `docker compose -f compose.prod.yml config --services`
   (dummy required env vars) — parses clean, all 9 services listed
   including the new `worker`.
5. Closed **#310** with a resolution comment pointing at f8bc5598 and the
   reasoning above.
6. Hit friction: `resolve-issue`'s generic `issue-<N>-<slug>` branch
   convention is blocked by this repo's `branch-guard.cjs` (only allows
   `feature/docker-e2e-backend-integration` or `fix/<slug>`/`test/<slug>`).
   Worked around by committing directly on the already-active
   `test/e2e-real-backend-foundation` branch (same pattern the #309
   session apparently used). Filed `dyeallpies-skills-pack#140` with
   suggested fix text.
7. No other product code edited (`api/backend/src`/`frontend/src`
   untouched) — this was compose/infra wiring only.

## Repo state

- Working tree clean, `test/e2e-real-backend-foundation` is pushed and
  up to date with `origin/test/e2e-real-backend-foundation` at f8bc5598.
- `test/migrate-rcs-governance-indexes-coverage` still carries the
  unmerged coverage work from issue #285 (untouched, not in scope).
- The remote branch `origin/fix/mongo-audit-repo-generate-movement-id`
  (from the #296 session) may still be undeleted — not touched this
  session, carried forward from prior handoffs.
- **#310 is closed.** `dyeallpies-skills-pack#140` (new, this session):
  resolve-issue branch-naming convention conflicts with bioavanced-v2's
  branch-guard hook — needs a pack-repo session to apply the fix.
  `dyeallpies-skills-pack#139` (prior session: work-issue doc-search
  diligence gap) and `dyeallpies-skills-pack#138` (stale branch name in
  the test-loop overlay) still open, not touched this session.

## Recommended next steps

None queued explicitly by Dennis this session. Open and unpicked, in
rough order: **#308** (owner decision on sensor→sample `freezerKey`
linkage, unblocks #304's real `propagateCompromise`) is self-contained
and fresh. Also still open and unpicked: `#301`, `#302` (both #298-era),
`#295` (RF004 AC#3 — needs Dennis), `#297` (RF006 AC#6 — needs Dennis),
`#307` (run-cycle route auth — needs Dennis's call), `#115` (Orphadata
partial-coverage design call — needs Denise, asked to wait for a specific
PR merge), and `#293` (TOTP helper — needs Dennis, no test-side TOTP
generator exists). All Wave 1 RFs are done per `E2E_TRACEABILITY_PLAN.md`
— the next `test-loop` pickup should be whichever Wave 2 RF the
traceability doc lists next (not checked this session — read
`E2E_TRACEABILITY_PLAN.md` fresh).

## Which skills to use

`work-issue` to route the next issue. `test-loop` applies to whichever
Wave 2 RF gets picked next (check `E2E_TRACEABILITY_PLAN.md`);
`build-loop` applies to #304 (and whatever #308 resolves into);
`bioavanced-v2-conventions`, `bioavanced-v2-testing-conventions`, and
`docker-workflow` all apply to this family of work.
