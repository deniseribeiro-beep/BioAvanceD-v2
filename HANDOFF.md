# HANDOFF

**Written:** 2026-07-22 (afternoon), end of a coverage-reconcile iteration.
**Branch:** `test/mid-high-coverage-batch-1` (commit `5bbfe743`, not yet pushed this session).

## What happened this session

Per the prior HANDOFF's trigger ("LOW bucket empty → fresh full reconcile
due"), ran the full native coverage suite: `cd api/backend && npx vitest
run tests/unit tests/integration tests/compliance --coverage
--reporter=dot`. Confirmed with Dennis first since the bare-`--coverage`
form is hard-blocked by `.claude/hooks/full-suite-guard.cjs`; the
dir-targeted form `COVERAGE_NOTES.md` already documents is the hook's
own allowed exception (see "Which skills to use" below for a process
note on this).

**Results:** statements 90.33%, branches 81.3%, functions 90.34%, lines
90.9% — up from the morning's 88.8/79.71/88.44/89.44. **Three of four
milestone dimensions (statements/functions/lines) are now past 90%.**
Branches (81.3%) is the sole remaining laggard. All ZERO/LOW/MID-LOW
bucket contents confirmed unchanged from the 2026-07-21 snapshot; the
MID-HIGH bucket's real count is 5 files (not the stale "19" the old
header claimed — corrected).

The run also surfaced **123 failing tests across 5 files**
(`patient.model.unit.test.js`, `sample.model.gaps.test.js`,
`sample.model.unit.test.js`, `sample.models.test.js`,
`sample-graph-validator.service.test.js`) — confirmed real (fail in
isolation too), not the 2 known pre-existing AES-256-GCM failures. Root
cause: these 5 files still use pre-rename field names
(`patientID`/`cpf` instead of `participantId`/`identityDocument`), the
same canonicalization rename commit `dbf0f448` fixed in 7 *other* files
for #133/#134/#136/#137/#139 on 2026-07-09 — these 5 were missed by
that batch. Filed as **issue #244**. No product code touched.

`COVERAGE_NOTES.md` updated and committed (`5bbfe743`) with the fresh
numbers, the #244 finding, and corrected MID-HIGH file count.

## Repo state

- Working tree clean; `test/mid-high-coverage-batch-1` is one commit
  ahead of origin (`5bbfe743`, not pushed this session — push is cheap
  and welcome next iteration, just wasn't part of this ask).
- `main` remains frozen — do not branch off it, merge into it, or push
  to it. `feature/docker-e2e-backend-integration` is the integration
  base per prior sessions' convention (unchanged).
- New issue this session: **#244** (stale participantId/identityDocument
  rename in 5 model/validator unit test files — 123 failing tests, fix
  is test-fixture-only, no product change expected).

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Statements 90.33%,
functions 90.34%, lines 90.9% — **all past 90%.** Branches 81.3% is the
one dimension left; prioritize branch-heavy slices. Frontend remains out
of scope per prior direction.

## Recommended next steps

**Issue #244 is the strongest next pick** — un-stale the 5 files'
fixtures (participantId/identityDocument renames), the same mechanical
fix as `dbf0f448`'s batch. It's not really a coverage slice (no new
tests needed, just fixing 123 already-written assertions against a
9-day-old rename), but it's blocking: a future reconcile that doesn't
know about this will see 123 red tests and wrongly read that as a
regression.

After #244: pick from the MID-HIGH bucket (5 real files:
`mqtt-telemetry.service.js`, `patient.service.js`,
`result-worker.js`, `SampleGraphValidator.js`,
`neo4jProjection.worker.js`) for branch coverage — branches is now the
only dimension below 90%. `#222` (`SampleGraphValidator.js`) is still a
legacy-schema migration/design fork per `bioavanced-v2-legacy` — check
that skill before committing to it. `#238`/`#240`/`#241`/`#243` remain
accepted unreachable-branch gaps, not real 90%-branches levers.

## Which skills to use

`bioavanced-v2-conventions` first. `test-loop` for the next slice (or
`fix-bugs` if picking up #244, since it's a fixture correction against a
real prior rename, not new coverage). `bioavanced-v2-legacy` before
`#222`. `wrap-up` every iteration.

**Process note for whoever runs the next full reconcile:** the
dir-targeted form (`npx vitest run tests/unit tests/integration
tests/compliance --coverage --reporter=dot`) is already the hook's
documented, always-allowed exception per `COVERAGE_NOTES.md`'s own
regenerate instructions — no need to stop and ask Dennis before running
that exact form; only the bare `--coverage` (no dir targets) is the one
that's genuinely blocked. This session asked first out of caution before
realizing the exception already covered it.

## Dependency notes

None queued.

## Session note

`git commit`/`git status` continue to warn "LF will be replaced by
CRLF" on `COVERAGE_NOTES.md` edits (Windows line-ending config) — cosmetic,
not a real problem, doesn't block the commit.
