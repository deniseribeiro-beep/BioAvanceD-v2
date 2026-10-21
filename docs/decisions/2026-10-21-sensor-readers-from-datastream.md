# 2026-10-21: the policy and freezer readers of SensorMetadata read the TelemetryDatastream first

Dictionary: TelemetryDatastream, V2E-0562..0571, in particular V2E-0569 `thresholdProfileId` and the datastream's storage location (Dicionário de Dados v2.0.0). Requirement RF009 AC4, RF017 AC5. Issue #1392.

## The question

POST /api/iot/telemetry already judges a bound reading against its datastream's `thresholdProfileId` (2026-10-17-telemetry-threshold-from-datastream.md). Three readers still took a sensor's limits and freezer only from the `sensorMetadata` collection: TelemetryMonitor's per-sensor `minimumDuration` and its freezer link, the temperature report's bounds, and the cold-chain quarantine's boxes. Where do they read a sensor's limits and freezer from?

## Decided

Decided by inference in the #1392 work, from the TelemetryDatastream model, `resolveReadingBinding`, the 2026-10-17 record and `findBoxIdsBySensorKey`. The readers share `services/sensorDatastream.service.js`.

1. **[inference] A sensor's limits and its freezer come from the temperature datastream valid now.** The limits are TelemetryMonitor's `minimumDuration` and the report's `minThreshold`/`maxThreshold`, from the TemperaturePolicy the datastream's `thresholdProfileId` names. It is the datastream valid at the time of the lookup, not the one valid at each reading's time. These readers answer about the sensor's current binding, as SensorMetadata did, and the stream is picked as `resolveReadingBinding` picks it: the `temperature` stream whose validity period `TelemetryDatastreamModel.validAt` accepts.
2. **[inference] SensorMetadata stays the fallback.** It answers for an unbound sensor, for a datastream whose profile names no policy, for a datastream whose location is not a mirrored freezer, and for a datastream lookup that fails (logged as a warning). This is decision 2 of the 2026-10-17 record: cold-chain availability wins.
3. **[inference] The quarantine takes the union of the datastream's boxes and the legacy sources.** `findBoxIdsBySensorKey` already unions what `sensors` and `sensorMetadata` resolve, so the datastream adds its freezer's boxes and its equipment's boxes to that union rather than replacing it.
4. **[inference] A datastream's freezer is the StorageContainer whose mirrored StorageLocation it names.** The placement chain mirrors a FREEZER StorageContainer as a StorageLocation with code `legacy-storage-container:<container _id>` (#1379). The container's stored `_id` is used as read, and no ObjectId is built, because the readers reach Mongo through both the driver's and mongoose's handles (#651, #912).

## Not decided here

- **The excursion's equipment key.** iot.controller's `upsertEnvironmentalExcursion`, incident.controller's `closeEnvironmentalExcursion` and TelemetryMonitor's `findSensorsWithMissingReadings` still key the excursion by `sensorMetadata.device` (#1392).
- **The sensor registration writer.** sensor.service.js still writes the policy and freezer onto SensorMetadata (#1392).
- **The exposure through the assignment chain,** #1392's third line.
