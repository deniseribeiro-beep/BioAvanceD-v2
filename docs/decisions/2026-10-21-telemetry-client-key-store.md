# 2026-10-21: a telemetry client idempotencyKey replays from RF029's key store, not from the `temperatures` copy

Rules: RULE-024 (duplicate idempotencyKey or telemetryReadingId: "Produce no second logical measurement; return the previously confirmed outcome") and V2E-0554, "Unique idempotency key in ingestion scope" (Dicionário de Dados v2.0.0). Requirement RF009 AC7. Issue #1391, split from #1317.

## The question

The temperature route (`POST /api/temperature/reading`), MQTT and the IoT queue replayed a client `idempotencyKey` by a `findOne` on the Mongo `temperatures` copy, under its unique index `temperatures_client_idempotencyKey_v1`. `POST /api/iot/telemetry` already replayed from RF029's `ingestionIdempotencyKeys`. The copy is a reading copy the repo is removing, so the replay needs a key store that is not one. Which store, with what lifetime, and what of the keys the copy already holds?

## Decided

Decided by inference in the #1391 work; each point names the pattern it is read off.

1. **[inference] The store is RF029's `ingestionIdempotencyKeys`, not InfluxDB.** Pattern: 509ce716 already put `POST /api/iot/telemetry`'s client key there, under the scope `TelemetryReading:<sensorId>` (the sensorId as trimmed text), recorded only once InfluxDB persisted the reading. The four paths now share that scope, so one client key per sensor replays across all of them. InfluxDB is ruled out: its point carries no idempotencyKey (`telemetryReadingId` is a field only), a per-reading tag would make one series per reading, and it has no unique constraint for V2E-0554. The collection gets the unique index `ingestion_idempotency_key_scope_unique_v1` on `(idempotencyKey, scope)`, and a concurrent second record answers the first record's outcome. The resultRef holds identifiers and times only (`telemetryReadingId`, `observedAt`, `receivedAt`, `persistedAt`, `clockStatus`), never the value: the "Telemetry and time series" row of the polyglot persistence dictionary prohibits raw readings in MongoDB.
2. **[inference] A key does not expire.** Pattern: no key in `ingestion/idempotency.js` or `ReferenceImportRun` expires, the old `temperatures` index never expired, and RULE-024 sets no window.
3. **[inference] Keys the copy held before this change are not backfilled.** Pattern: the 2026-10-17 decision on the reading's datastream and location, point 4, "Old `temperatures` documents are not migrated". A client key stored only in the copy before this change replays no more.

## Not decided here

- **Removing the `temperatures` copy** is decided in 2026-10-21-telemetry-temperatures-copy-retired.md.
- **Two truly concurrent first sends** can still each write an InfluxDB point before one records the key, as before this change; only one key row is kept.
