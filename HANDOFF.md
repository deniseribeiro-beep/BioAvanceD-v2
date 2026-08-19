# HANDOFF

**Written:** 2026-08-19, mid-sitting checkpoint. **Still inside the
rabbit hole**, tracker **#618** ("organization-scope enforcement + RBAC
gaps"). Dennis asked this sitting to pick up all six remaining open
tracker members in one sitting: **#632 -> #633 -> #634 -> #635 -> #636
-> #637**. **#632 is done** (1 of 6). Continuing immediately with #633
next, no external re-prompt needed -- this file exists as a resume point
in case the sitting gets cut off mid-queue.

## Rabbit hole state

- **Tracker:** #618, open.
- **Landed this sitting:** #632 (fully resolved -- manageBackup/resetMFA
  now enforced via `requirePermission()` instead of hardcoded
  `requireRole(4)`/`isAdministrator()`; `manageSystem` confirmed to have
  no corresponding live route and documented as intentionally unwired
  dead catalog metadata, not guessed at).
- **Queue remaining, in the user's stated order:** #633 (next),
  #634, #635, #636, #637. Per the rabbit-hole skill's open-ended
  membership rule, re-derive tracker #618's membership fresh before each
  pick -- a mid-queue split could still add a new member, though none is
  expected for the remaining five (all are already-scoped, no open
  design calls left per the prior sitting's research).
- **Budget so far this sitting:** #632 scored ~3 points (medium -- catalog
  research + two custom RBAC reproduction harnesses) against the
  rabbit-hole skill's ~10-point sitting guideline. Original sizing
  sketch for all six was ~15-17 points, already flagged to Dennis as
  over budget before starting; he explicitly asked to attempt all six
  anyway, so this is advisory pacing, not a hard stop. Recompute after
  each item.
- **Filed this sitting:** none yet (no new findings surfaced during #632).

## Issue closed this sitting (most recent)

- **#632**: fixed and merged. `backup.routes.js`'s `requireRole(4)` ->
  `requirePermission('manageBackup')` (allowedActions broadened from
  `['UPDATE']` to `['CREATE','READ','UPDATE']` to match its real
  perform/list/restore operations). `user.routes.js`'s
  `POST /:id/reset-mfa` inline `isAdministrator()` check ->
  `requirePermission('resetMFA', 'UPDATE')`. Decision (researched via
  `dict-02_DICIONARIO.md` P1X-0218 + #630's precedent, not asked of
  Dennis): wire both through `requirePermission` for RBAC-surface
  consistency. `manageSystem` left unwired -- no live route corresponds
  to it (`security.routes.js`'s `/config`/`/permissions` are a separate
  legacy `security_permissions` display-config system, unrelated to the
  RBAC `Permission`/`Role` enforcement path). Reproduced both gaps with
  new failing-first tests before fixing (a hierarchyLevel-4 role missing
  `manageBackup` was wrongly *allowed*; a non-administrator role granted
  `resetMFA` was wrongly *denied*) -- both now pass. Merged to
  `feature/docker-e2e-backend-integration` at `e906b145`. See #632's own
  close comment for full detail.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `e906b145`
  (the #632 merge). Working tree clean except the gitignored/junctioned
  `.claude/skills/`. Fix branch `fix/632-...` merged and deleted (local +
  remote) immediately after landing.
- Targeted suites only this sitting so far (per the conventions skill's
  end-loaded gate order): `backup.api.test.js`, `users.api.test.js`,
  `users-access.routes.test.js`, `rbac.test.js`,
  `rbac-catalog-seed.service.test.js` -- all green (85 tests) on the
  merged tree. **Full native suite not re-run this sitting yet** -- run
  it at the end of the queue, once, per the gate order, not per item. A
  stray background full-suite run was started mid-#632 against a
  since-superseded tree state and should be disregarded/killed if still
  running -- see this sitting's wrap-up note; don't repeat that per
  future items in this queue.
- **#628's migration script (`backfillResultSpecimenIds.js`) still has
  not been run against any real environment** (carried over from before
  this sitting) -- run it as part of deploying #628's change, alongside
  the next environment that has real Result documents with the legacy
  `sampleID` shape.
- A stale local+remote branch `fix/599-ci-trigger-integration-branch`
  exists from an unrelated, still-open issue (#599) -- noticed in
  passing during #632's branch check, not touched, not part of this
  queue.

## Recommended next steps

Continue the queue in the same sitting: **#633** next (small, mechanical
-- `reports.routes.js`'s sampleanalysis report type reads the
nonexistent `Sample.sampleID` instead of `specimenId`), then #634 ->
#635 -> #636 -> #637 (organizationId wiring series, no open design
calls left per prior research). If the sitting gets cut off here, a
fresh session should re-read this file, confirm tracker #618's open
members via `gh issue list`, and resume with #633.
