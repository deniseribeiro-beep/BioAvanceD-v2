# HANDOFF

**Written:** 2026-07-30, a `build-loop` session on
`test/e2e-real-backend-foundation`, Docker on (user-confirmed at session
start).

## What happened this session

1. Read the prior HANDOFF.md (the #333 AC#4/AC#5 test-loop session's).
   Dennis asked to pick up #337, falling back to #338 if #337 turned out
   too small — it didn't; #337 needed a real build-loop slice (product
   code, not just a test).
2. #337 (RF003 AC#3 — "atribuir papel com vigência e escopo
   institucional"): confirmed via the requirements doc
   (`docs/docs-7-27-2026/extracted/requisitos-index.md`) exactly what
   AC#3 requires, then built it:
   - `User.js`: added `roleValidFrom`/`roleValidUntil`/
     `institutionalScope` fields, with validation (valid dates,
     `roleValidUntil` after `roleValidFrom`, scope is an array of
     strings).
   - `user.routes.js`'s `PUT /:id`: normalizes incoming ISO date strings
     for the two new date fields before persisting.
   - `auth.js`'s `authenticate` middleware: now re-fetches the live user
     document (not just the JWT) on every non-exempt authenticated
     request and refuses (403, `roleExpired: true`) once
     `roleValidUntil` has passed — a session issued before expiry is
     cut off on its very next call, not just at next login.
3. Wrote the failing-first real-backend test (per build-loop's "prove,
   then build") in `auth-access-security.spec.ts`'s RF003 block: admin
   assigns a Técnico a role with an already-past `roleValidUntil` +
   institutional scope, confirms it's persisted/returned, confirms the
   Técnico's session gets 403 on the next call, then confirms extending
   `roleValidUntil` into the future restores access.
4. Docker gate (session-authorized at start, not per-iteration): brought
   up `compose.test.yml`'s stack, stopped the auto-started
   `playwright-runner`, ran `auth-access-security.spec.ts` alone — 9/9
   passing (all 8 pre-existing + the new AC#3 test) — then tore the
   stack down (`down --volumes --remove-orphans`). Also ran the targeted
   native unit/integration suite touching `User.js`/auth
   middleware/user routes (94 tests, all green) before committing.
5. Updated `E2E_TRACEABILITY_PLAN.md`'s RF003 row from PARTIAL to
   COVERED — all six acceptance criteria are now proven against the
   real backend.
6. Committed (`7a1de69f`) and pushed `test/e2e-real-backend-foundation`.
   No PR opened (Dennis's call, unchanged); not merged forward into
   `feature/docker-e2e-backend-integration`.
7. Closed **#337** (referencing the commit) and **#333** (the parent
   tracking issue — all its remaining criteria are now covered across
   this and the prior session).
8. Filed **#339**: `institutionalScope` is stored/validated/returned
   but has no enforcement anywhere — no resource (samples, patients,
   reports, dashboards) is filtered by it. AC#3 as worded only requires
   the *assignment* to be possible, which is now true, but scope
   enforcement is a separate, unbuilt product decision.
9. wrap-up audit: no scope violations (build-loop permits product-code
   edits, unlike the prior test-loop sessions), no lazy fixes, no
   permission denials, no stale instructions. One judgment call
   (institutionalScope assignment-only, no enforcement) surfaced and
   filed as #339 rather than left implicit.

## Repo state

- `test/e2e-real-backend-foundation` at `7a1de69f`, pushed.
- `feature/docker-e2e-backend-integration` still has its own divergent
  slices not yet reconciled with this branch — still worth a deliberate
  merge/integration pass sometime soon; nobody has done it yet.
- `main` still not touched, still frozen.
- Docker test stack torn down after the run — nothing left running;
  confirmed via `docker compose ps` before tear-down and the tear-down's
  own output.
- **#333 and #337 are closed.** RF003 is now fully covered end-to-end.
- **#338** (still open, from the prior session): same-second logins
  produce byte-identical JWTs; session storage conflates them.
  Security-adjacent, not yet fixed.
- **#339** (new): `institutionalScope` has no enforcement anywhere —
  needs a product decision on which resources/roles it should constrain
  before a build-loop slice could implement it.

## Recommended next steps

None queued — Dennis hasn't named a specific next issue. Candidates,
unranked: #338 (session-identity bug, `fix-bugs`-shaped) or #339
(institutional-scope enforcement, needs Dennis's product call first,
then `build-loop`-shaped); reconciling the two-branch divergence noted
above; #325/#326 (RF020/RF021) still blocked on #320's CRUD gap; #334
(RF007 remainder) is divide-and-conquer-shaped, lower priority.
Tracking issue #331 covers integrating all Wave 2 specs onto
`feature/docker-e2e-backend-integration` once they land.

## Which skills to use

`fix-bugs` for #338. `build-loop` for #339 once Dennis has triaged which
resources/roles institutional scope should constrain (or `resolve-issue`
first, to get that call from him). `build-loop` for #325/#326 once
#320's CRUD gap is resolved. `ship-integration-branch` only once Wave 2
is fully landed and Dennis explicitly asks to graduate to `main`.
