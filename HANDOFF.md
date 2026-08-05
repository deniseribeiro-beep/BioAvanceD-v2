# HANDOFF

**Written:** 2026-08-05, after closing #435 (registerUser: reject invalid
`accessType` before insert, instead of orphaning a User document) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Picked #435 explicitly (Dennis: "Pick #435"). Routed through `fix-bugs`
— this was that session's own filed regression from #432, already had a
suggested fix in the issue body.

**Root cause:** #432 dropped `UserModel.isValidAccessType`'s validation
(correctly — the field is no longer schema-persisted on `User`), but
`auth.service.js`'s `registerUser` still resolved `accessType` from the
raw request body and passed it to `grantRoleForAccessType`
(`rbac-assignment.service.js`), which does still validate it via a
`ROLE_CODE_BY_ACCESS_TYPE` lookup — but only *after*
`usersCollection.insertOne(user)` had already run. An invalid
`accessType` (e.g. `99`) orphaned a User document with no
`UserRoleAssignment` and no way to authenticate correctly.

**Landed** (`fix/435-registeruser-invalid-accesstype-orphan`, commit
`76051fb7`, merged `--no-ff` into
`feature/docker-e2e-backend-integration` at `7b17cf3b`):
- `api/backend/src/services/auth.service.js`: imports
  `ROLE_CODE_BY_ACCESS_TYPE` from `rbac-assignment.service.js` (already
  exported) and validates `resolvedAccessType` against it immediately
  after it's computed, before `usersCollection.insertOne` — restores the
  old fail-fast behavior without reintroducing the retired
  `UserModel.isValidAccessType`.
- `api/backend/tests/unit/auth.service.extended.unit.test.js`: added
  `rejects an invalid accessType before inserting the user` — asserts
  both the throw and that `insertOne` was never called. Confirmed it
  failed before the fix (insertOne was called once) and passes after.

Verified: 139/139 targeted tests passing on the merged integration
branch (`auth.service.extended.unit.test.js`, `User.test.js`,
`rbac-catalog-seed.service.test.js`, `rbac-assignment.service.test.js`,
`auditLogger.test.js`, `access.api.test.js`,
`createFirstAdmin.script.test.js`, `auth.controller.test.js`).

Pushed. Closed #435 with the merge commit hash. Local + remote
`fix/435-registeruser-invalid-accesstype-orphan` branch deleted (both
succeeded this session — no permission-classifier denial).

`wrap-up` ran: no friction, nothing deferred, no new issues filed.

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed, up to date with
  `origin` as of this session's merge (`7b17cf3b`). Includes this
  session's #435 fix plus all prior sessions' work (through #432).
- **`fix/435-registeruser-invalid-accesstype-orphan`**: merged, deleted
  (local + remote).
- Issues: **#435 closed** (merged, see above). No new issues filed this
  session.
- Backlog otherwise unchanged from prior handoff: **#433** (tempToken
  accessType), **#434** (four response-body accessType fields), **#429**
  (no dedicated `auditor` RBAC role), **#424**, **#425** (backfill
  script, operational not coding), **#387**,
  `#371`/`#373`/`#374`/`#378`/`#379`, **#389**.
- **dyeallpies-skills-pack#210** (RBAC blast-radius overlay note) —
  still open, not yet applied.

## Blocking next step

None. Same prerequisite as prior handoffs: **#425** (run the backfill
script against any live dev stack before its users try to log in)
remains the one real prerequisite for deploying #421's work to a shared
environment, not blocking this session's close.

## Recommended next steps

Dennis picked #435 explicitly this session but didn't name a next pick
after it, so per this skill's own rule: **none queued** as an explicit
instruction. Continuing the RBAC thread from prior handoffs: **#433**,
**#434** (small, independent of each other and of #432/#435, now fully
resolved). Otherwise: **#429** (small, well-scoped), **#424**
(straightforward `fix-bugs`), **#425** (operational), **#387**, older
backlog (`#371`/`#373`/`#374`/`#378`/`#379`), or **#389** (route through
`divide-and-conquer` first, 28 files).

## Which skills to use

- Unchanged from prior handoffs for #433/#434/#429/#424/#425/#387/older
  backlog/#389 — see git history of this file if needed, or the issues
  themselves for current guidance.
