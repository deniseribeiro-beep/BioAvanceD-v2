# 2026-10-21: `TELEMETRY_BINDING_MODE` defaults to `enforce`

Requirement RF009 AC4, RF017 AC5, RF017 AC8. Issue #1392.

## The question

`TELEMETRY_BINDING_MODE` says what the ingestion contract does with a reading whose sensor has no TelemetryDatastream valid at its observedAt, no active DeviceRegistration, or whose Device is not registered, homologated and unretired. `enforce` refuses it with a 422; `record` stores it and records a TelemetryValidationIssue. The code default was `record`, to stay so until `npm run migrate:sensor-metadata-to-datastreams` had run on each deployment, so that a sensor registered before the datastream existed kept posting. When does the code default flip to `enforce`?

## Decided

Decided by Dennis on 2026-10-21.

1. **The default flips to `enforce` now.** The condition was that every deployment's sensors are bound. No deployment holds data yet: the project is still being built, so no unbound sensor is in use and the condition holds. `env.js` defaults the mode to `enforce`, and `bindingMode()` in `telemetryReadingContract.js` returns `record` only for the value `record`, so an unset or unknown value is `enforce`.
2. **`record` stays as the opt-out.** A deployment sets `TELEMETRY_BINDING_MODE=record` to store an unbound reading and flag it instead of refusing it. `.env.docker.example` and `.env.production.example` set `enforce`.
3. **The native unit suite pins `record`.** `tests/vitest.setup.js` sets `TELEMETRY_BINDING_MODE=record` unless the environment sets it, because the unit fixtures of the ingestion routes, the import, the streaming and MQTT paths post readings for sensors that are not bound, and none of those cases is about binding. The binding cases in `telemetryBinding.1317.test.js` set the mode themselves, `tests/unit/config/env.test.js` unsets it to read the code default, and the e2e stack (`compose.test.yml`, every sensor bound by `tests/e2e/helpers/seedSensor.ts`) runs under `enforce`.
4. **A deployment with sensors registered without a `samplingPolicyId` binds them before their readings are accepted.** Such a sensor has SensorMetadata only (2026-10-21-sensor-registration-writes-datastream.md, decision 2). It is bound by `npm run migrate:sensor-metadata-to-datastreams`, or by the datastream and DeviceRegistration routes; until then its readings are refused with 422, or the deployment opts out with `record`.

## Not decided here

- **RF009 AC5 and AC6** (exposure through the assignment chain) and **RNF004 C1** (the edge buffer) (#1392).
