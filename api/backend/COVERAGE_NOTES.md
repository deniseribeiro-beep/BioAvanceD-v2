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

**Regenerated 2026-07-24 (session 14)** from a fresh full-suite
`coverage-summary.json`, excluded/already-documented files above
filtered out — top real candidates (gap = uncovered branches, sorted
worst branch% first):

```
gap  branch% lines%  file
 17  64.58%  91.5%   src/core/use-cases/AllocateSampleUseCase.js   -- CLOSED prior session
 25  70.23%  91.5%   src/core/use-cases/RegisterSample.js          -- CLOSED prior session
 42  72.90%  89.9%   src/interface/routes/auth.routes.js          -- checked, not a real gap (see below)
 21  80.37% 100.0%   src/controllers/consent.controller.js         -- phantom-branch pattern, not a real gap
```

Files fully closed (100% or accepted-remaining-gap, no longer bucket
candidates) — see each file's own git log / filed issues for detail, not
this note: `AllocateSampleUseCase.js`, `RegisterSample.js`,
`auth.routes.js` (checked, async-statement-0-hit artifact, issue
`dyeallpies-skills-pack#111`), `consent.controller.js`, `orphanet.js`
(98.51%/98.08% isolated; real gaps from #278 closed, residual is
coverage-tool nondeterminism, same class as #277/#275), `backup.routes.js`,
`NotificationService.js` (remaining branch gap, issue #258 closed
2026-07-27 — accepted gap, same class as `mqtt-telemetry.service.js`:
`getNotificationQueue()`'s success branch needs a real Redis connection
`initRedis()` never returns in the test env, and
`sendCriticalTempAlertFromInflux()`'s Influx calls are destructured at
module-require time so `vi.spyOn` on the module can't intercept them),
`collections.js`, `ReleaseSampleUseCase.js`, `import-lgpd.service.js`
(remaining gap was dead code, simplified per issue #270), `auth.service.js`,
`security.routes.js`, `rbac.js`, `intakeWizard.js` (partial),
`dictionary.js`, `sample-file.controller.js`, `terminologies.routes.js`,
`batch-validation-engine.service.js`, `terminologySync.service.js`,
`equipment-sensor-quarantine.service.js`, `user-security.service.js`,
`storageService.js`, `hl7.service.js`, `auth.controller.js`,
`audit.controller.js` (remaining dead code, issue #267),
`paciente.controller.js`, `reports.routes.js` (remaining gap: issues
#67/#76/#236/#246/#247/#248 `if (!db)` pre-empted-guard pattern).

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
combo from #275, flipping between exactly two outcomes (391/462 stmts,
279/401 branches vs. 399/462 stmts, 311/401 branches) across 5 back-to-
back runs with this repo's actual config (`pool: 'forks'`,
`isolate: true`, `fileParallelism: false`). Two candidate fixes were
tried and ruled out/confirmed:
- `node --no-flush-bytecode` (targets V8's GC bytecode-flush-under-
  memory-pressure theory) — **did not fix it**; same bimodal split
  persisted across 5 runs with the flag set.
- `--no-isolate` — **did eliminate the drift** (391/462 stable across 4
  runs) by removing per-file isolation entirely, but this is not a
  viable fix: it collapses each test file into a shared module registry,
  and with it in effect `patient.service.encryption-clinicalunit.gaps.unit.test.js`
  fails (`expected "vi.fn()" to be called 4 times, but got 0 times`) —
  a real test relying on fresh module/mock state per file. Isolation is
  load-bearing for correctness, so this can't be turned off repo-wide to
  chase stable coverage numbers.

Conclusion: the drift is `@vitest/coverage-v8`'s cross-process coverage
merge (istanbul-style merge of separate V8 script-coverage snapshots,
one per forked/isolated test file) disagreeing with itself between
runs, not a race fixable by config in this repo — and not a real
regression, since single-file isolated runs (see `#242`) are stable.
Same practical rule as the other two patterns: trust the standalone
per-file number over a multi-file combined run's per-line/per-function
detail; don't chase this drift with more tests or config changes.

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
- `src/scripts/seedDiseaseValidationRules.js`
- `src/scripts/testEnvironment.js`

## LOW coverage (1-49% lines) — 0 files as of the 2026-07-22 reconcile

Empty as of last reconcile; all prior entries (the #146 audit/rename-drift
cluster) resolved to GOOD.

## MID-LOW coverage (50-69% lines) — 0 files as of this session

Empty. `audit-v2.service.js` and `neo4jCanonicalProjection.service.js`
both closed this session: 100/100/100/100 stmts/branch/funcs/lines
isolated each (new `tests/unit/audit-v2.service.test.js` and
`tests/unit/neo4jCanonicalProjection.service.test.js`; neither had a
prior test file). `daily-merkle.job.js` closed a prior session: isolated
95.65%/78.26%/100%/95.38% stmts/branch/funcs/lines (was 60.00/52.17).
Remaining 3 uncovered lines (86, 112, 122) are defensive/unreachable
paths — see issue #272.

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

`patient.service.js` isolated (9 test files, `--coverage.include`): was
81.16%/65.83% stmts/branch, now **86.36%/77.55%** (issue #275 filed for
an unrelated per-function 0-hit merge artifact in that same run — trust
this top-line %, not the per-function breakdown).

`consent.service.js` isolated (`tests/unit/consent.service.unit.test.js`,
`--coverage.include`): was 97.51%/81.58% stmts/branch, now
**98.22%/90.79%**. Remaining branch gap is mostly the documented
implicit-else guard-clause pattern (`if (!x) throw/return` with no
`else` — see the recurring dead-code pattern note below).

`User.js` checked and closed: 78.94% merged branches was drift (issue
#242 class); isolated run was 97.89%, gap was two real untested cases
(weak-password catch branch, phone/institution-undefined branch) — both
now covered, isolates to 100%/100%/100%/100%.

`auditRoot.service.js` isolated (`tests/unit/auditRoot.service.test.js`,
`--coverage.include`): was 91.12%/75.96% stmts/branch, now
**99.19%/100%**.

`mongo.js` isolated (`database-mongo.test.js` + `mongodb-connection.test.js`,
`--coverage.include`): was 88.14%/80.3% stmts/branch, now **96.9%/88.63%**.
Remaining gap is unreachable defensive guard clauses (module-internal
helpers only ever called with already-validated args from the public
`connectDB`/`connectNewDB` surface) — same dead-guard-clause pattern
noted below, not chased further.

`result.routes.js` isolated (`result.api.test.js` + `result.routes.api.test.js`,
`--coverage.include`): was 94.81%/78.4% stmts/branch, now **96.69%/82.95%**.
Remaining gap (fileType-null re-check, upload's own `validation.isValid`
guard) is unreachable — both are redundant re-checks of conditions
already guaranteed true by `fileFilter`/prior validation on the same
route — same dead-guard-clause pattern noted below, not chased further.

`NotificationService.js` re-verified (`NotificationService.test.js` +
`tests/unit/services/NotificationService.test.js`, `--coverage.include`):
isolated matches merged exactly at 76.36%/220 branches, no drift.
Remaining gap is the phantom-branch pattern (implicit-else guard clauses)
plus the two infra-mocking paths already tracked in issue #258 — no new
tests addable, closed as-is.

`quality-domain.service.js` isolated (`quality-domain.service.unit.test.js`,
`--coverage.include`): was 91.3%/73.68% stmts/branch, now
**100%/100%/100%/100%**.

`storage-query.controller.js` isolated (`storage-query.controller.test.js`,
`--coverage.include`): was 100%/80.55% stmts/branch, now
**100%/100%/100%/100%**.

`orphacodeApiClient.js` was 0% (issue #163 was about the routes layer,
not this client — not a real blocker). New
`tests/unit/orphacodeApiClient.test.js` isolates to
**98.95%/97.36%/95%/100%** stmts/branch/funcs/lines.

`src/scripts/migrateUserAnonIds.js` was 0%. New
`tests/unit/migrateUserAnonIds.test.js` isolates to
**88.09%/92.85%/50%/87.8%** stmts/branch/funcs/lines; remaining gap is
the `require.main === module` self-executing CLI entry block, not
reachable when required as a module.

`BiomarkerObservation.js` (13-file isolated baseline confirmed 87.27%/
84.37% stmts/branch, no drift from the 84.37%/88.46% merged number). New
`tests/unit/BiomarkerObservation.model.test.js` covers the previously-gap
`validate()` branches (missing participantId, negative value, invalid
status, invalid eventType — lines 41/53/62-64/71), verified standalone.
Re-running the 13-file combo afterward gives nondeterministic lower
numbers (61-84% branch across repeated runs, no code changed between
runs) — a coverage-v8 multi-worker merge artifact (`#242`/`#275` class),
not a real regression; trust the standalone/isolated per-file number.

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
to ~200 lines on 2026-07-24 after narrative crept back in; keep it that
way.
