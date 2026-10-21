# 2026-10-21: the Mongo `temperatures` copy of a telemetry reading is retired, and its existing data is left in place

Requirement RF009 AC1 (InfluxDB is a reading's store). Issue #1391, split from #1317.

## The question

Every ingestion path wrote a reading to InfluxDB and then a second time to the Mongo `temperatures` collection: the temperature route (`temperature.service.js` createTemperatureReading), MQTT and the IoT queue (`iot-streaming.service.js` processTemperatureData), and the temperature import (`import.service.js` importTemperature). An organization's delete also counted `temperatures` documents as references (#1284). The single-reading read (`GET /api/temperature/:id`, a423ae37) and the client-key replay (2026-10-21-telemetry-client-key-store.md) no longer read the copy. What happens to the copy's code, and to the data it already holds?

## Decided

Decided by inference in the #1391 work; each inferred point names the pattern it is read off.

1. **No backend code writes or reads `temperatures`.** The three writers drop their `insertOne`, and the organization delete drops the `temperatures` entry from `ORGANIZATION_REFERENCES`. A created reading answers its `telemetryReadingId`, never a Mongo `_id`, and the route's CREATE audit names that id as its `resourceId`. The architecture test `temperatures-copy-retired.arch.test.js` fails the day a file under `api/backend/src` or `api/backend/scripts` names the collection in a `collection(...)`/`getCollection(...)` call or as a `name:` entry.
2. **[inference] The existing collection and its index `temperatures_client_idempotencyKey_v1` are left in place: not dropped, not migrated.** Patterns: the 2026-10-17 decision on the reading's datastream and location, point 4, "Old `temperatures` documents are not migrated"; the 2026-10-21 key-store decision, point 3, which does not backfill the keys the copy held; and the coexistence rule that keeps the legacy `locations` collection read-only during the transition (#457/#466, `import.service.js` importLocations). With no writer, the index refuses nothing. Dropping the collection or the index is an operator's act, outside this change.
3. **[inference] An organization referenced only by old copy documents can now be deleted, and those documents keep an `organizationId` that names nothing.** Pattern: point 2, since a document no code reads names nothing a caller can reach. The other references (`equipment`, `sensors`, `alerts`, `samples` and the rest) still refuse the delete.

## Not decided here

- **Removing the old documents, or the index, from a database.** No migration script or drop is written here (point 2).
