# HANDOFF

**Written:** 2026-08-05, after shipping the runtime-cutover slice of #428
on `feature/docker-e2e-backend-integration`.

## What happened this session

Picked #428 ("drop `accessType`/`roleName` fields and `roles.min.json`
entirely," depends on #427 which shipped last session), routed through
`build-loop`. A grep sweep before writing anything showed the issue's
literal 3 bullets (schema drop, seed-source switch, doc/test sweep)
undersold the real scope — `accessType`/`roleName` were still
load-bearing at runtime in `auth.routes.js` (JWT payload + `GET
/verify` response), `auditLogger.js`'s fallback, and audit-trail
`userRole` reads in several sample controllers. Routed through
`divide-and-conquer` mid-session rather than forcing the full scope
through one slice.

**Landed this session** (the load-bearing, safe-to-ship-alone piece):
- `rbac-catalog-seed.service.js`'s seed source switched off
  `roles.min.json` onto an inlined literal table (byte-identical data)
  — matches issue #428's 2nd bullet.
- `auth.routes.js`'s `GET /verify` was found to still read
  `user.accessType`/`user.roleName` straight off the User document,
  which #427 stopped populating — already wrong for any user
  created/edited after #427 shipped. Fixed to resolve both from the
  active RBAC assignment via `rbac-assignment.service.js`'s
  `resolveRoleDisplayName`/`resolveUserHierarchyLevel`, same pattern
  #427 used for `user.routes.js`.
- Confirmed (read `infrastructure/middleware/rbac.js`) that none of
  this touches security enforcement — `requireRole`/`requirePermission`
  already resolve fresh from `UserRoleAssignment -> Role` every
  request, never from `req.user.accessType`. The stale field is a
  display/audit-label concern only.

Updated tests: `auth.routes.test.js`, `auth.routes.branch-coverage.test.js`
(both had tests asserting the old accessType→roleName translation-map
behavior; rewrote them against `rbac.factory.js`'s `buildRbacCollections`
mock instead).

Full backend suite: **6524/6525 passing** — the one failure
(`iot.api.test.js`'s cold-chain quarantine assertion) is the
pre-existing, already-filed **#430**, unrelated to this change.

**Filed as follow-ups** (the descoped remainder of #428):
- **#431** — JWT payload (`auth.service.js#issueAccessToken`,
  `auth.routes.js`'s `/refresh`) still signs `accessType: user.accessType`
  off the stale field. Confirmed not a security issue (enforcement
  never reads it), but fixing it means threading `db` into a currently-
  synchronous token-issuance path and touching every test in
  `auth.service.unit.test.js` that asserts the current signature —
  bigger and riskier than this slice.
- **#432** — the actual schema-field drop (`User.js`), `roles.min.json`
  file deletion, and the docs/comments/dictionary sweep. Depends on
  #431. Also documents that `Access.js`'s `accessType` field is an
  **unrelated concept** (report-access levels, not RBAC user roles) and
  must NOT be touched by this series — #428's own issue text mis-scoped
  it in.

Committed on `test/428-rbac-retire-legacy-fields`, merged (`--no-ff`)
into `feature/docker-e2e-backend-integration` at
`fb2ff9fc...` (see `git log` for the full merge commit hash — check
`git log --oneline -5` on this branch), closed #428 with that reference.

## Repo state

- **`feature/docker-e2e-backend-integration`**: now 7 commits ahead of
  `origin/feature/docker-e2e-backend-integration` (this session's #428
  slice + prior sessions' #426/#427 work) — not pushed yet (per
  convention: push is cheap/no-CI, but still confirm with Dennis before
  pushing/opening a PR).
- **`test/428-rbac-retire-legacy-fields`**: merged, safe to delete once
  Dennis confirms; not deleted this session.
- Issues: **#428 closed** (merged, narrowed scope, see above). **#431**
  and **#432** opened this session as its follow-ups. **#429** (no
  dedicated `auditor` RBAC role yet) and **#430** (pre-existing
  `iot.api.test.js` failure) still open from earlier sessions. Older
  backlog unchanged: **#424**, **#425**, **#387**,
  `#371`/`#373`/`#374`/`#378`/`#379`, **#389**.
- **dyeallpies-skills-pack#210** (filed last session, asking for a
  build-loop overlay note about this RBAC series underselling its blast
  radius) — still open, not yet applied; this session's own
  divide-and-conquer routing is itself further evidence for it, worth
  mentioning if anyone follows up on that pack issue.

## Blocking next step

None. **#425** (run the backfill script against any live dev stack
before its users try to log in) remains the one real prerequisite for
deploying #421's work to a shared environment — not blocking this
session's close. **#432 depends on #431** — don't pick #432 first.

## Recommended next steps

Dennis didn't name a specific next pick this session, so per this
skill's own rule: **none queued**. If continuing the RBAC thread,
**#431** (JWT payload accessType claim) is the natural next pick — it's
independent of everything else open and unblocks #432. Otherwise:
**#429** (auditor role, small/well-scoped), **#430** (pre-existing test
bug, needs investigation before it's a `fix-bugs` pick), **#424**,
**#425** (operational, not a coding task), **#387**, older backlog
(`#371`/`#373`/`#374`/`#378`/`#379`), or **#389** (route through
`divide-and-conquer` first).

## Which skills to use

- **#431**: `build-loop`-shaped (token-issuance behavior change with a
  test to prove it), but likely small enough to fit one iteration
  without its own further split — thread `db` into `issueAccessToken`,
  resolve `resolveUserHierarchyLevel`, update
  `tests/unit/auth.service.unit.test.js`.
- **#432**: `build-loop`, depends on #431. Also touches
  `tests/factories/rbac.factory.js` (currently reads `roles.min.json`
  directly for fixture data — needs its own inline copy once the file
  is deleted) and `docs/architecture/`,
  `catalog.1.3.0.json`'s `accessTypeLegacy` dictionary rows. **Do not
  touch `Access.js`** — see the issue body for why.
- **#429**: small, well-scoped — `build-loop` or could be folded into
  #432 if convenient, but stands alone fine.
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
