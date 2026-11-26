# 2026-11-12: an explicit quarantine release appends a QUARANTINE_RELEASED outbox event

Dictionary: QuarantineAction (dict-ENTIDADES.md, "Neo4j derived projection via transactional outbox; no dual-write"). Requirement RF019 AC6. Issue #1510.

## The question

`POST /api/samples/:id/quarantine/release` closed each open QuarantineAction and audited it, but appended no outbox event. Does the release emit one (the question #1505 left open for the release side), and with what shape?

## Decided

Decided from the dictionary row for QuarantineAction and RF019 AC6 ("Auditar a decisão e emitir outbox quando houver projeção permitida"), not by inference.

1. **The explicit release appends one `QUARANTINE_RELEASED` event per action it closes.** Aggregate `QuarantineAction`, keyed by `quarantineActionId`. An action already released appends none, and a refused release (422 no evidence, 409 not quarantined, 409 rule unsatisfied) throws before any write, so it appends none.
2. **The payload is `quarantineActionId`, `specimenIds`, `reasonCodes`, `actionStatus`, `releasedAt`, `authorizedBy` and `evidenceIds`.** No civil field.
3. **The event is appended in the action's write.** `releaseQuarantine` runs the action's `updateOne` and the outbox append in one transaction where the deployment runs one (`withTransactionWhereSupported`), sharing its session; elsewhere both run without a session. The audit write stays after it, outside the transaction.

## Not decided here

- **An outbox event when a quarantine is applied** is decided in `2026-11-12-quarantine-apply-outbox-event.md`.
- **The other release paths that call `releaseActiveAction`**: consent re-activation, the compliance graph, the intake wizard and FHIR import.
- **A Neo4j projection handler for the event.** The projector has no handler for `QUARANTINE_RELEASED` yet and skips it.
