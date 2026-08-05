# HANDOFF

**Written:** 2026-08-05, after closing #424 (result-mutation routes
gated on a result-specific permission instead of `createPatient`) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Picked #424 explicitly (Dennis: "Pick #424"). Routed via `work-issue` ->
`fix-bugs` (reproducible defect, denial logs already showed the wrong
permission name being checked).

**What #424 asked for:** `result.routes.js`'s `POST /`, `PUT /:id`,
`PUT /:id/link-sample`, and `DELETE /:id` all called
`requirePermission('createPatient')` — a copy-paste leftover. 403s still
happened in prior tests only because the accessTypes exercised lacked
both `createPatient` and the correct permission, masking the bug.

**Landed** (`fix/424-result-permission-name`, commit `34754b96`, merged
`--no-ff` into `feature/docker-e2e-backend-integration` at `d8c4603c`):
- `api/backend/src/services/rbac-catalog-seed.service.js`: added
  `createResult`/`editResult`/`deleteResult` to `PERMISSION_CATALOG`
  (resourceType `Result`), granted to `Coordenador` and `Administrador`
  — the same two roles `createPatient` was already granted to, so no
  role's actual access changes, only the permission *name* being checked.
- `api/backend/src/interface/routes/result.routes.js`: `POST /` ->
  `createResult`; `PUT /:id` and `PUT /:id/link-sample` -> `editResult`;
  `DELETE /:id` -> `deleteResult`.
- `api/backend/src/infrastructure/middleware/rbac.js`: added the three
  new codes to the `permissions` allowlist object `requirePermission()`
  checks before hitting the DB — missing this makes a route 500
  ("Permissão não definida") instead of enforcing. This is a **second,
  independently-maintained copy** of the permission set (see below).
- `api/backend/tests/factories/rbac.factory.js`: its own hand-copied
  `rolesSeed` (a **third** copy of the legacy role->permission mapping)
  also needed the three new codes added to Coordenador/Administrador,
  or fixture-backed tests would silently drift from real seeded roles.
- Tests updated: `result.routes.api.test.js` (3 test titles renamed off
  `createPatient`, one new 403 test added for `link-sample`'s
  previously-untested permission gate), `result.api.test.js` (no
  behavior change, its one pinned `deleteResult` test already asserted
  the correct permission name by title even though the code checked the
  wrong one).

Verified: targeted suite (94 tests across the 4 touched/adjacent files)
green pre-merge and post-merge. Wider sweep of every test file that
references `rbac.js`/`rbac-catalog-seed`/`rbac.factory` (36 files, 623
tests) also green post-merge — no fixture drift elsewhere.

Pushed. Closed #424 with the merge commit hash. Local + remote
`fix/424-result-permission-name` branch deleted (both succeeded this
session — no permission-classifier denial, unlike some prior sessions'
remote-delete experience).

**`wrap-up` filed #436**: the permission catalog is duplicated across 3
files (`rbac-catalog-seed.service.js`'s real seed, `rbac.js`'s hardcoded
allowlist, `rbac.factory.js`'s hand-copied test fixture) — all three had
to be edited in lockstep for this fix. Also flagged as latent in the
same issue: `viewAuditLogs` (added by #429) is missing from `rbac.js`'s
allowlist — nothing currently calls `requirePermission('viewAuditLogs')`
so it's not live, but would 500 if something did.

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed, up to date with
  `origin` as of this session's merge (`d8c4603c`). Includes this
  session's #424 fix plus all prior sessions' work (through #429).
- **`fix/424-result-permission-name`**: merged, deleted (local + remote).
- Issues: **#424 closed** (merged, see above). **#436 opened** this
  session (permission-catalog duplication + latent `viewAuditLogs` gap).
- Backlog otherwise unchanged from prior handoff: **#425** (backfill
  script, operational not coding), **#387**,
  `#371`/`#373`/`#374`/`#378`/`#379`, **#389**, plus the new **#436**.
- **dyeallpies-skills-pack#210** (RBAC blast-radius overlay note) —
  still open, not yet applied.

## Blocking next step

None. Same standing prerequisite as prior handoffs: **#425** (run the
backfill script against any live dev stack before its users try to log
in) remains the one real prerequisite for deploying #421/#429's work to
a shared environment, not blocking this session's close.

## Recommended next steps

Dennis picked #424 explicitly this session but didn't name a next pick
after it, so per this skill's own rule: **none queued** as an explicit
instruction. Backlog candidates:
- **#436** (this session's own finding — permission-catalog dedup +
  `viewAuditLogs` allowlist gap; straightforward `fix-bugs`, and worth
  doing soon since it's exactly the kind of drift that produced #424 in
  the first place)
- **#425** (operational), **#387**, older backlog
  (`#371`/`#373`/`#374`/`#378`/`#379`), or **#389** (route through
  `divide-and-conquer` first, 28 files)
- The prior handoff's `user.accessType` grep sweep (confirming the
  #427/#428/#431/#433/#434 stale-`accessType` family is fully closed
  out) still hasn't been done.

## Which skills to use

- Unchanged from prior handoffs for #425/#387/older backlog/#389.
- **#436's shape** (multiple independently-maintained copies of the same
  config/catalog data, one of them a hardcoded allowlist gating access)
  is a `fix-bugs` pickup once picked — likely worth collapsing `rbac.js`'s
  literal `permissions` object to derive from `PERMISSION_CATALOG`
  instead of removing the duplication piecemeal again next time a
  permission is added.
