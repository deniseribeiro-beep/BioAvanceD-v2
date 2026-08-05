# HANDOFF

**Written:** 2026-08-05, after shipping #427 (RBAC write-path cutover) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Picked #427 (slice 2 of #422's split, depends on #426 which shipped last
session), routed through `build-loop`. Issue text named 3 write paths to
stop dual-writing `accessType`/`roleName` onto the User document:

- `auth.service.js#registerUser`
- `scripts/createFirstAdmin.js`
- `PUT /api/users/:id` (`user.routes.js`)

All three now resolve `accessType` only transiently (to grant/change the
matching `UserRoleAssignment` via `rbac-assignment.service.js`'s
`grantRoleForAccessType`/`changeUserRole`, both from #421) and no longer
persist `accessType`/`roleName` on the document itself.

Doing only the literal 3-file change would have silently broken every
*display* read still computing `roleName` from the now-unpopulated
field (login response, first-login MFA setup response, `GET /api/users`
list, the PUT response itself) — every user created/edited after this
slice would show a wrong default role name. Fixed by adding
`rbac-assignment.service.js`'s new `resolveRoleDisplayName` helper and
repointing those reads onto it, mirroring #426's pattern for the
*gating* reads. JWT payload construction (`accessType` claim) was
deliberately left untouched, matching #426's precedent — but expect
**#428** (dropping the fields from `User.js`/`Access.js` entirely) to
force that question for real.

Updated/added tests: `auth.service.extended.unit.test.js`,
`createFirstAdmin.script.test.js`, `users-access.routes.test.js` (new
PUT /:id coverage — that endpoint had none before this session).

Full backend suite: **6524/6525 passing** — the one failure
(`iot.api.test.js`'s cold-chain quarantine assertion) is the
pre-existing, already-filed **#430**, unrelated to this change.

Filed **dyeallpies-skills-pack#210**: asked the pack maintainer to add a
note to `build-loop`'s BioAvanceD-v2 overlay flagging that this RBAC
retirement series' issues can undersell their own blast radius (an
issue's literal file list named only write paths; the display-read
fallout wasn't mentioned but was real). Not yet applied — pack skill
files aren't editable from this repo (Rule 0).

Committed on `test/427-rbac-write-path-cutover`, merged (`--no-ff`) into
`feature/docker-e2e-backend-integration` at
`d29ebb145af4b630757781b60414aa9ed10bbce3`, closed #427 with that hash.

## Repo state

- **`feature/docker-e2e-backend-integration`**: now at the #427 merge
  commit (`d29ebb14...`), ahead of
  `origin/feature/docker-e2e-backend-integration` by 6 commits (this
  session's + last session's #426 work) — not pushed yet (per
  convention: push is cheap/no-CI, but still confirm with Dennis before
  pushing/opening a PR).
- **`test/427-rbac-write-path-cutover`**: merged, safe to delete once
  Dennis confirms; not deleted this session.
- Issues: **#427 closed** (merged, see above). **dyeallpies-skills-pack#210**
  opened this session (pack tracker, not this repo's). **#428** (drop
  `accessType`/`roleName` fields and `roles.min.json` entirely) is now
  unblocked — its dependency (#427) is done. **#429** (no dedicated
  `auditor` RBAC role yet) and **#430** (pre-existing `iot.api.test.js`
  failure) still open from last session. Older backlog unchanged:
  **#424**, **#425**, **#387**, `#371`/`#373`/`#374`/`#378`/`#379`,
  **#389**.

## Blocking next step

None. **#425** (run the backfill script against any live dev stack
before its users try to log in) remains the one real prerequisite for
deploying #421's work to a shared environment — not blocking this
session's close.

## Recommended next steps

Dennis didn't name a specific next pick this session, so per this
skill's own rule: **none queued**. If continuing the RBAC thread,
**#428** is the natural next pick (depends on #427, now satisfied) —
route through `build-loop`, and read the new build-loop overlay note
(once dyeallpies-skills-pack#210 lands) before starting, since dropping
the fields from the schema will likely force the JWT-payload question
#426/#427 both deliberately deferred. Otherwise: **#429** (add a real
`auditor` RBAC role — small, well-scoped, could also be folded into
#428 if convenient), **#430** (pre-existing test bug, needs
investigation before it's a `fix-bugs` pick), **#424**, **#425**
(operational, not a coding task), **#387**, older backlog
(`#371`/`#373`/`#374`/`#378`/`#379`), or **#389** (route through
`divide-and-conquer` first).

## Which skills to use

- **#428**: `build-loop`. Note: should probably land after or alongside
  #429 (auditor role), since #428 retiring `roleName` entirely would
  silently break the auditor substring fallback in `logs.routes.js`
  (flagged in #426's handoff, still true). Will likely need to touch
  JWT payload construction — #426/#427 both deliberately left it alone,
  but the field won't exist anymore once #428 drops it from the schema.
- **#429**: small, well-scoped — `build-loop` or could be folded into
  #428 if convenient, but stands alone fine.
- **#430**: needs investigation first (is it `resolveCollectionName`
  aliasing, or a test-mock gap?) before it's clearly a `fix-bugs` pick —
  the issue body has a `console.log`-the-resolved-name suggestion to
  start with.
- **#424**: straightforward `fix-bugs` pick — reproduce with a test
  asserting the correct permission name, fix the route.
- **#425**: not a coding task — run the backfill script against
  whatever stack needs it, verify via the direct-Mongo-query pattern
  from the #421 session.
- **#387**, older backlog (`#371`/`#373`/`#374`/`#378`/`#379`) —
  untouched this session, no new guidance beyond prior handoffs.
- **#389**: if picked up next, route through `divide-and-conquer` first
  per its own body (28 files, too big for one slice).
