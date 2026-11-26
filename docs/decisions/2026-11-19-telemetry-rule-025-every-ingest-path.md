# 2026-11-19: every telemetry ingest path strips non-contract fields at receipt, flags the reading and writes one security audit

Requirements RF009 AC7–AC8, RNF004 C7; rule RULE-025. Issue #1582. Follows `2026-11-18-telemetry-rule-025-gold-standard.md`, which ruled the policy for every path and left the code on each path, and the security audit's shape, to follow it.

## The question

The 2026-11-18 record rules that a trustworthy reading arriving with non-contract fields is kept, those fields stripped before hash, screen or store, the reading quarantined and flagged, and a security audit recorded, never a silent drop. Before #1582, only `POST /api/iot/telemetry` and MQTT stripped such fields, and no path wrote a security audit. The temperature routes hashed the whole body, extras included, into the stored `payloadHash`; the temperature import dropped an extra column silently. What does each path do?

## Decided

Decided on #1582 on 2026-11-19, implementing the 2026-11-18 ruling. Where the ruling leaves a point open, the choice is marked [inference].

1. **Each path has its own contract field list,** the top-level fields that path reads:
   - `POST /api/iot/telemetry`: `IOT_API_READING_FIELDS` in `api/backend/src/services/telemetryReadingContract.js`.
   - MQTT: `MQTT_READING_FIELDS` in `api/backend/src/services/mqtt-telemetry.service.js`.
   - `POST /api/temperature/reading` and `POST /api/temperature/system/reading`: `TEMPERATURE_API_READING_FIELDS` in `api/backend/src/services/temperature.service.js`, one list for both routes.
   - The temperature CSV import: `TEMPERATURE_IMPORT_READING_FIELDS` in `api/backend/src/services/import.service.js`, the columns `parseTemperatureCSV` reads.
   - The iot-queue: `IOT_QUEUE_READING_FIELDS` in `api/backend/src/services/iot-streaming.service.js`.
2. **The split is at receipt.** Every other top-level field is stripped before the reading is hashed, screened, looked up, queued or stored, so no value of it reaches an issue, a log, a hash or a store.
3. **`payloadHash` covers the contract fields only,** on every path. The MQTT ingestion trail's `payloadHash` is the hash of `canonicalJson` of the contract fields; the device's HMAC is still verified over the raw message it signed.
4. **The reading is flagged.** A `personal_data_stripped` TelemetryValidationIssue, disposition `quarantined`, lists the listable field names only and counts any other, never a value.
5. **One security audit per received payload that carried a non-contract field,** whatever the reading's fate: a `TELEMETRY_PII_STRIPPED` AuditEvent with severity `warning`, resourceType `TelemetryReading`, the sensor as resourceId, and source `api` (the IoT and temperature routes), `mqtt` (MQTT) or `worker` (the iot-queue and the import). Its payload names the path, the listable field names and the count of the others, never a value. A contract-only payload writes none.
6. **A malformed MQTT message is logged without its text.**
7. **Disposition is unchanged.** A valid temperature is never refused for extra fields alone; an untrustworthy one (`invalid_value`, a payloadHash mismatch, an unbound or unregistered device under `enforce`) is still refused whole, and its extra fields are still audited.
8. **No telemetry path writes to Neo4j or the outbox** (RULE-028). `git grep -n -I -i -E "outbox|neo4j"` over the six path files (`iot.controller.js`, `mqtt-telemetry.service.js`, `iot-streaming.service.js`, `temperature.controller.js`, `temperature.service.js`, `import.service.js`) returns only a comment at `api/backend/src/controllers/iot.controller.js:114`; this record adds no such write.

### Inferences

- [inference] **The audit is written at receipt, not at the screen,** so a payload refused before the screen (a missing sensorId, an unknown sensor's 404, a validation 422) is audited too.
- [inference] **The audit's shape** in point 5; the 2026-11-18 record left it open.
- [inference] **The iot-queue is audited once, at socket receipt** in `handleTemperatureData`, before its two refusals (a missing `deviceId` or `temperature`, an unregistered device). `processTemperatureData`, which the worker runs, flags the reading but writes no audit, so a retried job never audits again. The queued job carries only the listable stripped names plus `unlistedFieldCount`, the count of the others.
- [inference] **The import is audited per row,** as the issue is per reading, with no narrowing to one audit per file. A blank or whitespace-only cell of an extra column carries no value and is not counted, so an empty extra column flags nothing; a contract cell reaches `parseTemperatureCSV` as received, so a blank one is refused or defaulted as before.
- [inference] **`temperature` is outside the temperature routes' list:** `TemperatureModel` requires `temperatureValue`, and nothing on that path reads `temperature`.

## The proof

The `RULE-025 on POST /api/iot/telemetry (#1582)` describe in `api/backend/tests/unit/iot.controller.test.js`; `RULE-025 on MQTT (#1582)` in `api/backend/tests/unit/mqtt-telemetry.service.test.js`; `RULE-025 on the queue (#1582)` in `api/backend/tests/unit/iot-streaming.service.test.js`, with the cases `passes the queued job's stripped field names on and drops non-text entries` and `rebuilds one unnamed entry per counted non-listable field and ignores a bad count` in `api/backend/tests/unit/import-worker.test.js`; `RULE-025 on the temperature routes (#1582)` in `api/backend/tests/unit/temperature.controller.test.js`; `RULE-025 in createTemperatureReading (#1582)` in `api/backend/tests/unit/temperature.service.test.js`; and `RULE-025 on the temperature import (#1582)` in `api/backend/tests/unit/import.service.importLocationsTemperature.test.js`.

## Not decided here

- **Personal data nested inside a contract field's value** (still a follow-up, as the 2026-11-18 record leaves it).
- **The Specimen-Container-Position-Rack-Location chain.**
- **A patient or `participantId` on the payload.**
