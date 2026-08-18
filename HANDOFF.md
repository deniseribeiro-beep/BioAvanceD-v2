# HANDOFF

**Written:** 2026-08-18, continuation session (fourteenth update). User
said "let's get 340 and 341" (institutional-scope enforcement). Ended up
shipping only the prerequisite this session — see below for why, and
what's actually next.

## What happened this session

Investigating #340/#341 surfaced that wiring org-scope enforcement wasn't
a two-issue job: `UserRoleAssignment` already has dormant
`scopeType`/`scopeId` fields (dict-02 P1X-0228/0229) designed for exactly
this, but every assignment was hardcoded `scopeType: 'global'` — nothing
read it back. Confirmed four product decisions with Dennis (org-less
user → hard 403; only Administrador/hierarchyLevel-4 bypasses scoping,
`auditor` stays scoped; out-of-scope existing record → 403 not 404;
scope source is `UserRoleAssignment.scopeType`/`scopeId` via an explicit
org param threaded from the same user create/edit request, not
auto-derived). That last decision made the wiring itself a genuine
architectural change per `divide-and-conquer`'s design-split playbook —
split it out as **#615** (confirmed with Dennis before filing), landed it
solo this session, and #340/#341 are now the next iterations, unstarted.

## Issue closed this session

- **#615** ("Wire UserRoleAssignment.scopeType/scopeId for
  organization-scoped role assignments"): `rbac-assignment.service.js`'s
  `grantRoleForAccessType`/`changeUserRole`/`grantAdditionalRole`/
  `backfillUserRoleAssignments` now resolve real `scopeType`/`scopeId`
  via a shared `resolveScopeForRole` helper (hierarchyLevel-4 bypass,
  everyone else org-scoped). New `updateAssignmentScope` (org-only edits,
  no revoke/re-grant — avoids silently dropping an `auditor` grant) and
  `resolveUserOrganizationScope` (the resolver #340/#341 will consume,
  returns `{ scope: 'global'|'organization'|'unassigned'|'none',
  organizationIds }`). Wired `auth.service.js#registerUser` and
  `user.routes.js`'s `PUT /:id` (including the org-changed-but-role-
  didn't path) to thread `organizationId` through — no new UI needed,
  `NewUserPage.tsx` already had the org selector. New
  `migrateRoleAssignmentScopes.js` backfills pre-existing assignments.
  52/52 targeted tests green (29 unit + 8 unit + 3 + 12 integration, all
  mocked-Mongo per the build-loop overlay's backend-internal-slice proof
  bar — no live-Mongo tier in this repo, Docker not needed for this
  slice). Lint (syntax check) clean. Merged `b84ecefb` on
  `feature/docker-e2e-backend-integration`, pushed, closed.
  **No enforcement-visible behavior change** — nothing reads
  `scopeType`/`scopeId` for authorization yet; that's #340/#341.

## Other work this session

- Commented on #340 and #341 recording the four confirmed edge-case
  decisions and the new `Depends on: #615` (now landed — resolver is
  available).
- **Filed #616**: pre-existing bug found during investigation —
  `PUT /api/users/:id` silently drops a user's additive `auditor` role
  when `accessType` changes without the same request also resending
  `auditorRole`. Matters more now since #615's resolver depends on
  assignment state being accurate. Not fixed this session (changes
  existing route behavior, outside #615's stated no-behavior-change
  scope).
- **Filed #617**: `organizationId` (and now `scopeId`) accepted on user
  create/edit with no referential check against a real `Organization`
  document — fails safe (scopes to nothing, not something wrong) but is
  a silent data-quality/support-debugging gap. Lower priority than #616.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed after #615 landed.
  Working tree clean except the gitignored/junctioned `.claude/skills/`.
  Local branch `test/615-scope-assignment-org-wiring` still exists
  (merged, not yet deleted — safe to delete, just didn't get to it before
  ending the session).
- No Docker stack was brought up this session — #615 is a backend-
  internal slice, proof bar was mocked-Mongo tests per the build-loop
  overlay, not literal Docker/live DB.
- `migrateRoleAssignmentScopes.js` is written and unit-tested but has
  **not been run against any real database** (dev or otherwise) — same
  as its `migrateUserOrganizations.js` precedent, it's a one-time ops
  script meant to run once #340/#341's enforcement is about to go live,
  not automatically as part of landing #615.

## Recommended next steps

User's explicit next target, in order:
1. **#340** (sample/patient list+detail org-scope enforcement) — the
   product decisions are already settled (see #615/#340's comments);
   this is now a build-loop slice wiring `resolveUserOrganizationScope`
   into `sample.service.js#listSamples`/`patient.service.js#listPatients`
   and the two detail/get-by-id endpoints, plus running
   `migrateRoleAssignmentScopes.js` against whichever DB the proof runs
   against before the enforcement test can pass.
2. **#341** (reports/dashboards org-scope enforcement) — depends on #340
   landing first per its own `Depends on:` line; scopes
   `reports.routes.js`'s `buildSampleQuery`/`buildPreviewData`.

Not user-requested but worth a look when convenient (found this session,
not blocking #340/#341):
3. **#616** — auditor-role-drop bug, small and unambiguous once picked up.
4. **#617** — organizationId referential-validation gap, lower priority.
