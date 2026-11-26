# 2026-11-13: INGESTION_RECORD_PERSISTED has no graph relation, and the projector skips it by name

Requirement RF029 AC6. Issue #1550.

## The question

Every ingested record appends an `INGESTION_RECORD_PERSISTED` outbox event (`productionIngestion.js`). The Neo4j projector had no branch for it, so it fell to the generic skip for an unknown event type and the worker marked it `PROJECTED`. Is that skip intended, or is a projection missing?

## Decided

1. **The event is a persistence marker with no relation to project.** Its payload is `entityType`, `entityId` and `configurationReleaseId` only ("Ids only: no PII and no raw payload (RF029 AC6)"). It names no second node, so there is no edge to draw.
2. **The relations RF029 AC6 asks to project ("projetar relações autorizadas no Neo4j", `requisitos.md`, RF029) are carried by the target's own graph events.** A target with relations appends them in the record's transaction: Specimen appends `SPECIMEN_UPSERTED` and `LINEAGE_REGISTERED` (2026-10-23-ingestion-specimen-target.md, item 6), Consent appends `CONSENT_UPSERTED` (2026-10-24-ingestion-consent-target.md).
3. **An ingestion record is outside the graph's scope**, which `persistencia-poliglota.md` gives as "topology, custody, lineage, assignment, excursion and summaries".
4. **The projector names the event in its own branch.** `applyEvent` returns a skip with `reason: 'no graph relation: the ingested target appends its own graph events'` and runs no Cypher. The worker checkpoints it and marks it `PROJECTED`, as before; the `reason` tells it apart from an unknown event type.
5. **This is an inference**, read off the payload's shape and the pattern above in which each target with relations appends its own graph events; neither the requirement nor the dictionary names this event.

## Not decided here

- **A Neo4j projection handler for `QUARANTINE_APPLIED` or `QUARANTINE_RELEASED`.** The projector still has none and skips both as unknown.
- **A graph node for an ingested entity type that appends no graph event of its own** (Dataset, Assay, OmicsRun and the like). Such a record stays out of the graph until its target appends an event of its own.
