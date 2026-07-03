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
  `cd api/backend && npx vitest run --coverage --reporter=basic`, then
  re-derive buckets from `coverage/coverage-summary.json` (`lines.pct`
  per file). `coverage/` is gitignored — this file is the durable record.

Last full reconcile: **2026-07-02**, snapshot from commit `301dc9a9`
(end-of-loop reconcile after the biomarker-integrity / mqtt-ingestion-audit
/ auto-assign-sample.controller / import-batch.controller / MongoAuditRepository
/ validateEnv / AllocateSampleUseCase / config-queue / InfluxTelemetryWriteRepository
parallel-test-agents slices landed, plus hl7Audit.service / ReleaseSampleUseCase /
MoveSampleUseCase from the prior session).
Baseline: Statements 46.72%, Branches 42.34%, Functions 53.06%, Lines
47.11% (8165/17331). Full suite green (exit 0) on this run.

Since baseline: `MongoStorageTopologyReadRepository.js`, `database/mongo.js`,
and `sample-file.controller.js` moved off the LOW bucket by a
parallel-test-agents slice (63 new targeted tests, all green) — exact new
percentages not yet re-measured, will land at the next full reconcile.

Since baseline (2nd slice): `SampleFile.js`, `ImportMetrics.js`, and
`import.controller.js` moved off the LOW bucket by a parallel-test-agents
slice (90 new targeted tests, all green) — exact new percentages not yet
re-measured, will land at the next full reconcile. This slice also
surfaced two real product bugs, filed as issues #25 and #26 (see below).

Since baseline (3rd slice): `IntelligentAssistant.js`, `import-async.service.js`,
and `import-async.controller.js` moved off the LOW bucket by a
parallel-test-agents slice (107 new targeted tests, all green) — exact new
percentages not yet re-measured, will land at the next full reconcile. This
slice surfaced a real crash-risk bug, filed as issue #27 (see below).

Since baseline (4th slice): `assistant.service.js`, `MongoPatientConsentReadRepository.js`,
and `terminologySync.service.js` moved off the LOW bucket by a
parallel-test-agents slice (58 new targeted tests, all green) — exact new
percentages not yet re-measured, will land at the next full reconcile. This
slice surfaced a consent-bypass compliance risk (#28) and two terminology-sync
bugs (#29, #30) — see below.

Since baseline (5th slice): `consentNeo4jSync.service.js`, `analysisValidation.service.js`,
and `config/redis.js` moved off the LOW bucket by a parallel-test-agents slice
(67 new targeted tests, all green) — exact new percentages not yet re-measured,
will land at the next full reconcile. This slice surfaced a minor real bug
(#31 — REDIS_URL-embedded username always ignored) — see below.

Since baseline (6th slice): `LineageRepository.js`, `neo4j/connection.js`, and
`import-lgpd.service.js` moved off the ZERO/LOW buckets by a parallel-test-agents
slice (87 new targeted tests, all green) — exact new percentages not yet
re-measured, will land at the next full reconcile. This slice surfaced one
confirmed bug (#35 — missing eventType validation in recordCustodyEvent) and two
lower-confidence findings (#36, #37 — sanitizeRowForError over-stripping,
lenient birth-date parsing) — see below.

Since baseline (7th slice): `sample.service.js` and
`infrastructure/database/influxdb/connection.js` moved off the LOW bucket, and
`security.routes.js` got integration coverage extended (pre-existing test file),
by a parallel-test-agents slice (77 new targeted tests, all green) — exact new
percentages not yet re-measured, will land at the next full reconcile. This
slice surfaced two confirmed bugs (#38 — SampleModel export shadowing breaks
sample creation/withdrawal/return validation in production, #39 — returnSample's
PT-BR condition literals never match the real English RETURN_CONDITIONS values),
one lower-confidence route inconsistency (#40 — /consent-queue missing the db
availability check its siblings have), and one test-tooling finding affecting
other files too (#41 — `await import()` on CJS sources defeats `vi.spyOn` the
same way `vi.mock()` does) — see below.

Since baseline (8th slice): `infrastructure/database/mongodb/connection.js`,
`controllers/upload.controller.js`, and `services/staging-import.service.js` moved off
the LOW bucket by a parallel-test-agents slice (38 new targeted tests, all green) —
exact new percentages not yet re-measured, will land at the next full reconcile. This
slice surfaced two confirmed bugs (#42 — upload.controller.js's consent-pending branch
never actually returns 409/CONSENT_PENDING correctly since `patientStatus` is never the
literal string `'PENDING_CONSENT'`, always falls through to 400; #43 —
staging-import.service.js writes failure records to a schema field key (`errors`) that
doesn't exist on the `StagingImport` model, which only declares `importErrors`, so
Mongoose's strict mode silently drops them) — see below.

Since baseline (9th slice): `sensor.service.js` (non-quarantine paths),
`saveTelemetryPoint.js`, and `biomarker-xai.service.js` moved off the LOW
bucket by a parallel-test-agents slice (63 new targeted tests, all green) —
exact new percentages not yet re-measured, will land at the next full
reconcile. This slice surfaced two findings for domain/design review (#44 —
sensor.service.js's `updateSensor` mutates the caller's `updateData` object
plus its `quarantineService` singleton state has no reset guard;
#45 — biomarker-xai.service.js's alphaGal rule table has no elevated-value
zone, unlike lysoGb3's full three-zone scheme) — see below.

Since baseline (10th slice): `import-worker.js` moved off the ZERO bucket by a
test-writer slice (19 new targeted tests, all green) — exact new percentage
not yet re-measured, will land at the next full reconcile. This slice
surfaced one confirmed bug (#46 — the batch-import branch runs before the
processor's surrounding try/catch, so its dedicated failure-handling catch
block that marks batch progress as `'failed'` is dead code; a rejected
batch-import job just propagates the error with no progress update) — see
below.

Since baseline (11th slice): `ExtractionProtocol.js`, `QualityDescription.js`,
`SampleOrigin.js`, and `SampleType.js` moved off the LOW bucket by a
parallel-test-agents slice (32 new targeted tests, all green — these four
models are byte-for-byte identical in shape, so one `describe.each`-driven test
file covered all four with no bugs found). In the same iteration,
`reports.routes.js` got 10 new integration tests added to its existing test
file (13 total now green), covering the `:id`/`:type` route family
(get-by-id/delete dual reportID-then-ObjectId resolution, preview/export/
export-pdf, a 503-without-db case) — but only exercises the trivial
`audit`/logs branch of `buildPreviewData`'s ~10-branch type dispatch, so it's
left in the LOW bucket rather than moved off; the other branches (notably
`samplesByPatient`'s cross-collection `distinct`/grouping logic) are a good
candidate for a follow-up slice. Exact new percentages not yet re-measured,
will land at the next full reconcile. No bugs surfaced this slice.

Since baseline (12th slice): `importFhirIntelligent.js` moved off the LOW
bucket by a test-writer slice (9 new integration tests, all green) covering
the Bundle-validation 400 path, the full Patient/Specimen/Observation happy
path with exact filter/update assertions, non-strict-mode semantic-contract
warnings (missing ORPHA coding, invalid HPO coding), strict-mode 422
rejection with no model writes, skip-on-no-resource and
skip-on-unrecognized-resourceType, and a 500 error path confirming the
`finally`-block Neo4j session close still runs. In the same iteration, the
six tiny `src/core/use-cases/*UseCase.js` files (`CheckStorageBoxIntegrityUseCase`,
`GetFreezerOccupancyStatsUseCase`, `GetFreezerTreeUseCase`,
`GetSampleStorageLocationUseCase`, `SearchAllocatableSamplesUseCase`,
`ValidateStoragePositionUseCase`) moved off the LOW bucket by a second,
independent test-writer slice (19 new targeted tests, all green — each is a
thin constructor-injected delegate to a repository method, following the
existing `GetBoxAvailablePositionsUseCase.test.js` pattern). Exact new
percentages not yet re-measured, will land at the next full reconcile. No
bugs surfaced this slice; one minor response-shape inconsistency noted (not
filed) — `importFhirIntelligent.js`'s strict-mode 422 body returns
`semanticContract: { strictMode, violations }` while non-strict 200 returns
`semanticContract: { strictMode, warnings }`, a differently-keyed shape for
the same concept depending on status code.

## How to use this when picking a slice

1. Prefer a **ZERO** file with real logic (not a script/model/port
   interface) over a **LOW** file — bigger jump per slice.
2. Skip `src/scripts/*` (one-off migration/seed scripts, not exercised in
   prod request paths) and `src/core/application/ports/*` (interfaces,
   zero logic) unless a slice specifically needs them — low value.
3. After landing a slice, delete the file's line from whichever bucket it
   was in (or move it, if now partial). Don't leave stale entries.

## ZERO coverage (0% lines) — 21 files

Real logic, worth prioritizing:
- `src/workers/worker.js` (self-executing bootstrap entrypoint — calls
  `startWorker()`/`process.exit` at module load; disproportionately
  expensive to test honestly, lower priority than it looks)

Low priority (models/interfaces/one-off scripts — thin or non-request-path):
- `src/core/application/ports/IAuditRepository.js`
- `src/core/application/ports/ILineageRepository.js`
- `src/core/application/ports/IPatientConsentReadRepository.js`
- `src/core/application/ports/IStorageRepository.js`
- `src/core/application/ports/IStorageTopologyReadRepository.js`
- `src/models/Cid.js`
- `src/models/ClinicalRecord.js`
- `src/models/Disease.js`
- `src/models/DrugDictionary.js`
- `src/models/Equipment.schema.js`
- `src/models/StoragePath.js`
- `src/models/TemperaturePolicy.schema.js`
- `src/models/Withdrawal.js`
- `src/scripts/migrate-rcs-governance-indexes.js`
- `src/scripts/migrateUserAnonIds.js`
- `src/scripts/seed-admin.js`
- `src/scripts/seedDiseaseValidationRules.js`
- `src/scripts/seedOrphanetCid.js`
- `src/scripts/seeder.js`

## LOW coverage (1-49% lines) — 89 files

Sorted ascending (worst first). This is the primary slice-picking pool:

```
src/interface/routes/reports.routes.js                    19.06% (partially extended, see 11th slice note above)
src/interface/routes/compliance.routes.js                           23%
src/controllers/cid.controller.js                                   23.52%
src/controllers/temperature.controller.js                           23.88%
src/workers/workers/result-worker.js                                24.21%
src/interface/routes/result.routes.js                               24.33%
src/interface/controllers/storage-query.controller.js               24.7%
src/services/fhir-sync.service.js                                   25.11%
src/services/consent.service.js                                     26.1%
src/routes/dictionary.js                                            26.71%
src/services/NotificationService.js                                 28.33%
src/interface/routes/auth.routes.js                                 28.49%
src/routes/hpo.js                                                   28.94%
src/services/fhir-validator.service.js                              29.06%
src/interface/controllers/move-sample.controller.js                 29.16%
src/models/Result.js                                                30.76%
src/routes/orphanet.js                                              30.76%
src/controllers/incident.controller.js                              31.73%
src/interface/routes/location.routes.js                             32.25%
src/models/StorageContainer.js                                      32.69%
src/interface/routes/terminologies.routes.js                        32.9%
src/core/use-cases/ListOperationalFreezersUseCase.js                33.33%
src/infrastructure/integration/semantic-pointer.js                  33.33%
src/infrastructure/middleware/consent.enforcement.js                33.33%
src/interface/routes/sample.routes.js                               33.33%
src/services/log.service.js                                         33.86%
src/services/import.service.js                                      34.19%
src/services/auth.service.js                                        34.88%
src/config/uploadConfig.js                                          35.89%
src/interface/controllers/allocate-sample.controller.js             36.84%
src/interface/controllers/release-sample.controller.js              36.84%
src/services/integrityCheckService.js                               36.84%
src/services/fhir.service.js                                        36.92%
src/services/hl7.service.js                                         38.05%
src/services/temperature.service.js                                 38.96%
src/services/patientBiomarkerTimeseries.service.js                  39.02%
src/database/neo4j.js                                               40%
src/models/StorageBox.js                                            41.74%
src/services/patient.service.js                                     42.58%
src/services/session.service.js                                     43.75%
src/services/miabisValidator.service.js                             44.82%
src/services/sampleComplianceSync.service.js                        45.45%
src/services/batch-validation-engine.service.js                     45.76%
src/interface/routes/logs.routes.js                                 46.93%
src/interface/routes/equipment.routes.js                            47.09%
src/controllers/audit.controller.js                                 47.56%
src/services/DrugService.js                                         47.82%
src/routes/eConsent.js                                               47.88%
```

## MID coverage (50-84% lines) — 44 files, GOOD (>=85%) — 104 files

Not re-listed here (lower priority for slice-picking; a full reconcile
regenerates these buckets if needed). Ask for a fresh
`--coverage --reporter=basic` run if you need this detail.

## Maintaining this file

If `test-loop` finds this file stale (a listed ZERO/LOW file turns out
already well-tested, or vice versa), fix the entry in the same commit —
don't just work around it. If the reconcile cadence above stops making
sense (too frequent/rare), update it and say why in the session's
wrap-up.
