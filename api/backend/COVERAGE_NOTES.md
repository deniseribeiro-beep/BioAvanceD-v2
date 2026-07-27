# Backend coverage tracker

Purpose: let `test-loop` pick the next slice by reading this file instead
of running `npx vitest run --coverage` (~2-3 min, 258 files) at the start
of every session. This file is a snapshot, not a live number — it goes
stale as slices land and as source files change. Keep it honest:

- **Every commit that adds/extends a test for a file listed here must
  move that file to a truer bucket (or off the list) in the same
  commit.** Don't let the tracker and the code diverge silently.
- **Reconcile with a real coverage run periodically**, not every
  iteration: at the `ship-to-main` gate, or if a session's own targeted
  runs stop matching what this file claims (a sign of drift). Full
  regenerate command (redirect to a file — the run takes 6-7 minutes and
  streaming it into the conversation wastes context, and a truncated
  `tail` won't show the final `Test Files`/summary line, forcing a
  wasteful re-run):
  `cd api/backend && npx vitest run tests/unit tests/integration
  tests/compliance --coverage --reporter=dot > /tmp/covrun.log 2>&1;
  tail -60 /tmp/covrun.log` for the coverage table, then
  `grep -E "Test Files|^ Tests " /tmp/covrun.log` for the pass/fail
  summary — a bare `--coverage` run with no dir targets is blocked by
  `.claude/hooks/full-suite-guard.cjs`
  (per-iteration full-suite guard); explicit dir targets are the hook's
  own documented exception and produce an equivalent full-suite result.
  Then re-derive buckets from `coverage/coverage-summary.json`
  (`lines.pct` per file). `coverage/` is gitignored — this file is the
  durable record.
- **This file stays lean on purpose — enforced, not just stated.** Only
  current buckets and the latest reconcile numbers belong here.
  Slice-by-slice narrative (what a slice covered, which issues it filed,
  why a remaining gap is dead code) goes in the slice's own commit
  message and in filed GitHub issues — both already durable and
  searchable (`git log -- api/backend/src/...`, `gh issue list`) — never
  copied into this file. When a slice closes out a file, delete its
  bucket-list line; when it's a partial, replace the old note with a
  single line stating the new isolated number and where the commit is,
  not a paragraph. `COVERAGE_HISTORY.md` was deleted 2026-07-22 for the
  same reason (`dyeallpies-skills-pack#95`); this file drifted back into
  the same pattern once (895 lines by 2026-07-24) and was re-compacted —
  if it's creeping up again, compact it, don't add a second history file.

## Last full reconcile

**2026-07-27 (session 17)**, snapshot from `feature/docker-e2e-backend-integration`
(commit `65667eac`, full suite, **all green: 297 test files / 6158 tests
passed, 0 failures** — the previously-tracked 1 pre-existing failure in
`sample-graph-validator.service.test.js` did not reproduce this run).

Statements **94.24%** (17467/18534), Branches **88.74%** (14584/16434),
Functions **92.74%** (2084/2247), Lines **94.53%** (16768/17737).
**Three of four dimensions (statements/functions/lines) remain past the
90% milestone** (`bioavanced-v2-conventions`); branches is still the
sole laggard, up slightly from 88.2% at the prior (2026-07-24) reconcile.

## Branch-focused priority list toward the 90% branches milestone

Branches needs a large multi-session lift to cross 90%. This list exists
because the lines-based ZERO/LOW/MID-LOW/MID-HIGH/GOOD buckets below miss
files that sit at 90%+ lines but carry a large branch gap — spot-check
`coverage-summary.json` sorted by branch%, not just by picking from the
lines buckets below, per the "known limitation" note further down.

**Excluded — already blocked by a filed issue or a documented design
call, don't re-pick these as "genuinely low" candidates without first
reading the linked issue:**
`SampleGraphValidator.js` (issue #222, legacy-schema design fork, still
open), `mqtt-telemetry.service.js` (accepted gap — `mqtt`'s `connect`
export can't be mocked), `result-worker.js` (issue #274, accepted gap —
`processCSV`'s `.on('error', ...)` handler on the `csv-parser` stream is
unreachable under the code's actual config: `csv-parser@3.2.0` only
emits `'error'` from one place, gated by `options.strict`, which
defaults `false` and is never set to `true` by `result-worker.js`; no
malformed CSV content can trigger it, only mocking the module would),
`queue.js` / `eConsent.js` (issue #242
merged-vs-isolated drift class — re-check isolated coverage before
trusting the merged number for either), `NotificationService.js` (issue
#258, accepted gap — `getNotificationQueue()`'s success path needs a
real Redis connection, `sendCriticalTempAlertFromInflux()`'s Influx
calls are destructured at module-require time so can't be spied on).

**No longer excluded — their blocking issues are now CLOSED:**
`daily-merkle.job.js`, `audit-v2.service.js`,
`neo4jCanonicalProjection.service.js`, `result-worker.js`, and
`patient.service.js` all closed (see MID-LOW/MID-HIGH sections below).

**Known limitation of this reconcile method — see issue #242**: for
files whose tests span both a Vitest-isolated unit test and an
integration test that loads the real `app.js`, the merged full-suite
number can understate real coverage significantly (up to ~20 points).
**Before treating any MID-HIGH entry as a real slice candidate, re-run
that file's own test(s) alone with `--coverage.include="<path>"` first**
if it has both a unit and an integration test file — don't trust the
merged number for those. Also check whether a service is exercised
across *more than two* test files (a 3-way+ split, not just
unit/integration) before trusting an isolated single-file run — see
`dyeallpies-skills-pack#112`.

Recurring dead-code pattern to check before treating a branch gap as a
real test gap: a route's own `if (!db)` 503 guard is often pre-empted by
`authenticate` middleware's identical check, making the route-level
guard structurally unreachable. Confirmed repeatedly (issues #67, #76,
#236, #246, #247, #248) — likely caps achievable branch% below 100
across most of `src/interface/routes/*`. Same applies to
guard-clause-`if`s with no `else`: `@vitest/coverage-v8` reports the
implicit else as 0 hits even when demonstrably exercised (verified via
`coverage-final.json`'s `branchMap` showing `{"start":{},"end":{}}` for
the phantom location) — not fixable by adding tests, only by adding a
real `else` in source, out of scope for a test-only loop.

A second, distinct phantom-coverage pattern (issue #266, re-verified
2026-07-27): statements/branches *inside* a `try` block that itself
contains `await`s can report 0 hits from `@vitest/coverage-v8` even
when a passing test directly asserts their side effect and a plain
`node -e` invocation confirms they execute. Confirmed still present
against current source (`src/controllers/auth.controller.js:122`, the
`catch` block's `logger.error('Erro no login:', ...)`, and the false
arm of the `if (!oldMatches)` branch at line 325) with `vitest@4.1.9`
paired against `@vitest/coverage-v8@4.1.10`; realigning the installed
`vitest` version to `4.1.10` (matching `coverage-v8`'s wanted range)
did not change the result, so this isn't the already-invalid
`npm ls` version-mismatch in this repo's `node_modules` — it reproduces
either way. Same practical rule as the guard-clause pattern: don't keep
adding tests chasing these specific lines once manually verified as
already covered; this is a `@vitest/coverage-v8` instrumentation gap,
not a real gap, and isn't fixable from this repo.

A third pattern (issues #277/#275, root-caused 2026-07-27): repeated,
identical multi-file `--coverage.include` invocations (no code changes
between runs) can produce different stmt/branch numbers run to run —
confirmed bimodal (not random drift) on the 9-file `patient.service.js`
combo from #275 across 5 back-to-back runs with this repo's actual
config (`pool: 'forks'`, `isolate: true`, `fileParallelism: false`).
Root cause: `@vitest/coverage-v8`'s cross-process coverage merge
(istanbul-style merge of separate V8 script-coverage snapshots, one per
forked/isolated test file) disagreeing with itself between runs — not a
race fixable by config (`--no-isolate` eliminates it but breaks a real
test relying on fresh module state per file, so isolation stays on),
and not a real regression, since single-file isolated runs (see `#242`)
are stable. Same practical rule as the other two patterns: trust the
standalone per-file number over a multi-file combined run's per-line/
per-function detail; don't chase this drift with more tests or config
changes.

## How to use this when picking a slice

1. **Check whether a candidate file is on the excluded list above
   (broken by a filed issue) before treating its low number as an
   untested gap** — if so, skip it for slice-picking; it needs a fix,
   not a new test.
2. Among genuinely low-coverage files, prefer real-logic files over thin
   ones: `src/core/application/ports/*` (interfaces, zero logic) and
   `src/scripts/*` (one-off migration/seed scripts, not exercised in prod
   request paths) are low priority regardless of bucket.
3. For a MID-HIGH (70-84%) file not already flagged above as
   issue-linked, the number here is trustworthy — no fresh isolated run
   needed before committing to it. **Exception (issue #242):** see the
   drift caveat above.
4. After landing a slice, delete the file's line from whichever bucket it
   was in (or replace with a one-line "moved to X%" note, not a
   paragraph). Don't leave stale entries. The slice's own commit message
   is the narrative record — don't add one here.

## ZERO coverage (0% lines) — 17 files as of the 2026-07-22 reconcile

Real logic, but broken-by-issue — see caveat above, not a real gap:
- `src/workers/worker.js` (self-executing bootstrap entrypoint — calls
  `startWorker()`/`process.exit` at module load; disproportionately
  expensive to test honestly, lower priority than it looks even once
  untangled from #147)

Low priority (models/interfaces/one-off scripts — thin or non-request-path):
- `src/core/application/ports/IAuditRepository.js`
- `src/core/application/ports/ILineageRepository.js`
- `src/core/application/ports/IPatientConsentReadRepository.js`
- `src/core/application/ports/IStorageRepository.js`
- `src/core/application/ports/IStorageTopologyReadRepository.js`
- `src/reference-data/essential/index.js`
- `src/scripts/migrate-rcs-governance-indexes.js`

## LOW coverage (1-49% lines) — 0 files as of the 2026-07-22 reconcile

Empty as of last reconcile; all prior entries (the #146 audit/rename-drift
cluster) resolved to GOOD.

## MID-LOW coverage (50-69% lines) — 0 files as of this session

Empty. Prior occupants (`audit-v2.service.js`,
`neo4jCanonicalProjection.service.js`, `daily-merkle.job.js`) closed in
earlier sessions — see git log / issue #272 for detail.

## MID-HIGH coverage (70-84% lines) — 7 files as of the 2026-07-24 reconcile

Sorted ascending (worst first) — lines% / branches%. A lower branch%
relative to lines% usually means untested error paths, a good tie-breaker
when picking among these.

```
src/services/mqtt-telemetry.service.js           71.42 / 78.09   (accepted gap — mqtt.connect() can't be mocked, see exclusion note above)
src/services/SampleGraphValidator.js             77.69 / 66.66   (issue #222 — legacy-schema migration, design fork, still open)
src/workers/neo4jProjection.worker.js            79.62 / 73.33   (CLI entry block not coverable in-process, accepted gap)
src/interface/routes/equipment.routes.js         81.59 / 81.01   (phantom-statement pattern, not a real gap — see reconcile note above)
```

Note: `sample.service.js`, `import.service.js`, `audit.controller.js`,
`audit-canonicalization.service.js`, `equipment.routes.js`, `User.js`
have moved to GOOD in prior sessions — not re-verified line-by-line since
they're well above the MID-HIGH cutoff.

## GOOD coverage (>=85% lines)

Not listed here (lower priority for slice-picking by a wide margin; a
full reconcile regenerates this if needed). Ask for a fresh
`--coverage --reporter=basic` run if you need this detail.

## Maintaining this file

If `test-loop` finds this file stale (a listed file turns out
already well-tested, or vice versa), fix the entry in the same commit —
don't just work around it. If the reconcile cadence above stops making
sense (too frequent/rare), update it and say why in the session's
wrap-up. Detailed per-slice writeups belong in the slice's own commit
message, never back into this file — this file was compacted from 895
to ~200 lines on 2026-07-24, crept back up to 356 by 2026-07-27 (mostly
resolved-slice narrative for files that had already moved to GOOD), and
was re-compacted to ~225 the same day. Keep it that way — this is a
recurring pattern, not a one-off.
