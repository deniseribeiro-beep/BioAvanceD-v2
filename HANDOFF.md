# HANDOFF

**Written:** 2026-07-21, end of skills-migration + coverage-check session.
**Branch:** `feature/docker-e2e-backend-integration` (pushed, commit `e381e1d5` and later).
**No issue was resolved this session** — this handoff exists because the
user explicitly asked for test/skill recommendations for next time.

## Repo state

- `.claude/skills/` now junctions `dyeallpies-skills-pack` (gitignored via
  `.claude/.gitignore`); the old committed flat-file skills are gone.
  `CLAUDE.md` points at the renamed skills (`bioavanced-v2-conventions`,
  `bioavanced-v2-legacy`, `bioavanced-v2-testing-conventions`,
  `docker-workflow`, `ship-integration-branch`, `verify-intent`, plus the
  new `work-issue`/`resolve-issue`/`clean-up`).
- **Rule going forward: never edit a file reached through the skills
  junction.** Any problem with a skill (wrong instruction, stale
  reference, missing case) gets filed as an issue on
  `DyeAllPies/dyeallpies-skills-pack`, not patched locally. See pack
  issues #58, #59, #60 for the precedent/rationale.
- Nothing pending to merge/delete; working tree was clean as of this
  write.

## Coverage snapshot (full run, commit `ac13965b`, 2026-07-21)

Lines 86.33% (15429/17871), Statements 85.73%, Functions 86.58%,
**Branches 75.66%** (12629/16690) — the weakest dimension by a wide
margin and the best general signal for where to spend the next slices.
Flat vs. the prior 2026-07-15 reconcile. Full detail in
`api/backend/COVERAGE_NOTES.md`; tracked in
[issue #228](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/228).

**6 test files failed** this run — all already filed, already assigned to
Denise for a design call, no fix-loop work available on them right now:
`patient.model.unit.test.js` (#218), `sample.model.unit.test.js` /
`sample.model.gaps.test.js` / `sample.models.test.js` (#224),
`sample-graph-validator.service.test.js` (#222). The 6th,
`intakeWizard.routes.test.js`, was a flaky 5s timeout under full-suite
load — passed clean in isolation, not a real regression, no issue filed.

## Recommended next test-writing slices

`COVERAGE_NOTES.md`'s ZERO/LOW/MID-LOW buckets are current empty of
*genuine* gaps — everything in them is already explained by a filed
issue (the #146 rename-drift cluster or a design-fork issue) and isn't a
real slice candidate; don't re-pick from those buckets without checking
the issue first. The real hunting ground right now is **MID-HIGH
(70-84% lines) files not already issue-tagged, prioritized by the
weakest branch% relative to lines%** (untested error paths):

1. `src/models/MeasurementUnit.js` — 75.00% lines / **40.00% branches**
2. `src/routes/orphanet.js` — 72.26% / 52.04%
3. `src/interface/routes/terminologies.routes.js` — 76.66% / 51.50%
4. `src/services/hl7.service.js` — 73.45% / 47.15%
5. `src/interface/routes/result.routes.js` — 80.97% / 55.45%
6. `src/controllers/analysis-type.controller.js` — 77.14% / 57.14%
7. `src/controllers/iot.controller.js` — 70.00% / 58.82%
8. `src/services/patient.service.js` — 70.64% / 60.63%
9. `src/infrastructure/middleware/auth.js` — 71.66% / 68.18% (security-
   relevant middleware — worth prioritizing even though the branch gap
   is smaller than others above)
10. `src/utils/portManager.js` — 78.48% / 62.85% (note: shells out to
    real OS commands — check cross-platform behavior before trusting a
    green local run as CI-green, see `bioavanced-v2-testing-conventions`)

Skip anything already carrying an issue tag in `COVERAGE_NOTES.md`'s
MID-HIGH list (e.g. `mqtt-telemetry.service.js` #160,
`SampleGraphValidator.js` #222, anything marked #146/#164) — those need a
fix, not a new test.

## Which skills to use

- **`bioavanced-v2-conventions`** first, always — branch naming
  (`test/<slug>`), the ask-Dennis-first PR rule, issue-filing discipline.
- **`test-loop`** for each slice above, one file (or a few related ones)
  per iteration, native runs only per
  **`bioavanced-v2-testing-conventions`** (targeted `vitest run`, no
  Docker/full-suite mid-loop).
- **`parallel-test-agents`** is a good fit for this batch specifically —
  the 10 files above are independent (no shared state), which is exactly
  its trigger condition. Fan out 2-4 at a time as `test-writer` leaf
  agents, verify + commit yourself. **`agent-delegation` is the mandatory
  read before any Agent tool call**, regardless.
- No `fix-bugs`/`resolve-issue`/`work-issue` work is available right now
  — everything currently failing is blocked on Denise's design calls
  (#208, #218, #222, #224, all assigned to her). Check back once she's
  weighed in.
- **`wrap-up`** ends every iteration, not just the session.
- **`ship-integration-branch`** only once the coverage push is judged
  done — not per iteration.

## Dependency notes

None queued beyond "wait for Denise" on the four design-call issues —
test-loop work above doesn't depend on her and can proceed in parallel.
