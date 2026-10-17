# 2026-10-17: POST /api/iot/telemetry judges a bound reading against its datastream's threshold profile

Dictionary: TelemetryDatastream, V2E-0569 `thresholdProfileId`, the "versioned limits profile", `1..1`, Core (Dicionário de Dados v2.0.0). Requirement RF009 AC4. Issue #1317.

## The question

A TelemetryDatastream carries `thresholdProfileId`, but no runtime code read it. `ingestTelemetry` took a reading's limits only from the sensor's `SensorMetadata.temperaturePolicy`, even after `screenReading` had bound the reading to a datastream. Which limits judge a reading on POST /api/iot/telemetry?

## Decided

Decided by inference in the #1317 work, from the dictionary, the TelemetryDatastream model and TemperaturePolicy.schema.js.

1. **[inference] A reading bound to a datastream is judged against the TemperaturePolicy its datastream's `thresholdProfileId` names.** The datastream model says a reading "is interpreted through the datastream valid when it was observed". V2E-0569 puts the limits profile on the datastream, and TemperaturePolicy.schema.js maps `thresholdProfileId` to the policy's `_id`. The bounds, the incident, the excursion's `triggeringPolicyId`, the quarantine's `minimumDuration` and the alert e-mail's `maxTemp` all follow that policy. The sensor's name, alert e-mail and device still come from SensorMetadata.
2. **[inference] The SensorMetadata policy stays the fallback.** It judges an unbound reading (the default `record` mode stores those), a reading whose datastream profile names no policy (logged as a warning), and a reading whose datastream lookup fails. Cold-chain availability wins, as in the Axis E decision on #1106: no excursion goes unchecked because of a datastream lookup.
3. **[inference] A 24-hex `thresholdProfileId` matches either an ObjectId `_id` or a string one.** A policy created through the policy routes has an ObjectId `_id`, and one inserted with a string id has a string. The ObjectId comes from `mongoose.Types`, because the connection is mongoose's and it refuses an ObjectId from the top-level `mongodb` package's bson (#651). Any other id matches only as a string.
4. **The datastream's policy is not cached,** so a policy edit applies at the next reading. The SensorMetadata policy keeps its 60 s cache, and the datastream's policy never overwrites the cached entry, so a later unbound reading of the same sensor still sees the SensorMetadata policy.

## Not decided here

- **The other SensorMetadata readers.** TelemetryMonitor's per-sensor `minimumDuration` and freezer link, incident.controller's device link and equipment-sensor-quarantine still read SensorMetadata, not the datastream (#1317).
- **The registration-side writer.** sensor.service still writes the policy onto SensorMetadata. Creating a datastream does not check that its `thresholdProfileId` names a policy (#1317).
- **The other ingestion paths.** MQTT, the IoT queue and POST /api/temperature/reading do not read the datastream's `thresholdProfileId`. They keep the limits they used before this change (#1317).
