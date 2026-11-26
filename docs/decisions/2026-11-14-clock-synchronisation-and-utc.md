# 2026-11-14: RNF025 C1 and C2: clocks follow the institution's time source, and timestamps are stored in UTC and shown in America/Sao_Paulo

Requirements: RNF025 C1, C2. Issue #1554.

## The question

RNF025 C1 asks to "Sincronizar serviços/dispositivos por mecanismo institucional" and C2 to "Armazenar timestamps canônicos em UTC e preservar contexto de apresentação" (`docs/extracted-v2.0.0/requisitos.md` lines 1659 and 1661). No test or record named either. What does the platform do for each, and what proves it?

## Decided

`[inference]`, from the specification and the repo's pattern, for #1554, on 2026-11-14. The pattern: a criterion is proven where the behaviour it names lives, by the instrument that can reach it (`2026-11-12-ingestion-transient-state-telemetry-and-atomicity.md`).

1. **RNF025 C1 is the hosts' obligation, met by the institution's time service.** The backend, its workers and the databases run in containers that read the host's clock, and none of them sets a clock. The mechanism is the host's time synchronisation against the institution's time source (NTP or the institution's own time server), stated as an install prerequisite in `docs/operations/install-runbook.md` section 2. A device keeps its own clock, and the platform does not trust it: a reading whose device time is past the configured drift limit from its receipt is flagged `clock_drift` (RNF025 C6, `api/backend/src/services/clockDriftLimit.js`, #1520), and readings are ordered by sequence and receipt, not by the device clock alone (RNF025 C7, #1518). No test run can show that a host's clock follows a time server, so this record is C1's proof.
2. **RNF025 C2, storage: a canonical timestamp is stored as a UTC instant.** A time is held as a JavaScript `Date`, which MongoDB stores as UTC milliseconds and InfluxDB as the point's UTC time, and the API answers it as ISO 8601 with `Z`. A device time sent with an offset is kept as its UTC instant: `api/backend/tests/unit/services/telemetryReadingContract.1317.test.js`, "keeps a device timestamp with an offset as its UTC instant (RNF025 C2)". The dictionary types `observedAt` (V2E-0548) as "ISO 8601 UTC".
3. **RNF025 C2, presentation: the context is the institution's zone, America/Sao_Paulo, applied when a time is shown and never stored in its place.** The dictionary has no zone or offset field, so the context the platform preserves is the one zone it presents in, beside the stored UTC value. Instrument: `frontend/src/utils/logFormatter.test.ts`, "prints a Date with its ISO value and the Sao Paulo local time", which shows the stored ISO value and its Sao Paulo time together. The same zone is named where a time is shown or scheduled: `frontend/src/utils/logFormatter.ts`, `api/backend/src/utils/logSerializer.js`, `api/backend/src/services/NotificationService.js`, `api/backend/src/services/consentCommunication.service.js`, `api/backend/src/services/tclePdf.js`, and the scheduler's `process.env.TZ` default in `api/backend/src/services/scheduler.service.js`.

## Not decided here

- **Keeping a device's own offset beside its UTC time.** No dictionary field holds it.
- **A startup check that the host clock is synchronised.**
