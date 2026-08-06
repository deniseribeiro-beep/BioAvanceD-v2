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

## Open item carried to #458/#459 — resolved

Extending `StorageContainer.containerType`'s enum to include `DRAWER` (and
its parent-validation chain in the `pre("save")` hook) is real schema work,
not just a mapping decision — left to whichever of #458/#459 first needs a
`DRAWER`-bearing box created, so it lands next to the code that exercises
it rather than as a speculative schema change here.

**Landed 2026-08-06 (#458, first slice):** `StorageContainer.containerType`
now includes `DRAWER` (child of `RACK`, parent of `StorageBox`), with the
same pre-save parent-chain validation `SHELF`/`RACK` already had.
`StorageContainer#getChildren()` on a `RACK` now returns both `DRAWER`
containers and any `StorageBox` documents parented directly to it (`DRAWER`
stays optional per the mapping table above), and on a `DRAWER` returns its
`StorageBox` children. `StorageBox`'s pre-save validation now accepts a
parent of type `RACK` or `DRAWER`. This slice only touches the schema — the
service-layer consumer migration (`sample.service.js`, `intakeWizard.js`,
`equipment-sensor-quarantine.service.js`) and the backfill script are
carried forward as separate #458-family follow-ups (too large for one
build-loop iteration alongside the schema change).

**Landed 2026-08-06 (#461, backfill script):**
`api/backend/src/services/location-storage-backfill.service.js` exports
`backfillLocationsToStorage(db)`, run via the thin CLI wrapper
`api/backend/src/scripts/backfillLocationStorage.js` (`connectDB`/
`closeConnection`, matching `backfillUserRoleAssignments.js`'s pattern).
Implements the plan above exactly: walks `locations` read-only, materializes
(or reuses) the `StorageContainer`(FREEZER, keyed by `containerID` =
`Equipment.equipmentID`) → `StorageContainer`(SHELF) →
`StorageContainer`(RACK) → optional `StorageContainer`(DRAWER) →
`StorageBox` chain per distinct tuple (SHELF/RACK/DRAWER found-or-created by
a deterministic `{parent_id, containerType, name}` key, since only the
FREEZER level has a natural numeric join key), then rewrites each
`Sample.locationID` reference into an open `StorageAssignment` document via
the existing `StorageAssignmentModel.open` helper. A location missing
`equipmentID` or `rack` is skipped and recorded in the returned summary
rather than guessing a fallback (mirrors the doc's rejection, above, of
unverified assumptions about `drawer`). Backfilled `StorageBox` documents
get a placeholder max-size grid (`26×100`) since legacy `locations` carries
no box dimensions — real dimensions land whenever a consumer migration
(#462-#464) next writes that box. Re-running is a no-op: containers/boxes
are found-or-created by their deterministic key, and an already-open
`StorageAssignment` for the same specimen/box/position is not duplicated.
Proven with the strongest native-only bar this repo's build-loop overlay
recognizes: an in-memory collection fake with real `$in`/exact-match
query-matching semantics, not a stub returning canned data
(`tests/unit/services/location-storage-backfill.service.test.js`, 7 cases).
Consumer migration (#462/#463/#464) and retiring `locations` (#460) remain
separate follow-ups.

**Landed 2026-08-06 (#462, `sample.service.js` slice):** `createSample`'s
input contract changes from a legacy numeric `locationID` to a
`boxId`/`positionCode` pair (the canonical `StorageBox` reference + well
position) — the route-level payload validator
(`interface/routes/sample.routes.js`'s `validateCreateSamplePayload`) and
the service both updated together, since the route rejected a missing
`locationID` before the service ever saw the request. `createSample` now:
resolves the `StorageBox` by `_id`, walks its `StorageContainer` chain
(`RACK`, optionally through a `DRAWER`, then `SHELF`, then `FREEZER`) to
find the linked equipment via `freezer.containerID` (`=== Equipment.
equipmentID`, the mapping table's already-established direct join, so no
new bridging lookup was needed for the equipment-registered check), sets
`Sample.storageLocation = { boxId, position }` (no longer writes
`locationID`), and opens a `StorageAssignment` for the new specimen after
the birth movement is appended — matching the #461 backfill script's
convention (`equipmentId` on the assignment is the FREEZER
`StorageContainer`'s `_id`, not its `containerID`). The audit-ledger
`destination` field on the birth movement changed from `location:<id>`
to `storage:<boxId>:<positionCode>`.

Open item resolved as a judgment call, since dict-02 doesn't model a
`Sensor` entity at all (grepped `dict-02_DICIONARIO.md` — no match): the
RF004 operational-sensor safety gate (a sample can't be created at a
location without an operational sensor) previously matched `sensors` by
the legacy `Location` document's own identifiers (locationID/_id) — the
finest legacy granularity. Since there's no canonical (dict-02) place for
a sensor to attach to `StorageContainer`/`StorageBox`, and continuing to
read `locations` for this lookup would violate the coexistence rule above
("consumers migrate ... they don't get a compatibility shim that reads
both"), the check now matches `sensors.locationId`/`locationID` against
the resolved freezer's `containerID` (equipment-level granularity)
instead of the specific rack/drawer/box. This is a real precision
reduction versus the legacy behavior, not a data-preserving translation —
tracked as #465 (needs Dennis's confirmation on real-world sensor
placement granularity) rather than assumed silently correct, since
`equipment-sensor-quarantine.service.js` (#464, out of scope for this
slice) will face the identical question for its own sensor-to-location
resolution and should reuse whichever answer #465 settles on rather than
re-deriving it independently.

Frontend impact: nil for this slice — no UI call site invokes `useSamples
.ts`'s `createSample` hook yet (grepped `frontend/src`), so the payload
contract change has no live caller to update.

**Landed 2026-08-06 (#463, `intakeWizard.js` slice):** the automatic
placement path (`resolveAutomaticLocation`, formerly a `locations`-collection
scan run independently of box selection) now scans `storageBoxes` directly —
candidate boxes (active status, free capacity, an available position) are
gated on their own resolved `StorageContainer` chain (`RACK`, optionally
`DRAWER`, then `SHELF`, then `FREEZER`) rather than an unrelated `locations`
lookup, reusing #462's `resolveStorageHierarchyForBox` walk and its
`freezer.containerID === Equipment.equipmentID` join. Equipment-readiness
and operational-sensor gating (`isEquipmentReadyForContainer`/
`hasOperationalSensorForContainer`) key off the same resolved freezer,
applying #465's not-yet-settled equipment-level granularity call exactly as
#462 did. The wizard's `sampleToPersist` now sets `boxId`/`positionCode`
(no `locationID`) before calling `sampleService.createSample`, and the
response's `storageLocation.equipmentID` is now the freezer's `containerID`
instead of a legacy `Location.equipmentID`; `storageLocation.locationID` is
dropped entirely (no compat shim, per rule 2). Note this also fixes a
latent inconsistency in the legacy code: previously a location's readiness
gate and the box actually assigned were resolved independently (any
available box was picked regardless of which location passed the gate) —
now the same box's own freezer is what's gated, since the canonical model
ties a box to exactly one physical chain. Not a behavior this issue asked
to fix, but a direct consequence of gating on the box's own hierarchy
instead of a decoupled `locations` scan.

**Landed 2026-08-06 (#464, `equipment-sensor-quarantine.service.js` slice):**
the automatic-quarantine service's three `locations`-collection consumers
(equipment status change, sensor status change, cold-chain incident) now
walk down from a FREEZER `StorageContainer` (found by
`freezer.containerID === Equipment.equipmentID`, #462's join reused in
reverse) through `SHELF` -> `RACK` -> optional `DRAWER` to the linked
`StorageBox`es, then filter samples on `storageLocation.boxId` instead of
the legacy `locationID`/`location.locationID` pair. New helpers
`resolveFreezersByEquipmentIdentifiers` and `findBoxIdsUnderFreezer`
mirror #462's `resolveStorageHierarchyForBox` walk but run top-down
instead of bottom-up (quarantine starts from equipment/sensor, not from a
specimen's own box). `findLocationIdsByEquipment`/
`findLocationIdsBySensorKey`/`buildSampleFilterFromLocationIds` are
replaced outright by `findBoxIdsByEquipment`/`findBoxIdsBySensorKey`/
`buildSampleFilterFromBoxIds` — no compatibility shim reading both, per
rule 2. Each function's result field renamed `locationIds` -> `boxIds`
accordingly (internal only; grepped `api/backend/src` for external
readers, none found).

Reused #465's already-tracked equipment-level granularity call exactly as
#462/#463 did: `sensorContext.locationId`/`locationID` (and
`sensorMetadata.locationId`/`locationID`) are treated as the same
equipment-level identifier matched against `freezer.containerID`, not a
pointer into the retiring `locations` collection — so
`findBoxIdsBySensorKey`'s legacy fallback block (a reverse `locations`
lookup keyed on `sensorId`/`sensorKey` fields embedded in a location
document) is dropped rather than kept as a compatibility path, since the
function no longer needs the `locations` collection at all.

Left unmigrated, deliberately: `quarantineSamplesByFilter`'s
`sample.location` branch (mutates whichever `location` object shape is
already on the doc being quarantined, falling back to a bare
`locationStatus` flag for docs without one). This isn't a `locations`-
collection consumer — it never queries that collection — it's a
display-field mutation keyed on the shape of the sample document already
in hand, and post-migration samples (no `location` object set by
`createSample`/`intakeWizard` since #462/#463) already take the
`locationStatus` branch correctly without any change here.

Proven with the strongest native-only bar this repo's build-loop overlay
recognizes: a fixture that seeds a real FREEZER->SHELF->RACK->StorageBox
chain in an in-memory collection fake with `$in`/exact-match query
semantics (not a stub returning canned data), asserting the hierarchy
walk actually resolves the right box — `tests/unit/
equipment-sensor-quarantine.service.test.js` (10 cases) and `tests/unit/
cold-chain-quarantine.service.test.js` (22 cases). Consumer migration
family (#462/#463/#464) complete; retiring `locations` (#460) remains a
separate follow-up depending on #459 + #464 (now done).
