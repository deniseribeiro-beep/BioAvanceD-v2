# HANDOFF

**Written:** 2026-07-22, end of a test-loop iteration.
**Branch:** `test/mid-high-coverage-batch-1` (pushed, commit `a4d0e5a7`).

## What happened this session

Read the prior HANDOFF (from the `audit-tsa.service.js` slice) and its
"recommended next steps": continue the `#146`-cluster LOW-bucket files,
`intakeWizard.routes.js` (16.98%/0% lines/branches) now the lowest
remaining. Picked it and added
`api/backend/tests/unit/intakeWizard.routes.governance.test.js` — 14
tests.

Note the naming collision: `src/interface/routes/intakeWizard.routes.js`
(the thin auth/rbac wrapper + `intakeGovernanceResponseGuard`, the file
actually listed in COVERAGE_NOTES.md) is a *different* file from
`src/routes/intakeWizard.js` (the intake-handling logic, already covered
by the pre-existing `tests/unit/intakeWizard.routes.test.js`). The new
test file targets the wrapper specifically: `buildSampleQuery`,
`resolveGovernanceStatus` (BLOCKED/QUARANTINE/AVAILABLE branches),
`buildSafeSampleSummary`, `enforcePersistedGovernanceStatus`, and the
response-guard's try/catch.

Mocking approach: rather than going through real JWT/session auth (the
`equipment.routes.quarantine.test.js` pattern), mocked `auth.js`'s
`authenticate` and `rbac.js`'s `requirePermission` to pass-through via
`require.cache` injection, and stubbed the inner `src/routes/intakeWizard`
router with a two-route test double (POST echoes body, GET proves
non-POST bypass) — isolates the wrapper's own logic instead of
re-exercising auth/rbac or the already-tested inner router. Consistent
with this repo's established CJS-mocking-via-require.cache pattern.

File moved from LOW to 100/90.9/100/100 (stmts/branches/funcs/lines) in
isolation. Remaining branch gap (`buildSafeSampleSummary`'s
`governanceStatus.field || sample.field` fallbacks, lines 73-77) is
genuinely unreachable — `resolveGovernanceStatus` always returns fully
populated status fields on every one of its three branches, so the
`sample.field` half of each fallback can never execute. Filed as
[BioAvanceD-v2 issue #243](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/243)
(same dead-code pattern as #238/#236/#237), not left as an unfiled note.

Removed `intakeWizard.routes.js`'s line from `COVERAGE_NOTES.md`'s LOW
bucket (now 1 file, was 2) and added a note pointing at #243.

No product code touched; no bugs found in the wrapper itself (the one
"finding" was the dead-code branch, filed rather than fixed per this
loop's never-touch-product-code rule).

## Repo state

- Working tree clean; `test/mid-high-coverage-batch-1` up to date with
  origin at `a4d0e5a7`. Nothing pending to merge/delete.
- `main` remains frozen — do not branch off it, merge into it, or push
  to it. `feature/docker-e2e-backend-integration` is the base for new
  integration work per prior sessions' convention (unchanged this
  session).
- One BioAvanceD-v2 issue opened this session: #243 (dead fallback
  branches in `intakeWizard.routes.js`, see above).

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions** — statements,
branches, functions, lines. Branches remains the laggard (~79.71% at the
last full reconcile, commit `5f91e9fd`, now increasingly stale after six
slices' branch-heavy additions since) and the metric to prioritize;
prefer branch-heavy gaps over line-heavy ones. Frontend remains out of
scope per that same direction.

## Recommended next steps

`fhir-import-staging.controller.js` (30.23/41.17) is now the last
`#146`-cluster LOW-bucket file remaining.

`#222` (`SampleGraphValidator.js`) — still a legacy-schema
migration/design fork per `bioavanced-v2-legacy`; check that skill
before committing to it. `#238`/`#240`/`#241`/`#243` remain accepted
unreachable-branch gaps, not real 90%-branches levers.

Six slices of the #146 LOW bucket have now landed across recent
sessions — a fresh full reconcile (per `COVERAGE_NOTES.md`'s own cadence
guidance) is due; do it before/at the next `ship-integration-branch`
gate if not sooner, or sooner if the LOW bucket empties out this next
slice.

## Which skills to use

`bioavanced-v2-conventions` first. `test-loop` for
`fhir-import-staging.controller.js` next. `bioavanced-v2-legacy` before
`#222`. `wrap-up` every iteration.

## Dependency notes

None queued.

## Session note

Confirmed this session: when a coverage-notes entry and an actual source
file both share a near-identical name across two directories
(`src/interface/routes/X.routes.js` vs `src/routes/X.js`), double-check
which one COVERAGE_NOTES.md's path actually points at before assuming an
existing test file already covers it — they can have completely
different logic and only one may be tested.
