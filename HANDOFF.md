# HANDOFF

**Written:** 2026-08-18, continuation session (eighteenth update). User said
"continue with #616 + #617" — **still inside the rabbit hole**, tracker
**#618** ("organization-scope enforcement + RBAC gaps (seeds #340, #341,
#616, #617, #602)"). Two items landed this sitting (#616, #617); this is a
reasonable stopping point per the budget note below.

## Rabbit hole state

- **Tracker:** #618, open. Original working order: #340 → #341 → #616 →
  #617 → #602 (#340/#341 already landed a prior sitting).
- **Landed this sitting:** #616, #617.
- **Still queued:** #602, #619, #620, #621, and a new small item **#622**
  (filed this sitting as a direct follow-up to #617).
- **Budget note:** #616 and #617 were both "medium" items (~2-3 points
  each, ~5 total) against the skill's ~10-point advisory sitting
  allowance. Budget remains, but #602 needs a product/design call with
  Dennis before it can proceed (same as #341 did) — the next picks that
  don't need his input first are #619/#620/#621/#622. Reasonable point to
  ask Dennis whether to continue this sitting or resume later.

## Issues closed this session

- **#616** ("PUT /api/users/:id silently drops the additive auditor role
  when accessType changes without resending auditorRole"):
  `rbac-assignment.service.js`'s `changeUserRole` now joins the user's
  active assignments against the `roles` collection and only revokes the
  assignment(s) whose `roleCode` is one of `ROLE_CODE_BY_ACCESS_TYPE`'s
  values (the primary/accessType-derived role) — additive assignments
  like `auditor` (#429) are left untouched. Reproduced with a failing
  unit test first, 74 targeted tests green. Merged `142f02628` into
  `feature/docker-e2e-backend-integration`, fix branch deleted local +
  remote, closed with the merge hash commented on the issue.

- **#617** ("organizationId accepted on user create/edit with no
  referential check against a real Organization"): `user.routes.js`'s
  `POST /register` and `PUT /:id` now validate a truthy `organizationId`
  against the `organizations` collection (400 if not found), mirroring
  `sample.service.js`'s existing `collectionSite` check (ELM-0128).
  Scoped deliberately to the two route entry points named in the issue —
  did **not** add a second check inside `rbac-assignment.service.js`'s
  grant functions (see #622 below). Reproduced with two failing tests
  first; also had to update three pre-existing tests (one in
  `users.api.test.js`, two PUT tests in `users-access.routes.test.js`)
  to mock a resolvable `organizations` collection, since they exercised
  the now-validated path with fabricated `organizationId` values.
  75 targeted tests green. Merged `82986a0c` into
  `feature/docker-e2e-backend-integration` at `edb88624`, fix branch
  deleted local + remote, closed with the merge hash commented on the
  issue.

## Filed this session

- **BioAvanceD-v2#622**: `rbac-assignment.service.js`'s grant functions
  (`grantRoleForAccessType`, `grantAdditionalRole`, `updateAssignmentScope`,
  `changeUserRole`) still don't validate `organizationId` themselves —
  reachable via ops scripts (`createFirstAdmin.js`,
  `migrateRoleAssignmentScopes.js`, `backfillUserRoleAssignments`) that
  bypass the route-level check #617 added. Low severity (same fail-safe
  shape as #617/#615), added to the #618 tracker.
- **dyeallpies-skills-pack#336** (not a BioAvanceD-v2 issue):
  `edit-branch-guard.cjs` correctly blocked the first Edit call of this
  session (on `feature/docker-e2e-backend-integration`, for #616) but
  silently let **seven consecutive Edit calls** through on the same
  protected branch later in the same session (for #617) — only caught
  when a manual `git status` check was run before committing, not by the
  hook itself. **Heads up for future sessions on this repo: don't rely
  solely on the hook to catch a missing `fix/`/`test/` branch — verify
  `git branch --show-current` before the first Edit of each new pick,
  since this session showed the hook can silently stop firing partway
  through a session.**

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed after both #616 and
  #617 landed (`142f02628`, then `edb88624`). Working tree clean except
  the gitignored/junctioned `.claude/skills/`. No stale local branches —
  both fix branches (`fix/616-...`, `fix/617-...`) were deleted local +
  remote after merging.
- No Docker stack was brought up this session — both #616 and #617 are
  backend-internal fixes, proof bar was mocked-Mongo tests per the
  fix-bugs overlay, not literal Docker/live DB.
- `migrateRoleAssignmentScopes.js` (from #615) is still unrun against any
  real database — unrelated to this session's work, unchanged.

## Recommended next steps

Continuing the rabbit hole (tracker #618), in order:
1. **#602** — `PERMISSION_CATALOG.allowedActions` decorative-only gap.
   Explicitly flagged in its own body as needing a product/design call
   before a fix shape exists — check in with Dennis when picked up rather
   than guessing a shape, same as #341 needed.
2. **#619** — sample/patient sub-resource/mutation route org-scope gap.
3. **#620** — dead-code withdrawal-history report type.
4. **#621** — non-sample-rooted org-scope gap (temperature/sensor/
   equipment/results/logs report types, saved-report listing, GET
   /api/results).
5. **#622** (new, small) — validate `organizationId` inside
   `rbac-assignment.service.js` itself (e.g. in `resolveScopeForRole`)
   rather than relying on callers, closing the gap for the ops scripts
   too.

Given the budget note above, #619/#620/#621/#622 are reasonable next
picks in this same sitting without needing further input; #602 needs
Dennis's input first, same as #341 did.
