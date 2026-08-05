# HANDOFF

**Written:** 2026-08-05, after closing #432 (RBAC: drop accessType/
roleName fields from User schema; retire roles.min.json) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Picked #432 explicitly (Dennis: "Pick #432"). Routed through
`work-issue` → `resolve-issue` (feature/refactor shape, not a bug/test/
build gap).

#432 depended on #431 (already merged: JWT `accessType` claim now
resolves live via `resolveUserHierarchyLevel` instead of the stale User
field). Confirmed against `docs/docs-7-27-2026/extracted/
dict-02_DICIONARIO.md` (P1X-0191/P1X-0244) that `UserAccount.
accessTypeLegacy` is already documented as legacy/extension-local, not
canonical — `primaryRoleId` via `UserRoleAssignment` is the real source
of truth. That confirmed the issue's premise and cleared the way to drop
the fields.

**Landed** (`fix/432-rbac-drop-accesstype-fields`, commit `7688befe`,
merged `--no-ff` into `feature/docker-e2e-backend-integration` at
`53f84d4f`):
- `api/backend/src/models/User.js`: dropped `accessType`/`roleName`
  validation, default-assignment, `isValidAccessType`, `getRoleName`.
- `api/backend/src/services/auth.service.js`: fixed `registerUser`,
  which relied on `UserModel.create()`'s output still carrying
  `accessType` before deleting it — now reads `userData.accessType`
  directly (same `|| 2` default). This was a same-session, in-scope fix
  (the removal would otherwise have silently broken role-granting on
  every registration), not a deferred follow-up.
- Deleted `api/backend/src/reference-data/roles.min.json` and its test
  fixture duplicate (`tests/fixtures/reference-data/roles.min.json`).
  Its only remaining consumer, `tests/factories/rbac.factory.js`, now
  inlines the seed data directly (same pattern
  `rbac-catalog-seed.service.js` already used since #428).
- Swept stale comments: `Role.js` header, `security.routes.js`'s
  `requireRole(4)` comment, `rbac-catalog-seed.service.js`'s two error
  messages (renamed from "roles.min.json referencia..." to
  "LEGACY_ROLES_SEED referencia...").
- **Left untouched, deliberately:** `catalog.1.3.0.json`'s
  `accessTypeLegacy` dictionary rows and their `roles.min.json`
  provenance notes — `dict-02_DICIONARIO.md` already documents that
  field as legacy/extension-local, and the catalog is a generated
  mirror of an externally-sourced spreadsheet, not a code artifact to
  retire. Recorded this reasoning in the close comment (resolve-issue's
  "confirmed, no change needed" case).
- Updated `tests/unit/models/User.test.js`: dropped the
  `isValidAccessType()`/`getRoleName()` describe blocks and the
  `accessType`-specific assertions in `create()`'s two tests — pinned
  retired behavior, not product bugs.

Verified: 238/238 targeted tests passing on the merged integration
branch (`User.test.js`, `auth.service.*.unit.test.js`,
`rbac-catalog-seed.service.test.js`, `rbac-assignment.service.test.js`,
`auditLogger.test.js`, `access.api.test.js`,
`createFirstAdmin.script.test.js`).

Pushed. Closed #432 with a summary comment. Local + remote
`fix/432-rbac-drop-accesstype-fields` branch deleted (both succeeded
this time — no permission-classifier denial, unlike the #430 session's
remote-delete block).

**Found during this session's own wrap-up audit, filed as its own
issue (not fixed inline — #432 was already merged/closed by the time
this surfaced):** #435 — the `registerUser` fix above changed validation
ordering. Before #432, `UserModel.validate()` rejected an invalid
`accessType` *before* any DB write. Now the only remaining check is
`grantRoleForAccessType`'s `ROLE_CODE_BY_ACCESS_TYPE` lookup, which
throws *after* `usersCollection.insertOne(user)` has already run —
an invalid `accessType` in a registration request now orphans a User
document with no role assignment instead of being rejected upfront.
Real regression, filed as `bug`, not yet fixed.

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed, up to date with
  `origin` as of this session's merge (`53f84d4f`). Includes this
  session's #432 fix plus all prior sessions' work.
- **`fix/432-rbac-drop-accesstype-fields`**: merged, deleted (local +
  remote).
- Issues: **#432 closed** (merged, see above). **#435 filed** this
  session (open, `bug` label) — the registerUser orphan-on-invalid-
  accessType regression described above.
- Backlog otherwise unchanged from prior handoff: **#433** (tempToken
  accessType), **#434** (four response-body accessType fields), **#429**
  (no dedicated `auditor` RBAC role), **#424**, **#425** (backfill
  script, operational not coding), **#387**,
  `#371`/`#373`/`#374`/`#378`/`#379`, **#389**.
- **dyeallpies-skills-pack#210** (RBAC blast-radius overlay note) —
  still open, not yet applied.

## Blocking next step

None outright, but **#435 is worth prioritizing** — it's a genuine
data-integrity regression this session introduced (orphaned User
documents on invalid `accessType` input), small and well-scoped to fix
(validate `resolvedAccessType` against `ROLE_CODE_BY_ACCESS_TYPE`'s keys
before the `insertOne` in `auth.service.js`'s `registerUser`).

Same prerequisite as prior handoffs: **#425** (run the backfill script
against any live dev stack before its users try to log in) remains the
one real prerequisite for deploying #421's work to a shared environment,
not blocking this session's close.

## Recommended next steps

Dennis picked #432 explicitly this session but didn't name a next pick
after it, so per this skill's own rule: **none queued** as an explicit
instruction — but **#435** is the natural pick given it's this session's
own regression and is small/well-scoped. Otherwise, continuing the RBAC
thread: **#433**, **#434** (small, independent of each other and of
#432, now fully resolved). Otherwise: **#429** (small, well-scoped),
**#424** (straightforward `fix-bugs`), **#425** (operational), **#387**,
older backlog (`#371`/`#373`/`#374`/`#378`/`#379`), or **#389** (route
through `divide-and-conquer` first, 28 files).

## Which skills to use

- **#435**: `fix-bugs` — reproducible defect (orphaned User document),
  already has a suggested fix in the issue body.
- Unchanged from prior handoffs for #433/#434/#429/#424/#425/#387/older
  backlog/#389 — see git history of this file if needed, or the issues
  themselves for current guidance.
