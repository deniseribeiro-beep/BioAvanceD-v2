# HANDOFF

**Written:** 2026-07-24, end of a test-loop iteration, session 14.
**Branch:** `feature/docker-e2e-backend-integration` (commit `434e4b3f`,
pushed).

## What happened this session

Worked one Phase 2 branch-coverage slice (single-file this session — the
next candidate, `auth.service.js`, turned out to be an 883-line file
split across 5 test files, too large to bundle into this iteration
alongside the first slice without shortcutting either):

1. **`src/services/user-security.service.js`** (43-branch gap, top of
   Phase 2 list) — closed out. Extended
   `tests/unit/user-security.service.unit.test.js` (+13 tests) and
   `tests/unit/user-security.service.db.unit.test.js` (+13 tests, 79
   total across both plus the integration file at commit time, 83 after)
   covering `calculateSecurityScore`'s medium-strength/near-expiry/
   missing-recoveryCodes branches, `maskPhone`'s non-10/11-digit
   fallback, `extractDeviceName`'s bare "Mobile" token,
   `extractBrowser`'s Chrome+Edge+Safari combo, `extractOS`'s NT
   6.2/6.3/generic-Windows and Linux-less-Android branches,
   `getSessions`'s isCurrent-false/metadata-ip-ua/requestInfo/
   cache-sourced paths, `getActivities`'s default-description/timestamp/
   ip fallbacks, `getSecurityStatus`'s medium overall-level band,
   `getPasswordStatus`'s non-Date `passwordChangedAt` parse, and
   `revokeSession`'s valid-ObjectId query clause plus its cache
   fallback-loop (sessionID and stringified `_id`) matches. Isolated
   branches 80.09% -> 93.51% (173/216 -> 202/216). Remaining ~14-branch
   gap is mostly the recurring `extractDeviceName(...)  ||
   'Dispositivo Atual'`-style dead-code fallback pattern already
   documented in `COVERAGE_NOTES.md` (those helpers never return falsy).

Coverage-notes file updated in the same commit (moved the file off the
Phase 2 top-10 list, noted the new isolated number in the "closed out"
line).

### Bugs/findings filed this session

- **#264**: `extractOS`'s `Android` branch in
  `user-security.service.js` is dead code for real-world UAs — the
  preceding `Linux` check matches first since real Android UAs almost
  always contain "Linux" too. Owner's call whether to reorder the checks
  or accept `'Linux'` as the effective result for Android.

No product-code edits (test-loop rule respected).

## Repo state

- `feature/docker-e2e-backend-integration` current and pushed
  (`434e4b3f`). Working tree clean.

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Last full reconcile
was 2026-07-23 morning (`f3c258c9`): Statements 91.54%, Branches
**83.37%** (lagging dimension), Functions 90.96%, Lines 91.98%. Ten
sessions' worth of slices since then (sample.service.js session 5,
intakeWizard.js session 6, terminologies.routes.js session 7,
batch-validation-engine.service.js session 8, fhir-import-staging.service.js
+ import.service.js session 9, NotificationService.js session 10,
sample-file.controller.js + orphanet.js session 11, dictionary.js +
auth.routes.js session 12, terminologySync.service.js +
equipment-sensor-quarantine.service.js session 13,
user-security.service.js this session) aren't folded into that number
yet — worth a fresh full reconcile once a couple more Phase-1/2 files
land, per the milestone note's own cadence guidance.

## Recommended next steps

Continue down the Phase 2 branch-gap list in `api/backend/COVERAGE_NOTES.md`
— next candidate is `src/services/auth.service.js` (40-branch gap,
73.50% branches / 98.4% lines), but note it's an 883-line file exercised
across at least 5 test files (`auth.service.unit.test.js`,
`auth.service.extended.unit.test.js`,
`auth.service.processLogin.unit.test.js`,
`tests/integration/users-access.routes.test.js`,
`tests/unit/controllers/auth.controller.test.js`) — check every one for
an isolated-vs-merged drift per `dyeallpies-skills-pack#112` before
trusting any single-file coverage number, and expect it to need its own
full iteration (or a deliberate split) rather than bundling with another
file. After that: `src/controllers/auth.controller.js` (36 gap),
`src/controllers/audit.controller.js` (35 gap), `src/services/storageService.js`
(33 gap), etc. Check `COVERAGE_NOTES.md` for the current top-of-list
candidates and re-read fresh rather than trusting this note's memory —
buckets shift. `auth.routes.js` (partial from session 12, coverage
number suspect per `dyeallpies-skills-pack#111`) is still worth a fresh
look once #111 lands. Per the still-current bigger-iteration policy
(`dyeallpies-skills-pack#107`, not yet landed upstream): bundle 2+ of
these, or one much bigger slice, before stopping to commit/wrap-up/report
— this session stayed single-slice because the next candidate needed a
dedicated iteration, not because the policy changed.

Remaining open backlog beyond this (not re-checked this session): #254,
#253, #252, #251, #250, #224, #222, #115, #255, #256, #257, #258, #259,
#260, #261, #262, #263, #264 — see `gh issue list --state open`.
#250/#251/#252-254 are bug/design-call items outside the test-loop's
scope (no-product-code-edit rule); #255-264 are the same class
(dead-code/gap findings from this loop, owner's call whether to
remove/wire in/refactor/reorder), except #259 which is a genuine crash
bug worth prioritizing above the dead-code cluster if Dennis is
triaging.

## Which skills to use

`test-loop` for the next slice (with the bigger-iteration policy above
until #107 lands upstream). `bioavanced-v2-conventions` and
`bioavanced-v2-testing-conventions` as always (would benefit from #108,
#109, #110, #111, and #112 once they land — check before reaching for
`vi.mock`/`csv-parser`-erroring/`ExcelJS`-blank-cell assumptions,
trusting a coverage number from a require-cache-delete-pattern test
file, or assuming a service has only one "owning" test file). `wrap-up`
every iteration.

## Dependency notes

None queued.

## Session note

Same recurring lessons as prior sessions' notes (guard-clause-with-no-else
phantom-branch artifact, dead-code-before-assuming-real-gap, the
require-cache-delete coverage-undercounting quirk, csv-parser/ExcelJS
assumptions, CJS module-scope-destructure mocking limits) — see prior
HANDOFF history in git log if a fresh session needs the full text; not
re-copied here to avoid this file becoming an accumulating log.

**New this session**: when a fallback branch inside a UA/device-sniffing
helper is only reachable via a UA string a real browser/device would
never send (confirmed for `extractOS`'s `Android` check — real Android
UAs already match the earlier `Linux` check), that's worth its own
dead-code issue distinct from the already-documented
guard-clause-phantom-branch and pre-empted-`if(!db)`-guard patterns —
it's a genuine ordering bug, not a coverage-tooling artifact. Filed as
#264 this session.
