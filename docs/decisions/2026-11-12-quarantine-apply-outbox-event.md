# 2026-11-12: a quarantine applied appends a QUARANTINE_APPLIED outbox event

Dictionary: QuarantineAction (dict-ENTIDADES.md, "Neo4j derived projection via transactional outbox; no dual-write"). Requirement RF019 AC6. Issue #1505.

## The question

`recordAction` inserted a QuarantineAction and appended no outbox event, though an explicit release now appends `QUARANTINE_RELEASED` (#1510). Does applying a quarantine emit one, and with what shape?

## Decided

Decided from the dictionary row for QuarantineAction and RF019 AC6 ("Auditar a decisão e emitir outbox quando houver projeção permitida"), as the release was.

1. **`recordAction` appends one `QUARANTINE_APPLIED` event per action it inserts.** Aggregate `QuarantineAction`, keyed by `quarantineActionId`. Every caller that applies a quarantine goes through `recordAction`, so each emits it; no caller changes.
2. **The payload is `quarantineActionId`, `specimenIds`, `reasonCodes`, `actionStatus`, `startedAt` and `authorizedBy`.** No civil field.
3. **The event is appended in the action's insert.** With a caller's session (a transaction the caller already runs), the insert and the append share it; with none, both run in one transaction where the deployment runs one (`withTransactionWhereSupported`), elsewhere without a session. The insert comes first, so a failed insert appends nothing.
4. **The event's name is an inference**, read off `auditDecision`'s `QUARANTINE_APPLIED` audit action and the release's `QUARANTINE_RELEASED` event; the dictionary names no event type.
5. **A freezer breach's `SPECIMEN_COMPROMISED` is a Sample event, not this one.** It records the excursion (RF023 AC8) and is unchanged; the lineage e2e now reads its outbox row.

## Not decided here

- **The release paths that call `releaseActiveAction`, and `markPendingReview`'s move to pending_review.** Neither appends an event.
- **A Neo4j projection handler for either quarantine event.** The projector has no handler for `QUARANTINE_APPLIED` or `QUARANTINE_RELEASED` and skips both.
