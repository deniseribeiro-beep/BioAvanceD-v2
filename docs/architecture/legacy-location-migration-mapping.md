# Legacy `Location` → `StorageLocation`/`StorageAssignment` field mapping

**Status:** design decision, #457. Foundational for #458 (service-layer
migration), #459 (import-path migration), #460 (retire legacy API surface).
Does not touch consumer code — see those issues.

## Source and target

- **Source (legacy):** `api/backend/src/models/Location.js`, backed by the
  `locations` collection. Flat numeric document: `locationID`,
  `equipmentType`, `equipmentID`, `block`, `rack`, `drawer`, `box`,
  `wellPosition`.
- **Target (canonical):** dict-02 `StorageLocation`
  (P1X-0098–0104) + `StorageAssignment` (ELM-0167–0178), as already
  implemented by `StorageContainer.js` (`containerType`:
  `FREEZER`/`SHELF`/`RACK`, recursive `parent_id`), `StorageBox.js`
  (position grid under a `RACK`), `StoragePath.js` (materialized
  freezer→shelf→rack→box path), and `StorageAssignment.js`
  (`equipmentId`/`shelfId`/`rackId`/`boxId`/`positionCode`).

## Field-by-field mapping

| Legacy field | Maps to | Notes |
|---|---|---|
| `equipmentType` | *(dropped)* | Redundant with `Equipment.type` (already a closed enum on the `Equipment` collection — `Freezer`/`Analytical`/`Storage`/`Processing`/`Other`). Legacy `equipmentType` is an undocumented numeric code with no dictionary anywhere in the codebase or docs; no consumer resolves it to a label. Carrying it forward would duplicate `Equipment.type` with a second, meaningless encoding. |
| `equipmentID` | `StorageAssignment.equipmentId` (→ resolves to the `FREEZER`-type `StorageContainer`) | **No bridging table needed.** `Location.equipmentID` and `Equipment.equipmentID` are both plain numbers and already join directly today (`sample.service.js` cross-checks them as-is). The migration only needs one new join: `Equipment.equipmentID` → the `StorageContainer` document representing that freezer (created 1:1 per equipment during backfill, keyed by `equipmentID`). |
| `block` | `StorageContainer` (`containerType: SHELF`), child of the equipment's `FREEZER` container | First sub-level under the equipment, same position `SHELF` already occupies in the current model. When `block` is `null` (legacy allowed it), backfill a single synthetic `SHELF` per freezer so the chain stays unbroken — do not invent a "no shelf" branch in the hierarchy. |
| `rack` | `StorageContainer` (`containerType: RACK`), child of the `block` container | Maps directly onto the existing `RACK` level; no ambiguity. |
| `drawer` | **New optional level, `containerType: DRAWER`, child of `RACK`, parent of `BOX`** | This is the one legacy level with no current equivalent — the live model goes `RACK` → `BOX` directly. Two options were considered and rejected: (a) folding `drawer` into a composite box identifier (e.g. box name `"<drawer>-<box>"`) — rejected because it fabricates a pseudo-identifier and loses `drawer` as a queryable/reportable level; (b) dropping `drawer` on the assumption it's always `0`/unset — rejected, not verified against the actual `locations` collection contents and too destructive to assume. dict-02's `StorageLocation.locationType` (P1X-0099) is a free `code` field, not a closed enum, so adding `DRAWER` as a fourth intermediate type is within the canonical contract, not a deviation from it. Implementation (extending `StorageContainer`'s `containerType` enum and the `SHELF`/`RACK`/`DRAWER`/`BOX` parent-validation chain) is #458/#459 work, not this issue's. |
| `box` | `StorageBox` document, child of the `drawer` (or, if absent, `rack`) container | Same entity that already exists; only the parent chain changes to route through `DRAWER` when present. |
| `wellPosition` | `StorageAssignment.positionCode` / `StorageBox.occupancyGrid` key | Direct mapping — both are already free-form position-code strings (e.g. `A1`). Legacy's array-form `eppendorfWell` (`[row, col]`) is normalized to the same string form by `Location.js`'s own `create()` before it would ever reach this mapping, so no separate handling is needed. |
| `locationID` | *(retired, not carried forward)* | Superseded by `StorageAssignment.storageAssignmentId` (a UUID, ELM-0167/P1X-0072) and the `StorageContainer`/`StorageBox` ObjectIds it references. Anything that looked up a `Sample` by numeric `locationID` moves to looking it up by `StorageAssignment.specimenId` — that's #458's job. |

## Data migration: one-time backfill, not a translation layer

A live read-time translation layer (legacy flat document ↔ normalized
container graph, computed on every read) was considered and rejected: the
canonical model requires real, separately-addressable documents
(`StorageContainer` per equipment/shelf/rack/drawer, `StorageBox` per box,
`StorageAssignment` per specimen-position link) — that structure can't be
synthesized correctly on the fly without effectively re-implementing the
backfill logic on every request, and it would leave the `occupancyGrid`
collision-detection in `StorageBox.addSample()` unable to see legacy
occupancy at all.

Plan:

1. One-time backfill script walks the `locations` collection, and for each
   distinct `(equipmentID, block, rack, drawer, box)` tuple materializes (or
   reuses, if already created for a prior row) the corresponding
   `StorageContainer`/`StorageContainer`/`StorageContainer`/`StorageBox`
   chain, per the mapping above.
2. The script builds an in-memory (or scratch-collection) lookup table from
   legacy `locationID` → the resulting `StorageBox._id`, used to rewrite
   each `Sample.locationID` reference into a `StorageAssignment` document
   (`specimenId`, `boxId`, `positionCode` from `wellPosition`, `placedAt`
   backfilled from the sample's existing timestamp if no better source
   exists).
3. **Coexistence during transition (#458/#459):** the legacy `locations`
   collection stays read-only and untouched — consumers migrate to reading
   `StorageAssignment`/`StorageContainer`/`StorageBox` instead of `Location`,
   they don't get a compatibility shim that reads both. This matches
   `canonical-data-cleanup.md`'s rule 2 ("no legacy field aliases ... in
   runtime persistence").
4. **Retiring `locations` (#460):** drop only after #458 and #459 land and
   the backfill has been verified against production data — explicitly
   flagged there as needing Dennis's go-ahead before any destructive drop,
   not assumed here.

## Open item carried to #458/#459

Extending `StorageContainer.containerType`'s enum to include `DRAWER` (and
its parent-validation chain in the `pre("save")` hook) is real schema work,
not just a mapping decision — left to whichever of #458/#459 first needs a
`DRAWER`-bearing box created, so it lands next to the code that exercises
it rather than as a speculative schema change here.
