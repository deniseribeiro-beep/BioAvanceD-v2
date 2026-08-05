# HANDOFF

**Written:** 2026-08-05, after shipping #421 (RBAC enforcement cutover) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Dennis said "Pick #421". Routed via `build-loop` (Docker on by default,
per that loop's overlay). #421 was slice 2 of 3 from #386's split:
cut `requirePermission`/`requireRole` (and every read path that used
them) over from `accessType`/`roleName` to resolving via
`UserRoleAssignment -> Role -> Permission` (the models #420 added last
session), and re-prove RF002/RF003's real-backend RBAC e2e coverage
against the new model.

Built on branch `test/421-rbac-enforcement-cutover`:
- **`api/backend/src/services/rbac-assignment.service.js`** (new) — the
  one place that resolves a user's active roles/permissions from the new
  model (`resolveUserHierarchyLevel`, `userHasPermission`) and the one
  place that grants/revokes a `UserRoleAssignment`
  (`grantRoleForAccessType`, `changeUserRole`, `backfillUserRoleAssignments`).
- **`api/backend/src/infrastructure/middleware/rbac.js`** — rewritten to
  call the above (async, via `req.app.locals.db`) instead of reading
  `accessType`/`roleName` directly; exported shape (`requireRole`,
  `requirePermission`, `permissions`) kept identical so the ~24 route
  files that consume it needed no changes.
- **`api/backend/src/reference-data/roles.min.json`** +
  **`rbac-catalog-seed.service.js`**'s `PERMISSION_CATALOG` — filled two
  gaps left from #420 (`manageTemperature`, `manageOrganizations` weren't
  in either), so the new model has exact behavior parity with the old
  accessType table.
- **User-creation/role-change atomicity**: `auth.service.js#registerUser`,
  `scripts/createFirstAdmin.js`, and `PUT /api/users/:id`
  (`user.routes.js`) now grant/revoke the corresponding
  `UserRoleAssignment` in the same request as the accessType write — no
  dual-write window, per dict-07's migration-table rule.
- **`api/backend/src/controllers/paciente.controller.js`** — 3 inline
  `permissions.createPatient.includes(userRole)` LGPD-masking checks
  switched to `userHasPermission(db, userID, 'createPatient')` (these
  weren't behind the `rbac.js` middleware, so the cutover had to reach
  them directly too).
- **`api/backend/src/scripts/backfillUserRoleAssignments.js`** (new) —
  one-time idempotent backfill for users that predate #420/#421. **Not
  yet run against the shared dev stack — see #425, blocking for anyone
  pulling this onto a stack with real pre-existing users.**
- **Test fallout**: the cutover broke 30 test files (196 tests) whose
  mock DBs assumed the old accessType-in-JWT trust model. Fixed via a
  shared fixture helper, **`api/backend/tests/factories/rbac.factory.js`**
  (`buildRbacCollections`/`buildMutableRbacCollections`, built from
  `roles.min.json` so it can't drift from the real seed), fanned out
  across 6 parallel `test-writer` agents (grouped ~5 files each) — no
  test assertions changed, only mock-db setup. Also added
  `tests/unit/rbac-assignment.service.test.js` and rewrote
  `tests/unit/rbac.test.js` as this slice's own proving tests.
- **Verified**: all 30 previously-broken files + the 2 new ones pass
  together (`iot.api.test.js`'s one remaining failure confirmed
  pre-existing via `git stash` diff against pre-cutover state — unrelated
  cold-chain mock-shape bug). Lint clean (325 files). RF002/RF003
  (`tests/e2e/auth-access-security.spec.ts`, 9/9) re-proven against a
  live `compose.test.yml` Docker/Mongo stack, including the
  Técnico-cannot-create-user RBAC gate — confirmed via direct Mongo query
  that the bootstrap admin's real `UserRoleAssignment` was granted
  correctly (4 roles, 16 permissions, 1 assignment).

Committed (`1058626e`), merged into `feature/docker-e2e-backend-integration`
(merge commit `51b5a373`), pushed. Closed #421 referencing both hashes.
Docker test stack torn down after the e2e run.

Filed two follow-ups found along the way (not blocking, both real):
- **#424** — pre-existing, unrelated bug: `result.routes.api.test.js`
  denial logs show `PUT`/`DELETE /api/results/:id` checking
  `requirePermission('createPatient')` instead of a result-specific
  permission (likely copy-paste). Tests still pass by coincidence.
- **#425** — operational: the backfill script (above) needs to run
  against the dev stack (or any stack with real pre-existing users)
  before/after this merge lands there, or those users get locked out.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `51b5a373`, pushed
  (was `8df6850a`). Contains #421's RBAC enforcement cutover.
- No dangling branches (`test/421-rbac-enforcement-cutover` merged, not
  deleted locally yet — safe to delete).
- Issues: **#421 closed** (merged, referenced both hashes). **#424**,
  **#425** opened this session. **#422** (the atomic `requirePermission`
  integration issue — depends on #421, which is done) is now unblocked.
  Backlog otherwise unchanged: **#386** (tracking issue, stays open),
  **#387**, older backlog (`#371`/`#373`/`#374`/`#378`/`#379`), **#389**
  (route through `divide-and-conquer` first, 28 files).

## Blocking next step

None for picking up new work. **#425 should be run against any
already-running dev stack before that stack's users try to log in** —
not blocking this session's close, but a real prerequisite for anyone
else pulling this branch onto a live environment.

## Recommended next steps

Dennis didn't name a specific next pick this session, so per this
skill's own rule: **none queued**. If continuing the RBAC thread,
**#422** is now unblocked (depends on #421, done). Otherwise backlog:
**#387**, older backlog (`#371`/`#373`/`#374`/`#378`/`#379`), and
**#389** (route through `divide-and-conquer` first, 28 files).

## Which skills to use

- **#422**: route through `build-loop` when picked up (check its own
  body for whether it still needs Docker-on-by-default — likely yes,
  same reasoning as #421).
- **#424**: straightforward `fix-bugs` pick — reproduce with a test
  asserting the correct permission name, fix the route.
- **#425**: not really a coding task — run the backfill script against
  whatever stack needs it, verify via the same direct-Mongo-query pattern
  this session used (`db.userRoleAssignments.countDocuments()` before/after).
- **#387**, older backlog
  (`#371`/`#373`/`#374`/`#378`/`#379`) — untouched this session, no new
  guidance beyond prior handoffs.
- **#389**: if picked up next, route through `divide-and-conquer` first
  per its own body (28 files, too big for one slice) — don't attempt as
  one iteration.
