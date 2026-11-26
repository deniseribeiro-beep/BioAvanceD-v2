# 2026-11-13: a telemetry reading whose payloadHash does not match is refused 422 as corrupted

Requirement RNF004 C4; dictionary codes V2E-0555 (TelemetryReading.payloadHash) and V2E-0596 (TelemetryIngestionEvent.payloadHash). Issue #1521. Follows `2026-11-12-telemetry-personal-data-stripped.md`.

## The question

RNF004 criterion 4 asks the ingestion contract to detect corrupted messages. `POST /api/iot/telemetry` computed its own payloadHash and never compared it with anything: a `payloadHash` the client sent was stripped as a field outside the contract and flagged `personal_data_stripped`. What should happen to a reading whose client payloadHash does not match the payload received?

1. Refuse it with 422 as a corrupted message, and record it.
2. Keep it, quarantined and flagged, as a clock drift is.

## Decided

Decided on #1521 on 2026-11-13 as an inference, with no owner ruling. [inference] It reads off the repo's pattern: a reading whose content cannot be trusted is refused with 422 (an implausible temperature, `invalid_value` rejected), and a reading whose value is real but flagged is kept (a clock drift, stripped fields). A payload that does not match its own hash is content that cannot be trusted.

1. **A mismatch is refused 422 and recorded.** One rejected TelemetryIngestionEvent (`telemetryReadingId` null, `payloadHash` the server's own) and one `payload_hash_mismatch` TelemetryValidationIssue, disposition `rejected`. Nothing is stored. Any value that is not a text equal to the server's hash, case-insensitive and trimmed, is a mismatch: an empty text, a number, an object, a wrong or truncated hex.
2. **An absent payloadHash is accepted** as before: a reading without one (or with `null`) is screened as it always was.
3. **A mismatch is never answered as a replay.** Its idempotencyKey is as untrusted as the rest of the message, so a corrupted resend of a key already accepted is refused 422, not answered 200 with the first reading.
4. **What the hash covers.** [inference] The server's own payloadHash: the SHA-256 of the canonical contract fields received, without `organizationId` and without `payloadHash` itself. It reads off point 1 of `2026-11-12-telemetry-personal-data-stripped.md` ("The reading's payloadHash (V2E-0555) covers the contract fields only"). The edge buffer's `entry.payloadHash` (`api/backend/scripts/telemetry-edge-buffer.js`, `sha256(canonicalJson(body))` over the contract fields) is that same value for the body it sends. The `payloadHash` field is taken out before the contract split, so it is neither hashed nor stripped.

## The proof

`api/backend/tests/unit/services/telemetryPayloadHash.1521.test.js`, the `client payloadHash (#1521, RNF004 C4)` describe in `api/backend/tests/unit/iot.controller.test.js`, and the `Telemetry corrupted payload (#1521, RNF004 C4)` describe in `tests/e2e/interop-monitoring.spec.ts`.

## Not decided here

- **The MQTT, temperature-route, queue and import paths,** which pass no client payloadHash check and behave as before.
- **The edge buffer sending its payloadHash** with each reading.
- **The MQTT transport audit's own payloadHash,** taken over the raw signed message.
