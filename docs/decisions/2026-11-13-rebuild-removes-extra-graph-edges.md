# 2026-11-13: the canonical rebuild removes the graph edges the reconcile reports as extra, through the outbox

Requirements RF023 AC8 and RNF019 C7/C8. Issue #1550.

## The question

`graph-projection-reconcile` reports two drifts it cannot repair and sends them to `neo4j:canonical:rebuild`: a `DONATED` edge from a donor that is not the sample's own, and an open `STORED_AT` edge for a sample MongoDB places nowhere. The rebuild only re-appended consent, sample, quality and lineage events, and none of those removes an edge, so the rebuild could not repair either one. How does it remove them?

## Decided

1. **The rebuild runs no Cypher write; it appends two corrective outbox events.** Neo4j is written only by the projector that applies outbox events (RF023 AC8, #1312), which `neo4j-boundary.arch.test.js` holds. The rebuild reads the drift with the reconcile's own check (`findSamplesDriftedFromGraph`, `planDriftRepair`) and appends an event for each drift that check sends to a rebuild; the projector applies them after the sample's re-appended events.
2. **`SPECIMEN_DONOR_UNLINKED`**, aggregate `Sample`, payload `{ specimenId, donorId }`, where `donorId` is the graph's pseudonymized `Donor.id` and no civil field. One per donor edge other than the sample's own. The projector deletes `(donor)-[:DONATED]->(sample)` and the `GOVERNED_BY` edges from that sample to that donor's consents, the edges the specimen projection made from the donor's `CONSENTED_UNDER`.
3. **`STORAGE_POSITION_RELEASED`**, aggregate `Sample`, payload `{ specimenId, releasedAt }`. One per sample with an open position MongoDB holds nowhere. The projector closes the sample's open `STORED_AT` edges that began before `releasedAt` or carry no `validFrom`, setting `validTo` to `releasedAt`, as a new placement closes the previous one. The rebuild takes `releasedAt` before it reads MongoDB, so a placement stored after that read begins at or after it and stays open.
4. **The position edge is closed and the donor edge deleted.** `STORED_AT` is a temporal edge (RF023 AC5), so a closed interval stays as history. `DONATED` carries no validity interval: an edge that should never have existed has no history to keep.
5. **Both are idempotent.** A replay finds no donor edge to delete and no open position to close.
6. **The event names are an inference.** The dictionary names no event type; they follow the `<SUBJECT>_<PAST VERB>` form of the existing types, `STORAGE_POSITION_ASSIGNED` and `SPECIMEN_COMPROMISED`.
7. **A drift an existing event repairs is left as it was.** A missing donor is the re-appended `SPECIMEN_UPSERTED`'s, and a wrong but known position is the reconcile's `STORAGE_POSITION_ASSIGNED`.

## Not decided here

- **The reconcile's `--repair` appending these events itself.** It still reports both drifts for a rebuild.
- **Sample nodes for samples MongoDB no longer holds.** The reconcile reads MongoDB's samples only, so such a node is never reported and nothing removes it.
