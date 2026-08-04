# HANDOFF

**Written:** 2026-08-04, after shipping #420 (RBAC foundational slice) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Dennis said "Pick #420". Routed via `work-issue` → `build-loop` (dict-02
P1X-0209..0237: additive `Role`/`Permission`/`UserRoleAssignment`
models + seed, slice 1 of 3 from #386's `divide-and-conquer` split
filed last session).

Confirmed target fields against the primary docs (`dict-02_DICIONARIO.md`
rows P1X-0209..0238, `requisitos-index.md` RNF008) before writing any
code, per `build-loop`'s primary-source-over-paraphrase rule — no
`docs/architecture/` summary exists for RBAC yet, so nothing to update
there.

Built on branch `test/420-rbac-role-permission-models` (this repo's
no-dedicated-prefix fallback):
- **`api/backend/src/models/Role.js`**, **`Permission.js`**,
  **`UserRoleAssignment.js`** — plain validator-class models (this
  repo's convention for additive collection entities — see
  `RcsAssessment.js`/`ConsentTemplate.js` precedent, not literal
  Mongoose schemas), matching every dict-02 field, with `randomUUID()`
  defaults for the id fields.
- **`api/backend/src/config/collections.js`** — added `roles`,
  `permissions`, `userRoleAssignments` canonical collection keys.
- **`api/backend/src/services/rbac-catalog-seed.service.js`** —
  `seedRolesAndPermissions(db)`, idempotent (upserts by
  `roleCode`/`permissionCode`, dict-02's own "índice único" fields, not
  `_id`), populating Role/Permission from `roles.min.json`'s 4 legacy
  roles. `resourceType`/`allowedActions` per permission aren't in
  `roles.min.json` — seeded from a hand-built `PERMISSION_CATALOG`
  mapping table in the service file (documented in-file as this seed's
  own best-effort mapping, not a copied source value).
- **`api/backend/src/scripts/seedRbacCatalog.js`** — thin CLI entrypoint
  wrapping the service (`connectDB`/`closeConnection`), same shape as
  `seedDiseaseValidationRules.js`.
- Unit tests (19 new, all passing): one file per model plus a seed
  service test using a real-query-matching fake collection
  (`findOne`/`insertOne`), proving idempotency (second seed run doesn't
  duplicate or re-mint ids) — this repo's native-only "real backend"
  proof bar for a backend-internal slice (no live Mongo tier exists
  here).
- Fixed **`tests/unit/config/collections.test.js`**: its `DEFAULTS` and
  one exhaustive-shape assertion hardcoded every `CANONICAL_COLLECTIONS`
  key — adding the 3 new keys broke it (3 assertions failed on the
  first full-suite run) until the 3 new keys were added there too. This
  is the one existing-test edit in the diff; everything else is new
  files, per #420's additive-only scope boundary.

Verified: targeted vitest runs for all new/changed files pass; repo
lint (`node scripts/lint.js`) passes; a plain full `npx vitest run`
(no `--coverage`) showed the same 4 failures (now fixed) and nothing
else — confirming the slice doesn't regress anything else. **Filed
#423** for an unrelated finding: the documented coverage-reconcile
exemption command (`--coverage` over 3 dirs) reported 76 failures
(JWT/encryption null-secret errors) that don't reproduce in a plain
run — looks like a `--coverage`-specific env-loading issue, not a real
regression, but makes that verification step unreliable as currently
documented. Not investigated further (out of scope, touches no
crypto/JWT code).

Committed, merged `test/420-rbac-role-permission-models` into
`feature/docker-e2e-backend-integration` (merge commit `f5c38df7`),
pushed, closed #420 referencing the merge hash. Deleted the merged
local branch.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `f5c38df7`, pushed
  (was `795b3849`). Contains #420's RBAC models/seed, additive only —
  no runtime behavior change (`accessType`/`roleName` still sole
  enforcement authority).
- No dangling branches.
- Issues: **#420 closed** (merged, referenced merge hash in close
  comment). **#423 opened** this session (coverage-run env flakiness,
  unrelated finding, not blocking). Backlog otherwise unchanged:
  **#421** (blocked on #420 — now unblocked), **#422** (blocked on
  #421), **#386** (tracking issue, stays open per prior session's
  divide-and-conquer split), **#387**, older backlog
  (`#371`/`#373`/`#374`/`#378`/`#379`), **#389** (route through
  `divide-and-conquer` first, 28 files).

## Blocking next step

None.

## Recommended next steps

Dennis didn't name a specific next pick this session, so per this
skill's own rule: **none queued**. If continuing the RBAC thread,
**#421** is now unblocked (depends on #420, which is done) — it's the
atomic `requirePermission` + read-path cutover, security-relevant, and
must re-prove RF002/RF003's e2e RBAC coverage against the new model
before being considered done (not just unit-test the new middleware
path in isolation). Otherwise backlog: **#387**, older backlog
(`#371`/`#373`/`#374`/`#378`/`#379`), and **#389** (route through
`divide-and-conquer` first, 28 files).

## Which skills to use

- **#421**: route through `build-loop` when picked up (Docker on by
  default per that loop's overlay, since #421 does need to re-prove
  e2e RBAC coverage — unlike #420, which was correctly scoped as a
  backend-internal slice not needing Docker). Depends only on #420,
  now merged.
- **#422**: depends on #421 — don't pick up before #421 lands.
- **#423**: whoever picks this up should check whether it's really a
  `--coverage` config/env-loading bug (vitest workers not inheriting
  `.env`) before assuming it's flaky-test noise — the failure pattern
  (consistently null JWT/encryption secrets, only under `--coverage`)
  looks systematic, not random.
- **#387**, older backlog
  (`#371`/`#373`/`#374`/`#378`/`#379`) — untouched this session, no new
  guidance beyond prior handoffs.
- **#389**: if picked up next, route through `divide-and-conquer` first
  per its own body (28 files, too big for one slice) — don't attempt as
  one iteration.
