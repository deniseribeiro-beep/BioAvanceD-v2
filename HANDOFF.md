# HANDOFF

**Written:** 2026-07-24, end of a test-loop iteration.
**Branch:** `feature/docker-e2e-backend-integration` (commit `65f0dbcd`,
pushed).

## What happened this session

Ran `test-loop` on `src/controllers/auth.controller.js` (Phase 2
branch-gap list, 36-branch gap, 77.07%/90.3% branch/lines per
`COVERAGE_NOTES.md`) — confirmed as a real (not merged-vs-isolated-drift)
number via the file's own 4 test files (unit + 3 integration) run
together with `--coverage.include`.

Added 6 targeted tests to `tests/unit/controllers/auth.controller.test.js`
(103 tests total, all passing) closing the untested `req.t`-present arm
of the `(req.t && req.t(key)) || 'default'` i18n-fallback pattern across
`setupMFA`, `enableMFA`, `resetPassword`, `changePassword`, and
`setupMFAFirstLogin`, plus `login`'s catch-block `error.stack` logging
path.

Isolated coverage for the file: **78.34% branches** (was 77.07%),
**93.75% lines/statements** (was 90.27%), **87.5% functions** (was
81.25%). Remaining gap confirmed via manual invocation (`node -e`,
outside Vitest) and `coverage-final.json`'s `branchMap`/`statementMap` to
be: (a) the documented guard-clause-if-with-no-else phantom-branch
pattern, and (b) a newly-found second pattern where V8 shows 0 hits for
some statements/branches inside async catch blocks *even when a passing
test directly asserts their side effect* — filed as **issue #266** since
it's a coverage-tooling gap, not a real test gap, and future sessions
should not burn iteration time chasing it on other files without first
checking #266.

Updated `COVERAGE_NOTES.md`: removed `auth.controller.js` from the
Phase 2 list, added it to the "closed out" note with its new isolated
number and the #266 caveat.

No stale-test / lazy-fix / scope-creep findings this session beyond
filing #266. No product source touched.

## Repo state

- `feature/docker-e2e-backend-integration` current and pushed
  (`65f0dbcd`). Working tree clean. No dangling branches.

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Last full reconcile
was 2026-07-23 morning (`f3c258c9`): Statements 91.54%, Branches
**83.37%** (lagging dimension), Functions 90.96%, Lines 91.98%. Many
sessions' worth of slices since then (including this one and the prior
`consent.controller.js` one) aren't folded into that number yet — worth
a fresh full reconcile once a couple more Phase 2 files land.

## Recommended next steps

Resume `test-loop` on the Phase 2 branch-gap list in
`api/backend/COVERAGE_NOTES.md` (re-read fresh, it's moved this
session):

```
gap  branch% lines%  file
 40  73.50%  98.4%   src/services/auth.service.js
 35  76.35%  95.5%   src/controllers/audit.controller.js
 29  87.42%  97.5%   src/controllers/paciente.controller.js
 28  90.42%  99.1%   src/interface/routes/reports.routes.js
```

`auth.service.js` (40-branch gap) is still the top candidate but spans
5+ test files — check each for isolated-vs-merged drift per
`dyeallpies-skills-pack#112` before trusting any single-file number, and
expect it to need its own full iteration or a deliberate split.
`audit.controller.js` is next-sized but the notes file has a
contradictory note that it "moved to GOOD in prior sessions, not
re-verified" — re-run its own isolated coverage first before trusting
either number.

Remaining open backlog beyond this (not re-checked this session): #254,
#253, #252, #251, #250, #224, #222, #115, #255-#266 — see
`gh issue list --state open`. #250/#251/#252-254 are bug/design-call
items outside the test-loop's scope; #255-265 are dead-code/gap findings
from prior test-loop sessions, owner's call whether to remove/wire in;
#266 is the new coverage-tooling finding from this session.

## Which skills to use

`work-issue` to route the next pick. `test-loop` for the next coverage
slice (with the bigger-iteration policy per `dyeallpies-skills-pack#107`,
not yet landed upstream). `bioavanced-v2-conventions` and
`bioavanced-v2-testing-conventions` as always. `wrap-up` every
iteration.

## Dependency notes

None queued.

## Session note

New recurring-lesson candidate: when a branch/statement shows 0 hits in
`coverage-final.json` despite (a) a passing test that explicitly asserts
the code path's side effect, and (b) manual `node -e` invocation
confirming the line executes — don't add more tests chasing it. Check
issue #266 first; it may be the same V8-async-catch-undercount pattern,
which is a tooling gap, not a real test gap. This is a second, distinct
pattern from the already-documented guard-clause-no-else phantom branch
(that one only zeroes the implicit `else`; this one can zero a
demonstrably-executed `true` arm too).
