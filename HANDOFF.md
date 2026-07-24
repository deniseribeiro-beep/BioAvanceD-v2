# HANDOFF

**Written:** 2026-07-24, end of a test-loop iteration.
**Branch:** `feature/docker-e2e-backend-integration` (commit `4341991d`,
pushed).

## What happened this session

Read `HANDOFF.md`, routed via `work-issue` -> `test-loop`. Prior
handoff's recommended-next-steps list named `BiomarkerObservation.js` as
an untried model-file candidate (84.37%/88.46% merged) to check for
thinness before picking.

- Checked `iot.controller.js` first (83.82%/87.50% merged): isolated
  single-file run confirmed no drift, but branch-level inspection of
  `coverage-final.json` showed the entire `ingestTelemetry` function
  (and several fire-and-forget async branches genuinely exercised by
  its own test file) reporting 0 hits — an instrumentation artifact from
  the test file's `vi.resetModules()` + manual `require.cache` splicing
  per-test pattern, not a real gap. Not chased further (would require
  restructuring the test file's module-reload approach, out of scope for
  a coverage-only slice); moved to the next candidate instead.
- `BiomarkerObservation.js`: no dedicated unit test file existed; found
  it exercised across 13 other test files (a wide multi-file split, ala
  issue #112's caveat). A 2-file isolated check first gave a misleadingly
  low 9%, but running the full 13-file set matched the merged number
  exactly (87.27%/84.37% stmts/branch) — no drift once the full split is
  included.
- Read the source: `validate()` had 4 untested branches (missing
  `participantId`, negative `value`, invalid `status`, invalid
  `eventType` — lines 41/53/62-64/71). Added
  `tests/unit/BiomarkerObservation.model.test.js` (5 tests) targeting
  exactly those branches; verified standalone that the new file hits all
  four previously-uncovered lines.
- Re-running the 13-file combo afterward to get a final number gave
  **nondeterministic results across repeated identical runs** (84.37%,
  68.75%, 61.45% branch — same command, same files, no code changes
  between runs, `--no-file-parallelism` didn't fix it). This is a new
  wrinkle beyond the already-documented #242/#275 merged-vs-isolated
  drift class (this is same-command run-to-run variance, not a stable
  merged-vs-isolated gap) — filed as **issue #277**. Documented the
  caveat in `COVERAGE_NOTES.md`'s new `BiomarkerObservation.js` entry:
  trust the standalone-verified number, not the flaky multi-file rerun.
- No bugs found, no product source touched.
- Committed test file + coverage notes together, pushed.
- Ran `wrap-up`'s core audit: filed issue #277 for the coverage-v8
  nondeterminism finding (see above) — that's this session's one
  destination-having finding. No scope violations, no lazy fixes, no
  user corrections (autonomous session), no context waste beyond the
  necessary back-and-forth diagnosing the nondeterminism.

## Repo state

- `feature/docker-e2e-backend-integration`, pushed, working tree clean.
- Files touched this session:
  `api/backend/tests/unit/BiomarkerObservation.model.test.js` (new, 5
  tests), `api/backend/COVERAGE_NOTES.md`. No product source touched.

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Last full reconcile
(2026-07-24, session 16, pre-session commit `a636b37a`): Statements
94.01%, Branches 88.2%, Functions 92.33%, Lines 94.29%. Three of four
dimensions remain past 90%; branches is still the sole laggard. This
session's slice was a small, single-file fix (4 branches) — not yet
re-reconciled against the full suite, so the milestone numbers above are
still the last full-reconcile snapshot, not updated for this slice.

## Recommended next steps

No specific file was named by Dennis for next session — pick per
`test-loop`'s normal candidate-selection process. Remaining untried
real-logic candidates from the prior sessions' regenerated list (still
worth a fresh isolated check first per issue #242's drift caveat before
committing to any as a slice): `auth.service.js` (73.50%/98.44% merged
per the prior handoff, but note `COVERAGE_NOTES.md`'s "Files fully
closed" list already includes `auth.service.js` from an earlier
session — re-check for drift before assuming either number is current,
and remember it has a 3-way test-file split per
`dyeallpies-skills-pack#112`), `audit-canonicalization.service.js`
(74.28%/87.87% merged per the prior handoff, but `COVERAGE_NOTES.md`
already lists it as "moved to GOOD in prior sessions" — re-verify before
assuming it's still a real gap).

`iot.controller.js` was checked this session and is **not** a clean
pick: its remaining branch gap is masked by a `require.cache`-splicing
test-instrumentation artifact (see "What happened" above) — don't
re-pick it without first deciding whether to restructure its test file's
module-reload pattern (a bigger, riskier change than a normal slice).

Still-excluded (per `COVERAGE_NOTES.md`'s exclusion note, don't re-pick
without reading the linked issue): `SampleGraphValidator.js` (#222),
`mqtt-telemetry.service.js` (accepted gap), `queue.js`/`eConsent.js`
(#242 drift class), `neo4jProjection.worker.js` (CLI entry, accepted
gap), `equipment.routes.js` (phantom-statement, not a real gap).

Issue #277 (new this session — coverage-v8 multi-file run-to-run
nondeterminism, see above) is unowned and open; relevant to any future
session doing a multi-file `--coverage.include` reconcile — trust a
standalone single-file run over a flaky multi-file rerun until this is
root-caused.

Issue #275 (`patient.service.js` per-function 0-hit merge artifact),
#274/#273/#272 (`result-worker.js`/`daily-merkle.job.js` defensive-branch
calls), #271 (`orphanet.js`), #269 (branch-guard.cjs misparse), #270
(`import-lgpd.service.js` dead code, revisit post-merge-to-main), #276
(`full-suite-guard.cjs` false-positive on a read-only diagnostic mention
of "vitest") — all still open and unowned, unchanged this session.

`dyeallpies-skills-pack#120` (`crypto.randomBytes` gotcha) and `#116`
(pack repo) are pack-repo documentation issues, not BioAvanceD-v2
blockers.

## Which skills to use

`test-loop` for the next coverage slice. `bioavanced-v2-conventions` and
`bioavanced-v2-testing-conventions` as always. `bioavanced-v2-legacy` if
a candidate turns out to be dead code. `wrap-up` every iteration.

## Dependency notes

None blocking. `dyeallpies-skills-pack#111`/`#112` (auth.routes.js
coverage-number-suspect, 3-way-split isolation caveat) still applies
generally to other suspect files, most directly to `auth.service.js`
above if it's picked next. `dyeallpies-skills-pack#115`/`#116`/`#120`
are pack-repo issues, not BioAvanceD-v2 blockers. Issue #277 (this
session) is a new general caveat for any multi-file coverage reconcile.

## Session note

A "wide multi-file split" candidate (13 test files touching
`BiomarkerObservation.js`) needed the full set run together to match the
merged number — a 2-file subset alone gave a wildly misleading 9%. When
a model/service is used this broadly, don't stop at checking 2-3 obvious
test files; grep for every file touching it first.

Discovering a coverage measurement is flaky (same command, same files,
different numbers across runs) is itself worth filing as its own issue
even when a workaround (trust the standalone run) is available in the
moment — the flakiness will resurface for the next session's reconcile
if left undocumented as a one-off.
