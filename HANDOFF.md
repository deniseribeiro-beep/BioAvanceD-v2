# HANDOFF

**Written:** 2026-07-24, end of a test-loop iteration.
**Branch:** `feature/docker-e2e-backend-integration` (commit `f007256f`,
pushed).

## What happened this session

Read `HANDOFF.md`, ran `test-loop`. Reconcile was already fresh (previous
session), so picked directly from `COVERAGE_NOTES.md`'s MID-HIGH bucket:
`src/models/User.js`, flagged there as "not re-checked this session —
check for phantom pattern before treating as a real gap."

Ran its isolated test file with `--coverage.include`: isolated branches
were 97.89% (vs. 78.94% merged) — mostly merged-vs-isolated drift
(#242 class) as suspected, but two real gaps remained:
- the `password.service.validateStrength` catch branch (no test ever
  supplied a weak password to `UserModel.validate`)
- the phone/institution optional-field branches when the field is
  entirely absent (`undefined`) rather than an empty string — every
  existing test left `phone`/`institution` set to a string.

Added two tests in `tests/unit/models/User.test.js` covering both. File
now isolates to 100%/100%/100%/100%. Updated `COVERAGE_NOTES.md`: removed
`User.js` from the MID-HIGH bucket, left a one-line note recording the
resolution (per the file's own no-narrative rule).

One commit, pushed: `f007256f`.

## Repo state

- `feature/docker-e2e-backend-integration` current and pushed
  (`f007256f`).
- Working tree clean. Only test file + `COVERAGE_NOTES.md` touched — no
  product code.

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** As of the last full
reconcile (`402c5359`, 2026-07-24): Statements 93.05%, Branches 86.64%
(lagging dimension), Functions 91.67%, Lines 93.40%. This session's
slice was file-isolated only (not a full reconcile) — `User.js` closing
should nudge branches up slightly at the next full reconcile, but the
merged number wasn't re-measured this session.

## Recommended next steps

Remaining MID-HIGH entries are all issue-linked/accepted-gap per
`COVERAGE_NOTES.md`'s exclusion list (`result-worker.js` #146/#164,
`SampleGraphValidator.js` #222 legacy fork, `patient.service.js`
#240/#241 optional, `mqtt-telemetry.service.js` and
`neo4jProjection.worker.js` accepted gaps, `equipment.routes.js`
phantom-statement). No fresh unblocked MID-HIGH candidate left without
those issues moving first.

Next real slice candidates: MID-LOW bucket is also all issue-linked
(`daily-merkle.job.js` #159, `audit-v2.service.js` /
`neo4jCanonicalProjection.service.js` #146/#152). Best options for the
next session: (a) regenerate the Phase 1/Phase 2 branch-priority list in
`COVERAGE_NOTES.md` from a fresh `coverage-summary.json` — it's stale
(last regenerated pre-session-4, many entries since closed) and is the
main branch-gap-finding mechanism since the lines-based buckets miss
90%-lines/lower-branches files; or (b) do a fresh reachability trace on
one of the backlog dead-code issues (#254, #251, #224, #222, #255-267)
to see if `fix-bugs` applies to any.

## Which skills to use

`work-issue` to route the next pick, or go straight to `test-loop` if
regenerating the Phase 1/2 list per above. `bioavanced-v2-conventions`
and `bioavanced-v2-testing-conventions` as always. `wrap-up` every
iteration.

## Dependency notes

None blocking. `dyeallpies-skills-pack#115` (cjs-mocking skill update)
is a pack-repo issue, not a BioAvanceD-v2 blocker.

## Session note

Confirms the pattern from the prior session: a MID-HIGH bucket entry
flagged "merged vs. isolated may be drift" can still hide a small real
gap underneath the drift — worth actually reading the isolated
`Uncovered Line #s` column rather than stopping once the isolated number
looks "close enough," since here 97.89% still had two genuine untested
branches worth ~10 lines of test code to close.
