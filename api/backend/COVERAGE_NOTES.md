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
  regenerate command:
  `cd api/backend && npx vitest run tests/unit tests/integration
  tests/compliance --coverage --reporter=dot` — a bare `--coverage` run
  with no dir targets is blocked by `.claude/hooks/full-suite-guard.cjs`
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

**2026-07-23**, snapshot from `feature/docker-e2e-backend-integration`
(commit `f3c258c9`, full suite, exit 0 — no failing tests).

Statements **91.54%** (17049/18624), Branches **83.37%** (13850/16611),
Functions **90.96%** (2053/2257), Lines **91.98%** (16396/17824).
**Three of four dimensions (statements/functions/lines) remain past the
90% milestone** (`bioavanced-v2-conventions`); branches is still the
sole laggard. ~13 sessions' worth of slices have landed since this
reconcile (see git log on this file / `HANDOFF.md` history) — not yet
folded in; due for a fresh full reconcile per the cadence note above.

Only known pre-existing failure as of the last run: 1 test in
`sample-graph-validator.service.test.js` ("valida o nó de Integridade
com sucesso e falha por tampering") — not blocking coverage work.

## Branch-focused priority list toward the 90% branches milestone

Branches needs a large multi-session lift to cross 90%. This list exists
because the lines-based ZERO/LOW/MID-LOW/MID-HIGH/GOOD buckets below miss
files that sit at 90%+ lines but carry a large branch gap — spot-check
`coverage-summary.json` sorted by branch%, not just by picking from the
lines buckets below, per the "known limitation" note further down.

**Excluded — already blocked by a filed issue or a documented design
call, don't re-pick these as "genuinely low" candidates without first
reading the linked issue:**
`audit-v2.service.js` / `neo4jCanonicalProjection.service.js` (issue
#146/#152 cluster), `SampleGraphValidator.js` (issue #222, legacy-schema
design fork), `patient.service.js` (issues #240/#241, optional/deep
error-path only), `mqtt-telemetry.service.js` (accepted gap — `mqtt`'s
`connect` export can't be mocked), `result-worker.js` /
`daily-merkle.job.js` (issue #146/#164/#159), `queue.js` / `eConsent.js`
(issue #242 merged-vs-isolated drift class — re-check isolated coverage
before trusting the merged number for either).

**Phase 1 (top gap, unblocked, real candidates):** current top entries
are `src/services/import-lgpd.service.js` and `src/routes/intakeWizard.js`
— both partially closed already (session 4/6), remaining gap is scattered
across smaller helpers, no single large block left. Regenerate this list
from a fresh `coverage-summary.json` rather than trusting it stale; many
Phase 1 entries have closed out across sessions 4-13 (see git log for
which).

**Phase 2 (next tier, same exclusions apply) — regenerate after Phase 1
lands, current top-of-list as of last regeneration:**

```
gap  branch% lines%  file
 40  73.50%  98.4%   src/services/auth.service.js
 36  77.07%  90.3%   src/controllers/auth.controller.js
 35  76.35%  95.5%   src/controllers/audit.controller.js
 32  70.09%  95.0%   src/controllers/consent.controller.js
 32  81.81%  100.0%  src/services/hl7.service.js
 30  83.24%  90.9%   src/services/rcs-certification.service.js
 29  87.42%  97.5%   src/controllers/paciente.controller.js
 28  90.42%  99.1%   src/interface/routes/reports.routes.js
```

Files closed out of Phase 1/2 since the list was last regenerated
(2026-07-23 through 2026-07-24, sessions 4-13): `import-lgpd.service.js`
(partial), `intakeWizard.js` (partial), `auth.routes.js` (partial —
coverage number suspect, see `dyeallpies-skills-pack#111`),
`dictionary.js`, `sample-file.controller.js`, `orphanet.js`,
`terminologies.routes.js`, `batch-validation-engine.service.js`,
`terminologySync.service.js`, `equipment-sensor-quarantine.service.js`,
`user-security.service.js` (93.51% isolated branches),
`storageService.js` (85.95% isolated branches).
Check each file's own git log / filed issues for what remains, not this
note.

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
- `src/models/Cid.js`
- `src/models/Disease.js`
- `src/models/DrugDictionary.js`
- `src/models/Equipment.schema.js`
- `src/models/TemperaturePolicy.schema.js`
- `src/reference-data/essential/index.js`
- `src/scripts/migrate-rcs-governance-indexes.js`
- `src/scripts/migrateUserAnonIds.js`
- `src/scripts/seedDiseaseValidationRules.js`
- `src/scripts/testEnvironment.js`
- `src/services/orphanet/orphacodeApiClient.js` (issue #163 — routes.js
  returning 503 may be the same terminologySync gate; check before
  treating as a genuine gap)

## LOW coverage (1-49% lines) — 0 files as of the 2026-07-22 reconcile

Empty as of last reconcile; all prior entries (the #146 audit/rename-drift
cluster) resolved to GOOD.

## MID-LOW coverage (50-69% lines) — 3 files as of the 2026-07-22 reconcile

Sorted ascending (worst first) — lines% / branches%.

```
src/workers/jobs/daily-merkle.job.js            60.00 / 52.17   (issue #159 — stale test mock)
src/services/audit-v2.service.js                60.81 / 43.75   (issue #146/#152 cluster)
src/services/neo4jCanonicalProjection.service.js 65.00 / 58.41  (issue #146 cluster)
```

Genuinely low (no matching filed issue found) — real slice candidates:
none currently listed.

## MID-HIGH coverage (70-84% lines) — 5 files as of the 2026-07-22 reconcile

Sorted ascending (worst first) — lines% / branches%. A lower branch%
relative to lines% usually means untested error paths, a good tie-breaker
when picking among these.

```
src/services/mqtt-telemetry.service.js           71.42 / 78.09   (accepted gap — mqtt.connect() can't be mocked, see exclusion note above)
src/services/patient.service.js                  77.92 / 65.52   (issues #240/#241 — remaining gap is deep error-path combos, optional)
src/workers/workers/result-worker.js             76.66 / 66.07   (issue #146/#164 — rename + yauzl)
src/services/SampleGraphValidator.js             77.69 / 66.66   (issue #222 — legacy-schema migration, design fork)
src/workers/neo4jProjection.worker.js            79.62 / 73.33   (CLI entry block not coverable in-process, accepted gap)
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
to ~200 lines on 2026-07-24 after narrative crept back in; keep it that
way.
