# HANDOFF

**Written:** 2026-08-05, after closing #436 (permission-catalog
duplication + latent `viewAuditLogs` gap, found via #424) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Picked #436 explicitly (Dennis: "Pick #436"). Routed via `work-issue` ->
`fix-bugs` — a structural drift bug, not ambiguous, no design call
needed.

**What #436 asked for:** three independently-maintained copies of the
RBAC permission catalog had to be edited in lockstep (as #424 found the
hard way): `rbac-catalog-seed.service.js`'s real `PERMISSION_CATALOG` /
`LEGACY_ROLES_SEED`, `rbac.js`'s hardcoded `permissions` allowlist
gating `requirePermission()`, and `rbac.factory.js`'s hand-copied test
`rolesSeed`. Also flagged: `viewAuditLogs` (added by #429) was missing
from `rbac.js`'s allowlist — latent, would 500 instead of enforcing if
anything ever called `requirePermission('viewAuditLogs')`.

**Landed** (`fix/436-rbac-catalog-dedup`, commit `833ea91e`, merged
`--no-ff` into `feature/docker-e2e-backend-integration` at `e4ec70d0`):
- `api/backend/src/infrastructure/middleware/rbac.js`: `permissions`
  allowlist now derives its keys from `PERMISSION_CATALOG` (imported
  from `rbac-catalog-seed.service.js`) instead of a separately
  maintained literal — collapses the 2nd copy and fixes the
  `viewAuditLogs` gap as a side effect (it's already in the catalog).
- `api/backend/src/services/rbac-catalog-seed.service.js`: now exports
  `LEGACY_ROLES_SEED` (previously internal-only).
- `api/backend/tests/factories/rbac.factory.js`: `rolesSeed` now points
  at the imported `LEGACY_ROLES_SEED` instead of a hand-copied literal
  — collapses the 3rd copy.
- `api/backend/tests/unit/rbac.test.js`: added a test asserting every
  `PERMISSION_CATALOG` key is present in the exported `permissions` map
  (this is the reproduction — failed pre-fix on `viewAuditLogs`, passes
  post-fix).
- Only one real source of truth left: `PERMISSION_CATALOG` /
  `LEGACY_ROLES_SEED` in `rbac-catalog-seed.service.js`. No role's
  actual granted permissions changed.

Verified: targeted `rbac.test.js` green pre/post-fix (reproduction
failed correctly before the fix). Wider sweep of the same 36-file/623+
test set from #424's session (every file referencing
`rbac.js`/`rbac-catalog-seed`/`rbac.factory`) — 50 test files, 1004
tests, all green post-merge.

Pushed. Closed #436 with the merge commit hash. Local + remote
`fix/436-rbac-catalog-dedup` branch deleted — both succeeded this
session with no permission-classifier denial (prior handoffs noted
remote-delete is sometimes denied for branches not pushed this same
session; this branch was pushed and merged within this session, matching
the pattern where it succeeds).

## Repo state

- **`feature/docker-e2e-backend-integration`**: pushed, up to date with
  `origin` as of this session's merge (`e4ec70d0`). Includes this
  session's #436 fix plus all prior sessions' work (through #424/#429).
- **`fix/436-rbac-catalog-dedup`**: merged, deleted (local + remote).
- Issues: **#436 closed** (merged, see above).
- Backlog otherwise unchanged from prior handoff: **#425** (backfill
  script, operational not coding), **#387**,
  `#371`/`#373`/`#374`/`#378`/`#379`, **#389**.
- **dyeallpies-skills-pack#210** (RBAC blast-radius overlay note) —
  still open, not yet applied.

## Blocking next step

None. Same standing prerequisite as prior handoffs: **#425** (run the
backfill script against any live dev stack before its users try to log
in) remains the one real prerequisite for deploying #421/#429's work to
a shared environment, not blocking this session's close.

## Recommended next steps

Dennis picked #436 explicitly this session but didn't name a next pick
after it, so per this skill's own rule: **none queued** as an explicit
instruction. Backlog candidates:
- **#425** (operational), **#387**, older backlog
  (`#371`/`#373`/`#374`/`#378`/`#379`), or **#389** (route through
  `divide-and-conquer` first, 28 files)
- The prior handoff's `user.accessType` grep sweep (confirming the
  #427/#428/#431/#433/#434 stale-`accessType` family is fully closed
  out) still hasn't been done — carried forward two handoffs now.

## Which skills to use

- Unchanged from prior handoffs for #425/#387/older backlog/#389.
- The RBAC-catalog dedup pattern from #436 (one real source of truth,
  everything else derives/imports from it) is now in place — if a
  future permission is added, only `rbac-catalog-seed.service.js` needs
  editing; `rbac.js` and `rbac.factory.js` pick it up automatically.
