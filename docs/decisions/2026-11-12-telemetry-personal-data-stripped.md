# 2026-11-12: a telemetry reading carrying fields outside its contract is stored with them stripped and flagged, never refused

> **Superseded on 2026-11-18** by `2026-11-18-telemetry-rule-025-gold-standard.md` (owner ruling on #1547): RULE-025 now requires stripping PII / non-contract fields, persisting the trustworthy contract measurement, quarantine + security audit — not rejecting the whole temperature when only forbidden fields are the defect. Keep this record for history of #1540.

Requirements RF009 AC8, RNF004 C7; rule RULE-025. Issue #1540. Follows `2026-10-17-telemetry-threshold-from-datastream.md`.

## The question

`POST /api/iot/telemetry` and the MQTT path dropped fields outside the reading contract silently, so nothing recorded that personal data had arrived. What should happen to such a reading?

The requirements say refuse it. RF009 criterion 8: "Proibir PII na telemetria e impedir projeção de TelemetryReading bruto no Neo4j" (`docs/extracted-v2.0.0/requisitos.md:337`). RNF004 criterion 7: "Não armazenar PII no dispositivo, payload ou buffer" (`requisitos.md:1094`). RULE-025, for a TelemetryReading whose "payload contains direct or indirect PII": "Do not persist or project the payload", "Reject and security audit" (`docs/extracted-v2.0.0/dict-REGRAS_CONDICIONAIS.md:29`).

Refusing the reading conflicts with the Axis E decision on #1106, restated in point 2 of `2026-10-17-telemetry-threshold-from-datastream.md`: cold-chain availability wins, so no excursion goes unchecked.

## Decided

Decided by Dennis on #1540, 2026-11-12. It awaits the data owner's confirmation: the requirement text above says reject, and a separate issue asks her to confirm this choice, revert it, or update the requirement text.

1. **A field outside a path's contract list may carry personal data.** `POST /api/iot/telemetry` has `IOT_API_READING_FIELDS` (`telemetryReadingContract.js`) and MQTT has `MQTT_READING_FIELDS` (`mqtt-telemetry.service.js`): every top-level field the path reads into a reading, plus `organizationId` (V2E-0561). Any other field is stripped before the reading is hashed, screened or stored, so no store receives it. [inference] The reading's payloadHash (V2E-0555) covers the contract fields only, because a hash over a low-entropy identifier such as a CPF can be reversed by trying every value.
2. **The flag is the existing quarantine mechanism.** One `personal_data_stripped` TelemetryValidationIssue, disposition `quarantined`, under a TelemetryIngestionEvent that carries the reading's telemetryReadingId. The reading is stored and its excursion check runs, as with a clock drift. [inference] The issue names the stripped fields that are identifier-shaped (`fieldPath`, comma-separated) and counts the others; it never holds a value.
3. **A reading that is also rejected** (an implausible value) still records the issue. A replay of a client idempotencyKey stores and records nothing.
4. **The proof** is `api/backend/tests/unit/services/telemetryPersonalData.1540.test.js`, the new cases in `api/backend/tests/unit/iot.controller.test.js` and `api/backend/tests/unit/mqtt-telemetry.service.test.js`, and the #1540 describe in `tests/e2e/interop-monitoring.spec.ts`.

## Not decided here

- **The temperature route and the import path,** whose payloads carry their own fields and are not stripped.
- **The MQTT transport audit's payloadHash,** taken over the raw signed message.
- **A separate security audit event** for RULE-025's "security audit".
- **Personal data nested inside a contract field's value.**
- **The requirement text itself.**
