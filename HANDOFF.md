# HANDOFF

**Written:** 2026-07-30, a `resolve-issue` session on
`feature/docker-e2e-backend-integration`, reconciling the long-open
two-branch divergence as part of picking up #339.

## What happened this session

1. Dennis asked to pick up #339 (institutional-scope enforcement).
   Per #339's own text, this needed Dennis's product call first: which
   resources should `institutionalScope` constrain, and for which
   roles. Asked — answer: all of samples/patients/reports/dashboards,
   for all non-superadmin roles.
2. Sized the resulting build via a research-only Explore agent (per
   `agent-delegation`) — its report claimed `institutionalScope` didn't
   exist anywhere in the tree, contradicting #339's own text. Verified
   directly (`git grep`) rather than trusting the claim: confirmed the
   field really was absent from `feature/docker-e2e-backend-integration`,
   but traced it to `test/e2e-real-backend-foundation`'s commit
   `7a1de69f` (the #337 build-loop session) — the two-branch divergence
   flagged in every prior HANDOFF since #333, never reconciled.
3. Asked Dennis how to proceed given the divergence; he chose:
   reconcile the branches first, then continue #339 on the merged base.
4. Diffed the two branches (`git merge-tree`) before merging: only
   `HANDOFF.md` had real conflicts (both sessions rewrote it); every
   product/doc file (`auth.js`'s `roleValidUntil` gate,
   `user.routes.js`'s `PUT /:id` normalization, `.claude/skills-manifest.txt`,
   `E2E_TRACEABILITY_PLAN.md`'s RF003 row) merged cleanly.
5. Merged `test/e2e-real-backend-foundation` into
   `feature/docker-e2e-backend-integration`, resolving `HANDOFF.md` by
   hand (this rewrite, folding both sessions' history in rather than
   picking one side).
6. **Not yet done this session:** run targeted tests on the merged
   tree, push, then resume #339's actual enforcement work (add
   institution-like fields to Sample/Patient/report models, build the
   filter-injection middleware, wire it into
   `sample.service.js`/`patient.service.js`/`reports.routes.js`;
   dashboards inherit automatically per the sizing research since they
   only compose those same endpoints).

## Repo state

- `feature/docker-e2e-backend-integration` now carries both prior
  divergent histories (#324/#338 plus #322/#333/#337's RF003 work,
  including `institutionalScope`/`roleValidFrom`/`roleValidUntil` on
  `User.js` and the `authenticate` middleware's expiry check) —
  **pending**: post-merge targeted test run and push (interrupted by
  context handling this session; pick up from here).
- `test/e2e-real-backend-foundation` at `7a1de69f` — fully merged
  forward now; safe to delete once the merge is pushed and confirmed
  (not yet done).
- `main` still not touched, still frozen.
- **#333, #337, #338 closed** (from prior sessions). **#339 still
  open** — product call now made (see above), enforcement not yet
  built.
- **#336** (from the #324 session, still open): legacy synchronous
  `POST /api/import/fhir` looks superseded by the FHIR staging pipeline,
  needs Dennis/Denise reconciliation, non-blocking.

## Recommended next steps

1. Finish this session's merge: run the targeted test suite on the
   merged tree (at minimum everything touching `User.js`, `auth.js`,
   `user.routes.js`, session/auth tests, plus the RF003
   `auth-access-security.spec.ts` e2e spec if Docker is on), then push.
2. Resume #339 with `build-loop`: add institution fields to
   Sample/Patient/report models, build the scope-filter middleware
   (no existing precedent to extend — `rbac.js`'s `allowedRoles` gate
   is the closest analogue but only allow/deny, doesn't inject query
   filters), wire into the three services, confirm dashboards inherit
   the filtering for free.
3. Once #339 lands: #325/#326 (RF020/RF021, blocked on #320's CRUD
   gap), #334 (RF007 remainder, divide-and-conquer-shaped), #336
   (legacy FHIR endpoint reconciliation).

Tracking issue #331 covers integrating all Wave 2 specs onto
`feature/docker-e2e-backend-integration` once they land.

## Which skills to use

`build-loop` for the rest of #339 (product call now made — see above).
`build-loop` for #325/#326 once #320's CRUD gap is resolved.
`ship-integration-branch` only once Wave 2 is fully landed and Dennis
explicitly asks to graduate to `main`.
