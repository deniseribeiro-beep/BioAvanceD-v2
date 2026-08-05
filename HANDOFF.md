# HANDOFF

**Written:** 2026-08-05, after closing #429 (dedicated `auditor` RBAC
role, retiring the `roleName` substring fallback in
`logs.routes.js`) on `feature/docker-e2e-backend-integration`.

## What happened this session

Picked #429 explicitly (Dennis: "Pick #429"). Routed via `work-issue` ->
`resolve-issue` (route 6 — `enhancement` label, no bug/test-branch/RF
traceability-item shape).

**What #429 asked for:** `logs.routes.js`'s `requireAuditReader` granted
audit-log read access to any JWT whose `roleName`/`role` text merely
*contained* "auditor" (`normalizeRoleName(...).includes('auditor')`),
because the RBAC catalog (`rbac-catalog-seed.service.js`) never defined
a real `auditor` role — the substring check was a documented stopgap
from #426, kept until #427/#428 either added a real role or retired the
concept.

**Landed** (`fix/429-rbac-auditor-role`, commit `187ea680`, merged
`--no-ff` into `feature/docker-e2e-backend-integration` at `92b10406`):
- `api/backend/src/services/rbac-catalog-seed.service.js`: new
  `ADDITIONAL_ROLES_SEED` array for roles with no `accessType` slot —
  `auditor` (roleCode `auditor`, `hierarchyLevel: null`, permission
  `viewAuditLogs`) is the first entry. Additive roles stack alongside a
  user's accessType-derived role rather than replacing it, so they're
  built and seeded separately from `LEGACY_ROLES_SEED`'s 4 roles
  (`buildRoleDocs`/`buildPermissionDocs` now merge both sources).
  `ROLE_CODE_BY_LEGACY_NAME`/`ROLE_CODE_BY_ACCESS_TYPE` are unchanged —
  `auditor` is deliberately not reachable through either, since it has
  no accessType.
- `api/backend/src/services/rbac-assignment.service.js`: new
  `grantAdditionalRole`/`revokeAdditionalRole` — grant/revoke a single
  roleCode's assignment without touching any other active assignment
  for the user (unlike `changeUserRole`, which revokes everything first).
  Both idempotent, same upsert-by-active-assignment pattern as
  `grantRoleForAccessType`.
- `api/backend/src/interface/routes/user.routes.js`: `PUT /:id` now
  accepts a `req.body.auditorRole` boolean — `true` grants, `false`
  revokes, via the new service functions. Never persisted onto the User
  document (deleted from `req.body` before the `$set`), same pattern as
  `accessType`/`roleName` since #427.
- `api/backend/src/interface/routes/logs.routes.js`: `requireAuditReader`
  now checks `roleCodes.includes('auditor')` only. `normalizeRoleName`
  and the substring fallback are deleted.
- Tests updated/added: `rbac-catalog-seed.service.test.js` (auditor role
  present, `hierarchyLevel: null`, `viewAuditLogs` wired, idempotency
  count 4->5), `rbac-assignment.service.test.js` (6 new tests for
  grant/revokeAdditionalRole), `logs.routes.test.js` +
  `logs.api.test.js` (the two tests that used to assert the substring
  fallback *worked* now assert it's *denied*, plus a new test proving a
  real `auditor` assignment alone — no `administrator` — grants access),
  `users-access.routes.test.js` (new test: `PUT /:id` with
  `auditorRole: true` grants the role and never persists the flag).
  `tests/factories/rbac.factory.js` extended: `buildRbacCollections`
  now accepts `{ userAccountId, accessType, roleCodes }` (roleCodes for
  additive grants, accessType optional).

Verified: targeted suite (88 tests across the 5 touched files) green
both pre-merge and post-merge-on-integration-branch. Full backend suite
on the merged branch: 6528/6535 passing — the 7 failures
(`UserModel.isValidAccessType`/`getRoleName` missing) are pre-existing
and unrelated, confirmed via `git stash` diff against the base commit
before this session's changes.

Pushed. Closed #429 with the merge commit hash. Local + remote
`fix/429-rbac-auditor-role` branch deleted.

`wrap-up` ran: no friction (branch-guard forcing `fix/<slug>` was
expected, not a surprise; merge was conflict-free).

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed, up to date with
  `origin` as of this session's merge (`92b10406`). Includes this
  session's #429 fix plus all prior sessions' work (through #434).
- **`fix/429-rbac-auditor-role`**: merged, deleted (local + remote).
- Issues: **#429 closed** (merged, see above). No new issues filed this
  session.
- Backlog otherwise unchanged from prior handoff: **#424**, **#425**
  (backfill script, operational not coding), **#387**,
  `#371`/`#373`/`#374`/`#378`/`#379`, **#389**.
- **dyeallpies-skills-pack#210** (RBAC blast-radius overlay note) —
  still open, not yet applied.

## Blocking next step

None. Same prerequisite as prior handoffs: **#425** (run the backfill
script against any live dev stack before its users try to log in)
remains the one real prerequisite for deploying #421's work to a shared
environment, not blocking this session's close. Note: **#425's backfill
also won't grant `auditor` to anyone** — it's additive-only and nothing
in the codebase currently calls `grantAdditionalRole` for existing
users, so any user who needs audit-log access post-#429 needs an admin
to `PUT /api/users/:id` with `auditorRole: true` explicitly (or a future
session/script to do it in bulk). Not filed as a separate issue since
no user currently depends on the substring fallback that was just
removed (grep of the codebase found no user-creation path that ever
set a `roleName` containing "auditor").

## Recommended next steps

Dennis picked #429 explicitly this session but didn't name a next pick
after it, so per this skill's own rule: **none queued** as an explicit
instruction. Backlog candidates unchanged from prior handoffs:
**#424** (straightforward `fix-bugs`), **#425** (operational), **#387**,
older backlog (`#371`/`#373`/`#374`/`#378`/`#379`), or **#389** (route
through `divide-and-conquer` first, 28 files). Also worth a quick grep
sweep (`user.accessType`) sometime — the prior handoff flagged this and
it hasn't been done yet — to confirm the #427/#428/#431/#433/#434
stale-`accessType` family (unrelated to this session's #429 work) is
fully closed out.

## Which skills to use

- Unchanged from prior handoffs for #424/#425/#387/older backlog/#389 —
  see git history of this file if needed, or the issues themselves for
  current guidance.
- #429's shape (add a real RBAC role/permission not tied to accessType,
  wire a grant/revoke path, retire an unauthenticated-source fallback)
  is a reusable pattern if a similar "second dedicated role" need comes
  up (e.g. #429's own issue body flagged this as a possible template).
