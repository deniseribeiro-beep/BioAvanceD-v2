# 2026-10-24: A TelemetryReading sent to the production ingestion route is refused 422 INGESTION_STORE_UNSUPPORTED, naming InfluxDB and the telemetry route, and writes nothing

Requirement RF029 AC4, AC6, AC10; RF009 AC1, AC8. Issue #1318.

## The question

`POST /api/ingestion/records` persists eight entity types, from `Dataset` to `Consent`. RF029 asks for further ones, and TelemetryReading is next. `entityType: 'TelemetryReading'` answered the generic 422 `INGESTION_TARGET_UNSUPPORTED`, which says nothing about why, and the `ingestionTargets.js` header promised that a later slice would name telemetry in the refusal. Can TelemetryReading be a target, reusing the repo's trusted telemetry write path? If not, what does the route answer?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-24. The pattern, read off the eight existing targets and their records: the route refuses what it cannot place, rather than placing it in the wrong store or storing it as sent. OmicsRun's three Object Storage modalities are refused 422 `INGESTION_STORE_UNSUPPORTED` (`docs/decisions/2026-10-23-ingestion-omics-run-target.md`), and Participant's and Consent's identity fields are refused, never quarantined as sent (`docs/decisions/2026-10-24-ingestion-consent-target.md`).

1. **TelemetryReading is not a target.** The repo's trusted telemetry write path is `services/temperature.service.js` `createTemperatureReading`, behind `POST /api/temperature/reading` (permission `recordTemperature` plus organization scope) and the machine-secret routes `POST /api/temperature/system/reading` and `POST /api/iot/telemetry`. It screens the reading (`telemetryReadingContract.js` `screenReading`), dedupes on `TelemetryReading:<sensorId>`, and writes InfluxDB. This route cannot reuse it:
   - (a) **A quarantine would put the reading's fields in MongoDB.** A schema or reference failure stores the record as sent in `ingestionQuarantineRecords`. TelemetryReading's store is InfluxDB, "InfluxDB authoritative" (`docs/extracted-v2.0.0/dict-ENTIDADES.md` line 141); RF009 AC1 persists every field of a reading in InfluxDB alone (`requisitos.md` line 323), RF029 AC4 keeps it whole there (line 943), and references to masters "não transferem campos da leitura ao MongoDB" (line 1406).
   - (b) **The route's transaction has no InfluxDB part.** Its write is a MongoDB document and its outbox event in one transaction (RF029 AC6); InfluxDB cannot join it, and RF029 AC6 and RF009 AC8 forbid projecting a raw reading.
   - (c) **The shapes differ.** `canonical.v1.telemetry` (`contracts/canonical/v1/index.js`: `metricType`, `value`, `unit`) is not what the trusted path takes (temperature only: `temperatureValue`, `temperatureUnit`). Mapping one onto the other is a contract decision.
   - (d) **The gates differ.** The route's gate is `requireRole(3, 4)`, not `recordTemperature` plus organization scope, so reusing the path would open a second permission into the cold-chain record.
2. **It is refused by name.** `ingestionTargets.js` gains `OTHER_STORE_ENTITY_TYPES`, which names `TelemetryReading` with `store: 'influxdb'` and `route: 'POST /api/temperature/reading'`, and `resolveOtherStoreEntityType`, an own-property lookup like `resolveIngestionTarget`. Only the exact name `TelemetryReading` (RF029's and dict-ENTIDADES') is named; `Telemetry`, `telemetry` and `TelemetryIngestionEvent` stay unknown and answer `INGESTION_TARGET_UNSUPPORTED` before the releases are read.
3. **The refusal comes after the releases are read.** `productionIngestion.js` `ingestAndPersist` reads the canonical release as for a target, so an inactive or missing release still answers 503 `CANONICAL_RELEASE_NOT_ACTIVE` first, then the configuration release. It then throws 422 `INGESTION_STORE_UNSUPPORTED`, "TelemetryReading é armazenado no InfluxDB, não suportado pela ingestão; registre a leitura por POST /api/temperature/reading", stamped with both release ids (CFG-004).
4. **It writes nothing and audits one row.** The refusal reads neither the payload nor the idempotency key, and its message holds no payload value. No document, quarantine record, idempotency key, MissingDataReason, DataQualityAssessment or outbox event is written. The route writes its one `INGESTION_REFUSED` warning row naming both release ids (RF029 AC10), as for any refusal.

## Not decided here

- **TelemetryReading ingestion through this route.** It needs an InfluxDB write the route's transaction cannot hold, and a mapping of `canonical.v1.telemetry` onto the reading contract.
- **TelemetryIngestionEvent and the other MongoDB telemetry entities** (dict-ENTIDADES lines 138-142) as targets.
- **File and binary targets.**
- **Specimen storage allocation.**
