# 2026-10-21: RNF004 C1's edge buffer lives on the device, and only a 2xx confirms a reading

Requirement RNF004 C1, C2, C3, C7. Dictionary V2E-0616. Issue #1392.

## The question

RNF004 C1 asks for a durable buffer at the edge that holds each reading with sourceEventId, observedAt, deviceId, sequenceNumber (when available) and payloadHash, and syncs it later without loss or logical duplication. Nothing in the repo buffered a reading: `api/backend/scripts/iot-simulator.js`, the only device-side program, posted each reading once and dropped it on a failure. Where does the buffer live, and what answer from the platform confirms a reading so it can leave the buffer?

## Decided

`[inference]`, from the specification and the repo's pattern, on 2026-10-21:

1. **The buffer lives on the device.** `persistencia-poliglota.md` 4.3 (line 84) has devices post directly over MQTT, HTTPS or an approved adapter, with no additional remote-management layer and no parallel authority, so "na borda" is the device itself, not a gateway service and not the backend. V2E-0616 `DeviceCommunicationProfile.bufferingPolicyId` is the platform's reference to that device-side policy, not a platform-side buffer. The repo reaches a device only through its programs under `api/backend/scripts/`, each with unit tests under `api/backend/tests/unit/scripts/`, so the buffer is `api/backend/scripts/telemetry-edge-buffer.js`, which the simulator uses with one buffer per sensor, and its proof is `tests/unit/scripts/telemetry-edge-buffer.test.js`.
2. **Each reading is on disk before any send** (C1): an entry holds sourceEventId, observedAt, deviceId, a per-device sequenceNumber, payloadHash (the server's canonical form and sha256) and the body to send. Each write goes to a `.tmp` file, is fsynced and renamed, so a torn write is never read as an entry. Only `sensorId`, `temperature`, `temperatureUnit` and `timestamp` enter the buffer, so no PII can (C7).
3. **Only a 2xx confirms a reading** (C2). `iot.controller.js` answers 200 only after the InfluxDB write, 503 `TELEMETRY_NOT_PERSISTED` when it fails, and 200 `replayed: true` for an `idempotencyKey` it already persisted. A resend reuses the stored body, whose `idempotencyKey` is its sourceEventId, so a reading the server persisted before its answer was lost is answered as a replay, never written twice.
4. **A 400 or 422 moves the reading to a dead letter.** The server refuses that payload for good, so retrying it would block every later reading. Every other answer (401, 403, 404, 408, 429, 5xx) and a network error or timeout is retried.
5. **A retry stops the drain** (C3): no reading overtakes an unconfirmed earlier one, and the sequenceNumber orders them without relying on the device clock alone.

## Not decided here

- **The DeviceCommunicationProfile and its bufferingPolicyId** (V2E-0611..0617): the repo has no such model, so the buffer's policy is the module's behaviour, not a referenced ConfigurationProfile.
- **A reading drained late is flagged as drift.** `validationIssuesOf` compares observedAt with receivedAt, so a reading drained more than 5 minutes after it was observed is flagged `clock_drift`, though the device clock was right. Whether a buffered reading is exempt is a server-side decision.
- **The real-backend Playwright proof** of a buffered reading surviving a backend outage (#1392).
