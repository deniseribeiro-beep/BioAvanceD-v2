# HANDOFF

**Written:** 2026-07-22, end of a test-loop iteration.
**Branch:** `test/mid-high-coverage-batch-1` (pushed, commit `09c80698`).

## What happened this session

Read the prior HANDOFF (from the `audit-witness.service.js` slice) and
its "recommended next steps": continue the `#146`-cluster LOW-bucket
files, prioritizing branch-heavy gaps, and read the CJS-mocking
reference before `audit-tsa.service.js` since it's heavier (execFile +
fetch + real temp-dir I/O). Picked `src/services/audit-tsa.service.js`
(21.42%/0% lines/branches) and added
`api/backend/tests/unit/audit-tsa.service.test.js` — 6 tests covering
`requestTimestamp()`: missing/blank `AUDIT_RFC3161_TSA_URL`, an
`execFile` (openssl) failure, a non-ok TSA HTTP status, the success
path (`TIMESTAMPED` with `token`/`tokenDerHex`/`messageImprint`), the
POST body/content-type sent to the TSA, and temp-dir cleanup (`rm` in
`finally`) verified on both the failure and success paths.

The service destructures `const { execFile } = require('child_process')`
at module scope — none of the existing CJS-mocking patterns in this
repo cover mocking a Node built-in directly (only app-local
files/npm packages via `require.cache` injection). Confirmed a simpler
pattern works: built-ins are real singleton objects, so
`require('child_process').execFile = vi.fn()` *before* the service's
first `require()` is picked up by its destructuring, no cache injection
needed. Verified with an isolated `node -e` repro before trusting it.
Filed this as skills-pack issue
[DyeAllPies/dyeallpies-skills-pack#100](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/100)
(quoting the exact text to add) rather than editing the junctioned
`cjs-mocking.md` directly — Rule 0.

File moved from LOW to 100/100/100/100 (all four dimensions) in
isolation. Removed its line from `COVERAGE_NOTES.md`'s LOW bucket (now 2
files, was 3) and added a one-paragraph note on the mocking pattern used.

No product code touched; no bugs found in `audit-tsa.service.js` itself.

## Repo state

- Working tree clean; `test/mid-high-coverage-batch-1` up to date with
  origin at `09c80698`. Nothing pending to merge/delete.
- `main` remains frozen — do not branch off it, merge into it, or push
  to it. `feature/docker-e2e-backend-integration` is the base for new
  integration work per prior sessions' convention (unchanged this
  session).
- No BioAvanceD-v2 issues opened or closed this session. One issue
  opened on the skills-pack repo (`#100`, see above) for a durable
  mocking-pattern addition — that's a pack-maintenance issue, not a
  BioAvanceD-v2 tracker item.

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions** — statements,
branches, functions, lines. Branches remains the laggard (~79.71% at the
last full reconcile, commit `5f91e9fd`, now increasingly stale after
five slices' branch-heavy additions since) and the metric to
prioritize; prefer branch-heavy gaps over line-heavy ones. Frontend
remains out of scope per that same direction.

## Recommended next steps

Continue the `#146`-cluster LOW-bucket files: `intakeWizard.routes.js`
(16.98/0) is now the lowest remaining. `fhir-import-staging.controller.js`
(30.23/41.17) remains after that.

`#222` (`SampleGraphValidator.js`) — still a legacy-schema
migration/design fork per `bioavanced-v2-legacy`; check that skill
before committing to it. `#238`/`#240`/`#241` remain accepted
unreachable-branch gaps, not real 90%-branches levers.

Given five slices of the #146 LOW bucket have now landed, a fresh full
reconcile (per `COVERAGE_NOTES.md`'s own cadence guidance) is getting
due — not urgent this iteration, but worth doing before/at the next
`ship-integration-branch` gate if not sooner.

## Which skills to use

`bioavanced-v2-conventions` first. `test-loop` for the remaining
`#146`-cluster files, prioritizing branch-heavy gaps.
`bioavanced-v2-legacy` before `#222`. `wrap-up` every iteration.

## Dependency notes

None queued.

## Session note

New mocking pattern confirmed this session: mocking a destructured Node
built-in (`child_process.execFile`) needs no `require.cache` injection —
plain property assignment on the object `require('<builtin>')` returns
is enough, since built-ins are real process-wide singletons and the
override is visible to a destructuring `require()` that hasn't run yet.
Filed as skills-pack issue #100 (see above) rather than edited directly,
since `cjs-mocking.md` is a junctioned pack file. The next session
picking up a similar built-in-shelling-out file (`fs`, `os`, etc.) should
check whether #100 landed in the pack yet before re-deriving this from
scratch.
