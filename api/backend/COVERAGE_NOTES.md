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

Last full reconcile: **2026-07-02**, snapshot from commit `bb6e9d69`.
Baseline: Statements 37.46%, Branches 34.82%, Functions 40.93%, Lines
37.71% (6536/17331).

## How to use this when picking a slice

1. Prefer a **ZERO** file with real logic (not a script/model/port
   interface) over a **LOW** file — bigger jump per slice.
2. Skip `src/scripts/*` (one-off migration/seed scripts, not exercised in
   prod request paths) and `src/core/application/ports/*` (interfaces,
   zero logic) unless a slice specifically needs them — low value.
3. After landing a slice, delete the file's line from whichever bucket it
   was in (or move it, if now partial). Don't leave stale entries.

## ZERO coverage (0% lines) — 26 files

Real logic, worth prioritizing:
- `src/workers/import-worker.js`
- `src/workers/worker.js`

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

## LOW coverage (1-49% lines) — 114 files

Sorted ascending (worst first). This is the primary slice-picking pool:

```
src/infrastructure/persistence/mongo/MongoStorageRepository.js      2.23%
src/infrastructure/persistence/mongo/MongoStorageTopologyReadRepository.js  2.98%
src/services/storageService.js                                     2.99%
src/models/SampleFile.js                                           3.44%
src/core/use-cases/MoveSampleUseCase.js                             3.89%
src/models/ImportMetrics.js                                        4.54%
src/controllers/import-lgpd.controller.js                          5.03%
src/database/mongo.js                                               5.19%
src/controllers/sample-file.controller.js                          5.39%
src/controllers/import.controller.js                               6.77%
src/services/import-async.service.js                               6.87%
src/models/IntelligentAssistant.js                                 7.14%
src/controllers/import-async.controller.js                         7.43%
src/services/assistant.service.js                                  7.54%
src/infrastructure/persistence/mongo/MongoPatientConsentReadRepository.js  8.33%
src/services/terminologySync.service.js                            9.16%
src/services/consentNeo4jSync.service.js                           9.25%
src/services/analysisValidation.service.js                         9.3%
src/config/redis.js                                                 9.43%
src/infrastructure/database/neo4j/LineageRepository.js              9.52%
src/services/hl7Audit.service.js                                   10.2%
src/models/ExtractionProtocol.js                                   11.11%
src/models/QualityDescription.js                                   11.11%
src/models/SampleOrigin.js                                         11.11%
src/models/SampleType.js                                           11.11%
src/infrastructure/database/neo4j/connection.js                    11.53%
src/services/biomarker-integrity.service.js                        12.12%
src/services/mqtt-ingestion-audit.service.js                       14.28%
src/services/import-lgpd.service.js                                14.5%
src/core/use-cases/ReleaseSampleUseCase.js                         14.58%
src/controllers/import-batch.controller.js                         15.25%
src/routes/importFhirIntelligent.js                                15.58%
src/infrastructure/database/influxdb/connection.js                 16.12%
src/infrastructure/persistence/mongo/MongoAuditRepository.js       16.66%
src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository.js  17.24%
src/config/validateEnv.js                                          17.64%
src/config/queue.js                                                18.3%
src/services/sendCriticalAlertEmail.js                             18.75%
src/services/sample.service.js                                     18.81%
src/interface/routes/security.routes.js                            18.91%
src/interface/routes/reports.routes.js                             19.06%
src/core/use-cases/AllocateSampleUseCase.js                        19.14%
src/infrastructure/database/mongodb/connection.js                  19.23%
src/controllers/upload.controller.js                               19.51%
src/core/use-cases/CheckStorageBoxIntegrityUseCase.js              20%
src/core/use-cases/GetFreezerOccupancyStatsUseCase.js              20%
src/core/use-cases/GetFreezerTreeUseCase.js                        20%
src/core/use-cases/GetSampleStorageLocationUseCase.js              20%
src/core/use-cases/SearchAllocatableSamplesUseCase.js              20%
src/core/use-cases/ValidateStoragePositionUseCase.js               20%
src/services/staging-import.service.js                             20%
src/services/sensor.service.js                                     20.25%
src/interface/controllers/auto-assign-sample.controller.js         21.05%
src/services/saveTelemetryPoint.js                                 22.22%
src/services/biomarker-xai.service.js                              22.66%
src/interface/routes/compliance.routes.js                          23%
src/controllers/cid.controller.js                                  23.52%
src/controllers/temperature.controller.js                          23.88%
src/workers/workers/result-worker.js                               24.21%
src/interface/routes/result.routes.js                              24.33%
src/interface/controllers/storage-query.controller.js              24.7%
src/services/fhir-sync.service.js                                  25.11%
src/services/consent.service.js                                    26.1%
src/routes/dictionary.js                                           26.71%
src/interface/routes/auth.routes.js                                28.49%
src/routes/hpo.js                                                  28.94%
src/services/fhir-validator.service.js                             29.06%
src/interface/controllers/move-sample.controller.js                29.16%
src/models/Result.js                                                30.76%
src/routes/orphanet.js                                              30.76%
src/controllers/incident.controller.js                             31.73%
src/interface/routes/location.routes.js                            32.25%
src/models/StorageContainer.js                                     32.69%
src/interface/routes/terminologies.routes.js                       32.9%
src/core/use-cases/ListOperationalFreezersUseCase.js                33.33%
src/infrastructure/integration/semantic-pointer.js                 33.33%
src/infrastructure/middleware/consent.enforcement.js                33.33%
src/interface/routes/sample.routes.js                               33.33%
src/services/log.service.js                                        33.86%
src/services/import.service.js                                     34.19%
src/services/auth.service.js                                       34.88%
src/config/uploadConfig.js                                          35.89%
src/interface/controllers/allocate-sample.controller.js            36.84%
src/interface/controllers/release-sample.controller.js             36.84%
src/services/integrityCheckService.js                               36.84%
src/services/fhir.service.js                                        36.92%
src/services/hl7.service.js                                         38.05%
src/services/temperature.service.js                                38.96%
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

**Known stale entry:** `src/services/NotificationService.js` — 2026-07-02 added unit
tests for its pure helpers only (`normalizePhoneE164`, `resolvePatientEmail`,
`resolvePatientPhone`, `formatConsentMessage`, `resolveRecipient`,
`generateConsentToken`, `buildConsentMetadata`, `buildConsentLink`,
`generateJobEmailTemplate`, `generateJobErrorEmailTemplate`, and
`sendCriticalTempAlert`'s threshold branch). `sendEmail`/Resend, BullMQ queue,
Socket.IO, Mongo compliance-log, and Influx-backed methods are still
untested — moved off the 11.66% line here since the real % is now unknown
without a reconcile run; treat as a LOW-priority slice for a future
iteration (real request-path email-sending logic, not legacy) rather than
re-adding a guessed number.

## MID coverage (50-84% lines) — 40 files, GOOD (>=85%) — 75 files

Not re-listed here (lower priority for slice-picking; a full reconcile
regenerates these buckets if needed). Ask for a fresh
`--coverage --reporter=basic` run if you need this detail.

## Maintaining this file

If `test-loop` finds this file stale (a listed ZERO/LOW file turns out
already well-tested, or vice versa), fix the entry in the same commit —
don't just work around it. If the reconcile cadence above stops making
sense (too frequent/rare), update it and say why in the session's
wrap-up.
