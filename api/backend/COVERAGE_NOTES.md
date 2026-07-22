# Backend coverage tracker

Purpose: let `test-loop` pick the next slice by reading this file instead
of running `npx vitest run --coverage` (~2-3 min, 258 files) at the start
of every session. This file is a snapshot, not a live number — it goes
stale as slices land and as source files change. Keep it honest:

- **Every commit that adds/extends a test for a file listed here must
  move that file to a truer bucket (or off the ZERO/LOW list) in the same
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
- **This file stays lean on purpose** — only the current buckets and the
  latest reconcile numbers. Slice-by-slice narrative (what each past
  slice covered, which issues it filed) is no longer duplicated into a
  separate history file — that content already lives permanently in
  `git log`/commit diffs and in filed GitHub issues, which don't rot the
  way a hand-maintained log does. `COVERAGE_HISTORY.md` was deleted
  2026-07-22 for exactly this reason; see
  `dyeallpies-skills-pack#95` for the rationale and the pending
  `test-loop`/testing-conventions skill update.

## Last full reconcile

**2026-07-21**, snapshot from commit `67d01a62` on
`feature/docker-e2e-backend-integration` (`npx vitest run tests/unit
tests/integration tests/compliance --coverage --reporter=dot`, full
suite — explicit dir targets to satisfy the per-iteration full-suite
guard hook, equivalent to a bare `--coverage` run; buckets below
re-derived directly from `coverage/coverage-summary.json`, not read off
printed totals).

Statements 87.7% (16375/18671), Branches 78.49% (13100/16690), Functions
87.64% (1980/2259), **Lines 88.32%** (15785/17871) — **up** from the
prior reconcile's 86.33% lines (commit `94e2fc62`, 2026-07-15),
consistent with the #228 batch-1 slices (auditLogger.js,
clinical-unit.routes.js, logs.routes.js, import-lgpd.controller.js, and
others) landing since. Branches remains the weakest dimension by a wide
margin, same as the prior reconcile.

The same run showed 5/267 test files (123/5101 tests) failing —
`patient.model.unit.test.js` (#218), `sample.model.unit.test.js` /
`sample.model.gaps.test.js` / `sample.models.test.js` (#224),
`sample-graph-validator.service.test.js` (#222's `SampleGraphValidator.js`
gaps). Same five as the 2026-07-15 reconcile, no new regressions — all
still blocked on Denise's design calls, don't re-file.

**Bucket lists below are freshly regenerated this session** off the new
`coverage-summary.json`. Cutoffs unchanged: ZERO = 0%, LOW = 1-49%,
MID-LOW = 50-69%, MID-HIGH = 70-84%, GOOD = >=85%.

## How to use this when picking a slice

1. **Check whether a candidate file is on the list above (broken by a
   filed issue) before treating its low number as an untested gap** —
   if so, skip it for slice-picking; it needs a fix, not a new test.
2. Among genuinely low-coverage files, prefer real-logic files over thin
   ones: `src/core/application/ports/*` (interfaces, zero logic) and
   `src/scripts/*` (one-off migration/seed scripts, not exercised in prod
   request paths) are low priority regardless of bucket.
3. This reconcile has real (non-drift) entries in every bucket again —
   ZERO/LOW/MID-LOW are no longer empty. Pick from LOW or MID-LOW first
   for the biggest jump per slice, same as before the 2026-07-05
   reconcile emptied them.
4. For a MID-HIGH (70-84%) file not already flagged above as
   issue-linked, the number here is trustworthy — no fresh isolated run
   needed before committing to it.
5. After landing a slice, delete the file's line from whichever bucket it
   was in (or move it, if now partial). Don't leave stale entries. The
   slice's own commit message is the narrative record now — don't add
   one here or to a separate history file.

## ZERO coverage (0% lines) — 20 files, full reconcile 2026-07-21, commit `67d01a62`

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
- `src/models/StoragePath.js`
- `src/models/TemperaturePolicy.schema.js`
- `src/models/Withdrawal.js`
- `src/reference-data/essential/index.js`
- `src/reference-data/essential/manifest.js`
- `src/scripts/migrate-rcs-governance-indexes.js`
- `src/scripts/migrateUserAnonIds.js`
- `src/scripts/seedDiseaseValidationRules.js`
- `src/scripts/testEnvironment.js`
- `src/services/orphanet/orphacodeApiClient.js` (issue #163 — routes.js
  returning 503 may be the same terminologySync gate; check before
  treating as a genuine gap)

## LOW coverage (1-49% lines) — 7 files, full reconcile 2026-07-21, commit `67d01a62`

Sorted ascending (worst first) — lines% / branches%. All seven are the
same audit/rename-drift cluster (issue #146) already tracked; none are
genuinely untested slice candidates.

```
src/services/auditRoot.service.js                6.95 / 0        (issue #146 cluster — audit/rename drift)
src/services/audit-tree.service.js               7.89 / 0        (issue #146 cluster)
src/services/audit-signing.provider.js          14.81 / 0        (issue #146 cluster)
src/interface/routes/intakeWizard.routes.js     16.98 / 0        (issue #146 cluster)
src/services/audit-tsa.service.js               21.42 / 0        (issue #146 cluster)
src/services/audit-witness.service.js           27.27 / 0        (issue #146 cluster)
src/controllers/fhir-import-staging.controller.js 30.23 / 41.17  (issue #146 cluster)
```

Genuinely low (no matching filed issue found) — real slice candidates:
none currently listed. Moved to GOOD (>=85%) since the 2026-07-14
reconcile: `PatientIdentityService.js`, `MoveSampleUseCase.js`,
`sampleIDGenerator.js`, `ReleaseSampleUseCase.js`,
`AllocateSampleUseCase.js`, `authConsent.js`,
`patientBiomarkerTimeseries.service.js` — all #146-family fixes landed.

## MID-LOW coverage (50-69% lines) — 3 files, full reconcile 2026-07-21, commit `67d01a62`

Sorted ascending (worst first) — lines% / branches%.

```
src/workers/jobs/daily-merkle.job.js            60.00 / 52.17   (issue #159 — stale test mock)
src/services/audit-v2.service.js                60.81 / 43.75   (issue #146/#152 cluster)
src/services/neo4jCanonicalProjection.service.js 65.00 / 58.41  (issue #146 cluster)
```

Genuinely low (no matching filed issue found) — real slice candidates:
none currently listed. Moved to GOOD (>=85%) since the 2026-07-14
reconcile: `fhir.service.js`, `result-worker.js` (now MID-HIGH, see
below), `LineageRepository.js`, `analysisValidation.service.js`,
`import-lgpd.service.js`, `consent.validator.js`.

## MID-HIGH coverage (70-84% lines) — 23 files, full reconcile 2026-07-21, commit `67d01a62`

Sorted ascending (worst first) — lines% / branches%. Not cross-checked
against filed issues line-by-line (MID-HIGH files are closer to "done"
regardless); a lower branch% relative to lines% usually means untested
error paths, a good tie-breaker when picking among these. The #228
batch-1 slices (orphanet.js, terminologies.routes.js,
MeasurementUnit.js, result.routes.js, analysis-type.controller.js,
auth.js, auditLogger.js, import-lgpd.controller.js,
clinical-unit.routes.js, logs.routes.js, sensor.controller.js,
User.js, reports.routes.js, MongoAuditRepository.js, createFirstAdmin.js,
mongo.js) have all moved out
of this bucket into GOOD — per-slice narrative for those is in their
commit history, not here.

```
src/services/mqtt-telemetry.service.js                         71.42 / 78.09   (issue #160 — HMAC bypass bug)
src/services/patient.service.js                                74.39 / 63.56   (large gap despite 5 existing test files/118 tests — isolated run confirmed the number; nearly every method (encrypt/decryptSensitivePatientFields, resolveClinicalUnitSnapshot, applyDeceasedRepresentativeRules, checkIdentifierConflict, createPatient, listPatients, searchPatients, updatePatient, consent-token flows, deletePatient) has uncovered branches, not just createPatient/updatePatient error paths — likely needs its own multi-file fan-out, not a single slice)
src/workers/workers/result-worker.js                           76.66 / 66.07   (issue #146/#164 — rename + yauzl)
src/services/SampleGraphValidator.js                           77.69 / 66.66   (issue #222 — legacy-schema migration, design fork)
src/workers/neo4jProjection.worker.js                          79.62 / 73.33   (remaining gap is the `require.main === module` CLI entry block, lines 82-99 — not coverable in-process, same accepted-gap pattern as createFirstAdmin.js)
src/interface/routes/analysis-file.routes.js                   80.95 / 87.50
src/interface/routes/master-data.routes.js                     81.42 / 68.75
src/config/redis.js                                            81.76 / 70.45
src/interface/routes/equipment.routes.js                       81.92 / 74.11
src/controllers/import.controller.js                           82.23 / 75.86
src/controllers/iot.controller.js                              82.50 / 73.52   (branches covered — see history archive; applyColdChainQuarantine catch + a couple of resolveTemperaturePolicy edge branches remain)
src/services/security.service.js                               82.51 / 72.26
src/infrastructure/queue/Neo4jQuarantineService.js              83.33 / 82.75
src/models/User.js                                             83.67 / 78.94   (note: distinct from `models/User.test.js`'s covered file — this figure is the reconcile's raw number)
src/services/fhir-import-staging.service.js                    84.15 / 77.86
src/controllers/import-async.controller.js                     84.29 / 79.66
```

Note: `sample.service.js`, `import.service.js`,
`batch-validation-engine.service.js`, `audit.controller.js`, and
`audit-canonicalization.service.js` remain in GOOD as of the prior
reconcile — not re-verified line-by-line since they're well above the
MID-HIGH cutoff.

## GOOD coverage (>=85% lines)

Not listed here (lower priority for slice-picking by a wide margin; a
full reconcile regenerates this if needed). Ask for a fresh
`--coverage --reporter=basic` run if you need this detail.

## Maintaining this file

If `test-loop` finds this file stale (a listed ZERO/LOW file turns out
already well-tested, or vice versa), fix the entry in the same commit —
don't just work around it. If the reconcile cadence above stops making
sense (too frequent/rare), update it and say why in the session's
wrap-up. Detailed per-slice writeups belong in the slice's own commit
message, never back into this file.
