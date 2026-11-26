# 2026-11-18: RULE-025 keeps a trustworthy temperature reading and refuses only the PII

Requirements RF009 AC7–AC8, RNF004 C7, RNF007; rule RULE-025. Issues #1547, #1540. Supersedes `2026-11-12-telemetry-personal-data-stripped.md` on the owner's ruling. Follows the RF009 AC7 disposition pattern in `telemetryReadingContract.js` (clock drift quarantined and kept; `invalid_value` rejected).

## The question

RULE-025 said: when a TelemetryReading payload contains direct or indirect PII, "Do not persist or project the payload" / "Reject and security audit". Read as rejecting the whole message, that drops a valid cold-chain temperature whenever a device also sends forbidden fields — and loses specimen exposure evidence for that instant. RF009 AC8 and RNF004 C7 still forbid storing PII. What should RULE-025 require?

## Decided

Decided by Denise (data owner) on #1547, 2026-11-18: align RULE-025 to the project's gold standard so every point holds together (no PII persisted, sample telemetry not lost, security audit, Neo4j unchanged, all related ingest paths later).

1. **Disposition follows RF009 AC7.** An untrustworthy measurement (`invalid_value`, corrupted payload, payloadHash mismatch) is rejected — a legitimate gap. A trustworthy contract measurement that arrives with non-contract / PII-bearing fields is kept: those fields are stripped before hash, screen or store; the reading is quarantined and flagged; a security audit is recorded. Never a silent drop.
2. **What is refused.** Persistence and projection of PII values (and of any non-contract field that may carry them). Not the environmental measurement itself when that measurement is trustworthy.
3. **What must never receive PII.** InfluxDB readings, edge buffer, logs, hashes over low-entropy identifiers, Mongo identity stores beyond ParticipantIdentity, and Neo4j (RULE-028 still: topology, assignment intervals, excursions and derived summaries only).
4. **RULE-025 text** in `docs/extracted-v2.0.0/dict-REGRAS_CONDICIONAIS.md` and `docs/extracted-v2.0.0/matriz-REGRAS.md` is updated to this consequence and failure outcome. RF009 AC8 ("Proibir PII na telemetria") and RNF004 C7 ("Não armazenar PII…") stay; they are satisfied by never storing PII, not by discarding a valid temperature.
5. **Scope of the ruling.** Same policy for every telemetry ingest path (HTTP IoT, MQTT, temperature session/machine routes, temperature import, iot-queue). Implementation on those paths follows this decision; this record aligns the rule first.

## Not decided here

- **Personal data nested inside a contract field's value** (still a follow-up).
- **The concrete security-audit event shape** on each path (must exist; wiring is implementation).
- **Code on each path** (lands after this rule alignment on the integration line, then main).
