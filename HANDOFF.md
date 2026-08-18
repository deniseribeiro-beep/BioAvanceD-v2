# HANDOFF

**Written:** 2026-08-18, continuation session (seventeenth update). User said
"continue with #616 + #617" — **still inside the rabbit hole**, tracker
**#618** ("organization-scope enforcement + RBAC gaps (seeds #340, #341,
#616, #617, #602)"). One item landed this sitting so far (#616); #617 is
the next pick, same sitting, budget allows it.

## Rabbit hole state

- **Tracker:** #618, open. Original working order: #340 → #341 → #616 →
  #617 → #602 (#341 depended on #340; #340/#341 already landed a prior
  sitting).
- **Landed this sitting:** #616.
- **Still queued:** #617 (next pick), #602, #619, #620, #621.
- **Budget note:** #616 was a "medium" item (~2-3 points) against the
  skill's ~10-point advisory sitting allowance, recomputed fresh for this
  sitting (not carried over from the prior sitting's #340+#341 spend,
  since that was a separate sitting). Plenty of budget remains for #617
  (also medium, already scoped) in this same sitting.

## Issues closed this session

- **#616** ("PUT /api/users/:id silently drops the additive auditor role
  when accessType changes without resending auditorRole"):
  `rbac-assignment.service.js`'s `changeUserRole` used to revoke **every**
  active `UserRoleAssignment` for the user, including an additive
  `auditor` grant (#429), and only re-grant the accessType-derived role —
  so an admin `PUT /api/users/:id` that changed `accessType` without also
  resending `auditorRole` silently dropped the user's auditor access with
  no error. Fixed per the issue's recommended option (a): `changeUserRole`
  now joins the user's active assignments against the `roles` collection
  and only revokes the assignment(s) whose `roleCode` is one of
  `ROLE_CODE_BY_ACCESS_TYPE`'s values (the primary/accessType-derived
  role) — additive assignments like `auditor` are left untouched.
  Reproduced with a failing unit test first (auditor assignment reverted
  from active to revoked on the unfixed code), then fixed. 74 targeted
  tests green (rbac-assignment.service, users-access.routes integration,
  rbac middleware, rbac-catalog-seed). Merged `142f02628` into
  `feature/docker-e2e-backend-integration`, fix branch
  `fix/616-auditor-role-drop-on-access-type-change` deleted both local
  and remote (remote delete succeeded this time, no permission denial),
  closed with the merge hash commented on the issue.

## Filed this session

- None. No new findings surfaced while fixing #616.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed after #616 landed
  (`142f02628`). Working tree clean except the gitignored/junctioned
  `.claude/skills/`. The two stale local branches noted in the prior
  handoff (`test/340-...`, `test/341-...`) were deleted this session —
  both already merged, no longer present locally.
- No Docker stack was brought up this session — #616 is a backend-internal
  unit-level fix, proof bar was mocked-Mongo tests per the fix-bugs
  overlay, not literal Docker/live DB.
- `migrateRoleAssignmentScopes.js` (from #615) is still unrun against any
  real database — unrelated to this session's work, unchanged.

## Recommended next steps

Continuing the rabbit hole (tracker #618), in order:
1. **#617** — organizationId referential-validation gap, fix shape
   already sketched (mirror `sample.service.js`'s `collectionSite`
   check). Next pick, same sitting.
2. **#602** — `PERMISSION_CATALOG.allowedActions` decorative-only gap.
   Explicitly flagged in its own body as needing a product/design call
   before a fix shape exists — check in with Dennis when picked up rather
   than guessing a shape, same as #341 needed.
3. **#619** — sample/patient sub-resource/mutation route org-scope gap.
4. **#620** — dead-code withdrawal-history report type.
5. **#621** — non-sample-rooted org-scope gap (temperature/sensor/
   equipment/results/logs report types, saved-report listing, GET
   /api/results).

Given the budget note above, #617 is a reasonable next pick in this same
sitting; #602/#619/#620/#621 can wait for a fresh sitting's budget if the
user wants to stop after #617.
