# 2026-10-21: sensor registration and edit write the sensor's temperature TelemetryDatastream

Dictionary: TelemetryDatastream, V2E-0562..0571, in particular V2E-0568 `samplingPolicyId` (1..1) (Dicionário de Dados v2.0.0). Requirement RF009 AC4, RF017 AC5. Issue #1392.

## The question

The readers take a sensor's limits and freezer from its temperature TelemetryDatastream valid now, with SensorMetadata as their fallback (2026-10-21-sensor-readers-from-datastream.md), and the migration builds one datastream from each SensorMetadata row (2026-10-21-sensor-metadata-to-datastream-migration.md). sensor.service.js wrote a registration's freezer and TemperaturePolicy, and an edit's rebind, only onto SensorMetadata. A sensor registered after the migration had no datastream, and one rebound after it kept a datastream that no longer matched its SensorMetadata. What do registration and edit write, and where does the datastream's sampling policy come from?

## Decided

Decided by inference in the #1392 work, from the migration record, the TelemetryDatastream model and `telemetryBinding.service.js`. The binding rules are shared: `resolveTemperatureBinding` and `assertStoredSamplingPolicy` in `services/sensorDatastream.service.js`, which the migration also uses.

1. **[inference] A registration's sampling policy is its `samplingPolicyId`, checked as a stored ConfigurationProfile `profileId` before anything is written; an unstored one is a 422.** No SensorMetadata field, form field or route carries a sampling policy, and V2E-0568 is 1..1. Pattern: the migration record's decision 1 (and the 2026-10-14 facility-room migration's `--organization-id`), a value that cannot be derived is supplied by its caller and refused when not stored.
2. **[inference] The registration form sends no `samplingPolicyId`,** since no route lists a sampling ConfigurationProfile. A sensor registered without one writes SensorMetadata only, exactly as before, and is bound by a later run of `npm run migrate:sensor-metadata-to-datastreams`, which also rebinds a sensor whose stream an edit ended. Pattern: the migration record's decision 1 (a value that cannot be derived is supplied by its caller) and its "Not decided here" note that a sensor registered after the run is bound when the migration runs again.
3. **[inference] A registration with a `samplingPolicyId` writes the datastream from the freezer and policy it binds on SensorMetadata, by the migration's rules, starting at the registration, and no freezer location is created.** Pattern: the migration record's decisions 2 to 4. A binding that does not resolve (`freezer_not_located`, `no_equipment`, `no_policy`) or a write that fails (an overlap, a validation, a DB error) is reported as `datastreamBound: false` with `datastreamUnresolved`, and never undoes the registration. Pattern: `metadataLinked` (#313), the sensor is already created when the binding is written.
4. **[inference] An edit that rebinds the freezer or the policy moves the datastream valid now: it is ended at the edit and, when the new binding resolves, a new one starts at the edit with the old one's sampling policy and unit.** An edit that leaves the binding as it was writes nothing, and a sensor with no datastream gets none on edit. Pattern: `telemetryBinding.service.js`, a change of equipment, location or profile is a new datastream after the old one's validity is ended, over half-open `[start, end)`.
5. **[inference] When the edited binding does not resolve (the policy or the freezer cleared, a freezer not mirrored), the datastream is only ended.** The readers then fall back to SensorMetadata, which holds the edit. Pattern: the readers record's decision 2, SensorMetadata stays the fallback, and cold-chain availability wins. A failure here is reported in the edit's result as `datastream: { ended, rebound, reason }`, never thrown, since the sensors write has landed.

## Not decided here

- **A form field for the sampling policy.** It waits on a route that lists sampling ConfigurationProfiles (#1392).
- **The sensors list.** `listSensors` still reads the freezer and policy off SensorMetadata, which both writers keep in step with the datastream.
- **The excursion's `device` key** (#1392).
