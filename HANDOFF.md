# HANDOFF

**Written:** 2026-08-19, mid-sitting checkpoint. **Still inside the
rabbit hole**, tracker **#618** ("organization-scope enforcement + RBAC
gaps"). Dennis asked this sitting to pick up all six remaining open
tracker members in one sitting: **#632 -> #633 -> #634 -> #635 -> #636
-> #637**. **#632 and #633 are done** (2 of 6). Continuing immediately
with #634 next, no external re-prompt needed -- this file exists as a
resume point in case the sitting gets cut off mid-queue.

## Rabbit hole state

- **Tracker:** #618, open.
- **Landed this sitting:** #632 (manageBackup/resetMFA now enforced via
  `requirePermission()`), #633 (reports.routes.js's sampleanalysis
  report type now reads `Sample.specimenId` instead of the nonexistent
  `sampleID`, restoring the results join).
- **Queue remaining, in the user's stated order:** #634 (next), #635,
  #636, #637 -- the organizationId-wiring series, no open design calls
  left per the prior sitting's research (see previous HANDOFF rotations
  for the full backfill/visibility decisions already recorded on each).
  Re-derive tracker #618's membership fresh before each pick per the
  rabbit-hole skill's open-ended rule.
- **Budget so far this sitting:** #632 ~3 points (medium), #633 ~1 point
  (small) = ~4 of the ~10-point sitting guideline. Original sizing
  sketch for all six was ~15-17 points, already flagged to Dennis before
  starting; he explicitly asked to attempt all six anyway. #634/#635 are
  each estimated medium (~2-3); expect to approach or cross the
  guideline around #636/#637 -- will surface then per the skill's
  advisory-pacing framing, not stop preemptively.
- **Filed this sitting:** none yet.

## Issues closed this sitting (most recent first)

- **#633**: fixed and merged. `reports.routes.js`'s sampleanalysis
  report type read `sample.sampleID` (doesn't exist on the canonical
  Sample model) instead of `sample.specimenId` in three places, so the
  results join always built an empty ID list and every row silently
  showed `hasResults: false` regardless of reality. Root cause of why
  this wasn't caught: every test fixture mocked `sampleID` directly,
  matching the buggy field name. Fixed the three reads, updated fixtures
  across both `reports.routes.gaps.test.js` and `reports.api.test.js`
  (a second affected file found beyond the one the issue named), added
  a case proving a real match now shows `hasResults: true`. Merged at
  `0b7686b2`.
- **#632**: fixed and merged. See the previous HANDOFF rotation or
  #632's own close comment for full detail (manageBackup/resetMFA wired
  through `requirePermission()`; `manageSystem` confirmed unwired/dead,
  documented as such). Merged at `e906b145`.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `0b7686b2`.
  Working tree clean except the gitignored/junctioned `.claude/skills/`.
  Both fix branches (`fix/632-...`, `fix/633-...`) merged and deleted
  (local + remote) immediately after landing.
- Targeted suites only this sitting (per the conventions skill's
  end-loaded gate order) -- all green: #632's RBAC/backup/user suites
  (85 tests), #633's reports suites (79 tests). **Full native suite not
  re-run this sitting yet** -- run it once at the end of the queue, per
  the gate order, not per item.
- **#628's migration script (`backfillResultSpecimenIds.js`) still has
  not been run against any real environment** (carried over from before
  this sitting) -- run it alongside the next environment that has real
  Result documents with the legacy `sampleID` shape.
- Stale local+remote branch `fix/599-ci-trigger-integration-branch`
  (unrelated, still-open issue #599) noted in passing, not touched, not
  part of this queue.

## Recommended next steps

Continue the queue in the same sitting: **#634** next (Sensor.organizationId
-- new field, route wiring, frontend picker, no backfill), then #635 ->
#636 -> #637. If the sitting gets cut off here, a fresh session should
re-read this file, confirm tracker #618's open members via `gh issue
list`, and resume with #634.
