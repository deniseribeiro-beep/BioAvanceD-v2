# 2026-10-17: a telemetry reading carries datastreamId and storageLocationId, the location taken from its datastream

Dictionary: TelemetryReading, V2E-0546 `datastreamId` and V2E-0547 `storageLocationId`, both `Reference`, `1..1`, Core (Dicionário de Dados v2.0.0). Issue #1317.

## The question

Every stored reading wrote its bound datastream as `telemetryDatastreamId`, and never wrote a storage location. Under which names does a reading carry the two, and where does its storage location come from?

## Decided

Decided by inference in the #1317 work, from the dictionary and the TelemetryDatastream model.

1. **A reading carries `datastreamId` (V2E-0546) and `storageLocationId` (V2E-0547).** `screenReading` stamps both on the reading's identity, so every ingestion path stores them; each is `null` when the reading is unbound. The identity no longer carries `telemetryDatastreamId`. The datastream's own id keeps its name, `telemetryDatastreamId` (V2E-0562), as does the route `/api/telemetry-datastreams/:telemetryDatastreamId`.
2. **[inference] The reading's `storageLocationId` is the `storageLocationId` of the TelemetryDatastream valid at its observedAt.** V2E-0547 is "the location monitored at the instant of observation", and the datastream valid at observedAt is the repo's one binding of sensor to location over time (V2E-0565 is `1..1` on it, and the model requires it). A payload's own `storageLocationId` or `datastreamId` is never read.
3. **The InfluxDB point, the reading's authority, is tagged `datastreamId` and `storageLocationId`** in place of the `telemetryDatastreamId` tag, by both writers (`InfluxTelemetryWriteRepository.toPoint` and `saveTelemetryPoint`). `toPoint` falls back to `telemetryDatastreamId` for a reading object built before this change and still in its buffer. No Flux query read the old tag.
4. **Old `temperatures` documents are not migrated.** One stored before this change carries `telemetryDatastreamId` and no `datastreamId`; a client-key replay returns it with `datastreamId` read from `telemetryDatastreamId`, its other keys as stored, and no `storageLocationId` invented. No code reads the old key from those documents.

## Not decided here

- **A catalog conformance target for TelemetryReading.** TelemetryReading still has no runtime target in the catalog conformance guard, so the guard does not see these two fields (#1317).
