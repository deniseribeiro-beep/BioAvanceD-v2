# HANDOFF

**Written:** 2026-08-04, after splitting #422 into a 3-issue dependency
chain on `feature/docker-e2e-backend-integration`.

## What happened this session

Dennis said "Pick #422". Routed via `build-loop`, but before writing any
code the scope check showed #422 ("migrate write paths off accessType,
retire roles.min.json") was bigger than one slice: `accessType`/
`roleName` are still read *directly* (not via the new RBAC model from
#420/#421) in several security-relevant places — JWT payload
construction, admin-gate checks, notification-recipient queries, and
audit logging. Retiring the field before those reads migrate would
silently break admin/notification behavior, so this wasn't safely
chunkable as "just do write paths" — routed through `divide-and-conquer`
instead (design-split playbook) and confirmed the breakdown with Dennis
before filing.

Filed a 3-issue dependency chain, foundational piece first:
- **#426** — migrate remaining `accessType`/`roleName` readers onto the
  RBAC model (`auth.service.js` JWT payload, `auth.routes.js` login
  response, `user.routes.js`/`logs.routes.js` admin-gate checks,
  `incident.controller.js`/`iot.controller.js` notification queries,
  `auditLogger.js`). Flags that the JWT payload change is
  frontend-visible and may need a transition period.
- **#427** — stop writing `accessType`/`roleName` on write paths
  (`registerUser`, `createFirstAdmin.js`, `PUT /api/users/:id`). Depends
  on #426.
- **#428** — retire the fields from `User.js`/`Access.js` schema and
  retire `roles.min.json` as a runtime dependency (switch
  `rbac-catalog-seed.service.js`'s seed source). Depends on #427.

Commented the breakdown onto #422 (referencing all three numbers) and
closed it as the narrowed/split tracking issue; #386 stays open as the
top-level RBAC tracker. No project board in use in this repo (confirmed
via `gh issue view --json projectItems`), so no boarding step needed.

No code was touched this session — pure issue-tracker work, no branch
created, nothing to merge.

## Repo state

- **`feature/docker-e2e-backend-integration`**: unchanged this session,
  still at `51b5a373` (contains #421's RBAC enforcement cutover).
- No dangling branches from this session (none were created).
- Issues: **#422 closed** (split, not implemented). **#426**, **#427**,
  **#428** opened this session, chained via `Depends on:`. **#424**
  (result-permission copy-paste bug) and **#425** (backfill script
  needs to run against the dev stack) remain open from last session,
  unrelated to this split. **#386** (top-level RBAC tracking issue)
  stays open. Older backlog unchanged: **#387**, `#371`/`#373`/`#374`/
  `#378`/`#379`, **#389** (route through `divide-and-conquer` first, 28
  files).

## Blocking next step

None. **#425** (run the backfill script against any live dev stack
before its users try to log in) is still the one real prerequisite for
anyone deploying last session's #421 work to a shared environment — not
blocking this session's close.

## Recommended next steps

Dennis didn't name a specific next pick this session, so per this
skill's own rule: **none queued**. If continuing the RBAC thread, **#426**
is the correct next pick (foundational, unblocks #427 → #428). Otherwise:
**#424** (quick `fix-bugs` pick), **#425** (operational, not a coding
task), **#387**, older backlog (`#371`/`#373`/`#374`/`#378`/`#379`), or
**#389** (route through `divide-and-conquer` first).

## Which skills to use

- **#426**: route through `build-loop` — it's the foundational slice of
  the split, touches JWT/admin-gate/notification logic across ~6 files.
  Check frontend impact of the JWT payload change before removing
  `accessType`/`roleName` from the response shape (issue body flags
  this explicitly).
- **#427**: `build-loop` again, once #426 is merged — straightforward
  once nothing reads the fields directly.
- **#428**: `build-loop`, once #427 is merged — schema/seed cleanup,
  should be the smallest of the three.
- **#424**: straightforward `fix-bugs` pick — reproduce with a test
  asserting the correct permission name, fix the route.
- **#425**: not really a coding task — run the backfill script against
  whatever stack needs it, verify via the direct-Mongo-query pattern
  from the #421 session (`db.userRoleAssignments.countDocuments()`
  before/after).
- **#387**, older backlog (`#371`/`#373`/`#374`/`#378`/`#379`) —
  untouched this session, no new guidance beyond prior handoffs.
- **#389**: if picked up next, route through `divide-and-conquer` first
  per its own body (28 files, too big for one slice).
