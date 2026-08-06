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

**#465 resolved 2026-08-06: confirmed, no change needed.** The
"real-world sensor placement granularity" question above is answered by
the requirements docs, not just a judgment call — checked
`docs/docs-7-27-2026/1-Requisitos-Funcionais-e-Nao-Funcionais.md`'s
RF017 item 4 ("Vincular sensor ou dispositivo **ao equipamento**" — link
sensor/device *to the equipment*, listed separately from the Freezer >
Prateleira > Rack > Caixa > Posição hierarchy) and
`dict-02_DICIONARIO.md`'s `TelemetryReading` entity (ELM-0357/ELM-0358:
`sensorId` is `Reference(Device)`, `equipmentId` is the equipment the
sensor is linked to, mapped to `Device.parent`) — no dictionary field
anywhere links a sensor/device to a `Rack`/`Box`/`Location`. Both are
unchanged across the `docs-7-27-2026` and `docs-7-31-2026` revisions, so
this isn't a doc that appeared after the migrations landed. Per-freezer
sensor coverage is the canonical model, not a legacy quirk: the
equipment-level check #462/#463/#464/#459 all landed matches the spec
exactly. No `containerId`/finer-grained link needs adding to
`Sensor`/`Device`.

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
applying #465's equipment-level granularity call (confirmed correct,
see the #462 entry above) exactly as #462 did. The wizard's `sampleToPersist` now sets `boxId`/`positionCode`
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

**#476 resolved 2026-08-06: confirmed, no change needed.** #476 asked
whether the `sample.location` mutation above should be reframed as it's
implemented — is quarantine a *storage-position* change (route through
`MongoStorageRepository`/a use-case) or a *status* change conceptually
separate from physical storage location? The design was already settled
before #476 was filed, just not written down as an answer: quarantine is
a status change. `quarantineSamplesByFilter` (same function as above,
`equipment-sensor-quarantine.service.js` L339-372) sets it via dedicated
status fields — `status: 'QUARANTINED'`, `currentStatus`, `release_status`,
`specimenStatus`, `quarantineLocation: 'Quarentena'` (a display label, not
a `StorageContainer`/box pointer), `quarantineReason`,
`quarantineSource(Id)`, `quarantinedAt` — none of which touch
`storageLocation.boxId` or any other physical-storage field; the sample's
actual box/rack/shelf placement is untouched by quarantine. The
`sample.location`/`locationStatus` write this doc already flags as
"deliberately left unmigrated" (paragraph above) is exactly this same
status concept, just echoed into the legacy display field for docs that
still carry one — not a second, competing storage-position write. So
`location`'s removal (this doc's overall subject) doesn't need a
"narrower replacement" for quarantine's sake, and no quarantine-move
use-case is needed: quarantine was never modeled as a storage move.

**Landed 2026-08-06 (#459, `import-lgpd.service.js` slice — partial, see
below):** #459's issue body named four files; only one of them,
`import-lgpd.service.js`, is an actual `locations`-collection *consumer*
in the sense #462/#463/#464 migrated (a read path resolving physical
placement). The other three (`import.service.js`'s `importLocations`,
`import.controller.js`'s `'locations'` case, `import-worker.js`'s
`location-worker` dispatch) are a CSV-import feature that **writes new
documents into** the `locations` collection — the opposite direction,
and one that actively violates this doc's own coexistence rule ("the
legacy `locations` collection stays read-only ... during transition").
Split off as a separate follow-up rather than folded into this slice
(see below); #459 tracked here covers only the consumer half.

`ImportLGPDService.importSamples`'s bulk-placement path (LGPD-consent
sample import, bypasses `sample.service.js`'s already-migrated
`createSample` entirely and inserts `Sample` documents directly) is
migrated: the legacy `getNextAvailableLocation(db, startLocationID,
index)` (a `locations`-collection scan sorted by `block`/`rack`/`drawer`/
`box`) is replaced by `getNextAvailableStorageSlot(db, startBoxId,
index)`, which enumerates `storageBoxes` sorted by `name`/`boxID`/`_id` —
the same deterministic order `intakeWizard.js`'s `resolveAutomaticLocation`
scans in — resolving each candidate's FREEZER/SHELF/RACK/[DRAWER] chain
via a duplicated `resolveStorageHierarchyForBox` (mirrored from
`intakeWizard.js`, per #464's precedent of mirroring shape rather than
sharing a cross-service module).

**Granularity translation, not a data-preserving one:** legacy
`getNextAvailableLocation` advanced by `index` full *location* documents
(one per physical box — `wellPosition` was descriptive metadata on the
document, not itself a sort key in the legacy sort). The canonical
replacement advances by `index` *available* (non-full, non-retired,
non-inactive) boxes in the same freezer/shelf/rack/[drawer]/box order,
returning that box's own first free position rather than a legacy
`wellPosition` value that no longer exists. Unlike #462/#463's
equipment-level sensor-granularity call (#465, confirmed correct — see
the #462 entry above), this never needed Dennis's confirmation in the
first place — it's a translation of an enumeration order, not a
safety-gate precision reduction.

**Input-contract change (no compatibility shim, per rule 2):**
`importSamples`'s `options.startLocationID` (numeric) is now
`options.startBoxId` (a `StorageBox` `_id` string) — same treatment
#462's `createSample` gave its own `locationID` input. CSV rows carry
`boxId`/`positionCode` directly instead of a legacy `locationID` column.
Precedence preserved exactly: a row's own `boxId` wins; else, if
`autoIncrement` and `startBoxId` are both given, the next available box
in sequence; else, if only `startBoxId` is given, that fixed box is used
for every location-less row. After insert, a `StorageAssignment` is
opened for the placed specimen (same #461/#462 convention: `equipmentId`
is the FREEZER `StorageContainer`'s `_id`, not its `containerID`).

Frontend impact: nil for live behavior — grepped `frontend/src`, no
view component ever calls `useAsyncImport`/`useImportJob` (the hooks
that plumb `startLocationID` through), so the type/wire-field rename
(`useAsyncImport.ts`'s `AsyncImportOptions`, `api.ts`'s
`createImportJob`) has no live caller to break. Updated anyway for type
consistency with the backend contract.

Proven with the same native-only bar as #462/#463/#464: an in-memory
`storageBoxes`/`storageContainers`/`storageAssignments` fixture with
real `_id`/`$in`-style exact-match lookups (not a stub), seeding a
FREEZER->SHELF->RACK->StorageBox chain — `tests/unit/
import-lgpd.service.importSamples.unit.test.js`'s `boxId
auto-assignment (#459)` and `getNextAvailableStorageSlot (#459)`
describe blocks.

**Split off as #466 (not this slice):** migrating/retiring the raw
`locations`-CSV-import feature (`import.service.js`'s `importLocations`,
`import.controller.js`'s `'locations'` dataType case, `import-worker.js`'s
`location-worker` dispatch) — a design call (disable now vs. redirect to
import `StorageBox`/`StorageContainer` rows) that needs Dennis's input,
not a silent removal, since it's an active feature rather than a
read-path migration.

**#466 resolved 2026-08-06:** checked `docs-7-31-2026` and
`docs/architecture/canonical-active-surface.md` for anything that
settled the disable/redirect/leave-as-is choice — nothing does;
`canonical-active-surface.md` only flags `import.service.js` as a
"known residual legacy surface" to clean up eventually, without saying
how. Genuinely Dennis's call, not a doc gap. Dennis chose **disable
now**: `importLocations` in `import.service.js` now unconditionally
throws (its old body deleted, not kept as dead code);
`import.controller.js`'s `import()` returns 400 for `dataType:
'locations'` before calling the service, and its `validate()`
allowlist no longer includes `'locations'`; `import-worker.js` dropped
`'locations'` from `allowedTypes` and its `location-worker` dispatch
case (and the now-unused `require('./workers/location-worker')`) — an
unsupported-`dataType` job now throws the existing generic error.
`api/backend/src/workers/workers/location-worker.js` itself is left in
place (not deleted, no longer referenced by the dispatcher) since #466
didn't ask for its removal. #460 (retiring the `locations` collection)
is now unblocked on this half.

**#467 resolved 2026-08-06:** checked RF004/RF029 in
`docs-7-31-2026/1-Requisitos-Funcionais-e-Nao-Funcionais.md`,
`canonical-data-contract-v1.md`, and this doc's own #459 entry (which
first raised the question) — nothing settles whether bulk LGPD import
should be exempt from RF004's operational-sensor/equipment-readiness
gate; RF029 ("Ingestão operacional e científica") only requires reusing
earlier-phase structure/references and real-or-synthetic-test data, not
readiness at ingestion time. Genuinely Dennis's call. Dennis chose
**add the gate**: `ImportLGPDService.importSamples` now runs the same
RF004 check `sample.service.js`'s `createSample`/`intakeWizard.js` run
(equipment-level granularity, per #465) before placing a bulk-imported
sample — a new `isPlacementReady(db, freezer)` helper (equipment not in
`maintenance`/`inactive`/`needs calibration`/`error`/`retired`, plus at
least one operational sensor matched on `freezer.containerID`), checked
both by `getNextAvailableStorageSlot` (auto-increment candidates skip
straight to `null`/exhausted rather than looping to the next box — a
narrower behavior than `intakeWizard.js`'s `resolveAutomaticLocation`,
which tries the next candidate box; not changed, since #467's scope was
adding the gate, not matching that skip-ahead shape) and directly in
`importSamples` for CSV-provided `boxId` and fixed `startBoxId` rows,
which fail the row with a per-row error rather than throwing. Tests:
`tests/unit/import-lgpd.service.importSamples.unit.test.js` (3 new
cases: blocked equipment, no operational sensor, retired equipment via
fixed startBoxId) and its `getNextAvailableStorageSlot` describe block
(2 new cases) — 31 tests green in the touched file.

**#471 resolved 2026-08-06:** the narrower `getNextAvailableStorageSlot`
behavior noted above was Dennis's explicit call to make — asked whether
auto-increment should skip a non-ready freezer and keep advancing
(matching `resolveAutomaticLocation`) or keep failing the row on the
first non-ready box. Dennis chose **skip-ahead**. `getNextAvailableStorageSlot`
now filters candidate boxes down to ones whose freezer passes
`isPlacementReady` before indexing by `index`, rather than checking
readiness only on the already-selected target and returning `null`
immediately. CSV-provided `boxId`/fixed `startBoxId` rows are unaffected —
those still fail per-row on a non-ready freezer, since there's no
"next candidate" to advance to for an explicit box. Tests: one new case
in `getNextAvailableStorageSlot`'s describe block proving a non-ready
freezer's box is skipped and the next ready box is returned — 32 tests
green in the touched file.

**#454 resolved 2026-08-06: confirmed, no change needed.** #454 (split
off #450's original audit) named four frontend consumers of Sample's
embedded location fields to migrate: `SampleLocator.tsx`,
`SamplesPage.tsx`, `SampleDetailsPage.tsx`, `types/models.ts`. Re-audited
at pickup per the prior session's overlap note (found while closing
#450): all four are already in the desired end state, for two different
reasons.

`SampleLocator.tsx` and `SamplesPage.tsx` (the file #454 lists as
`SamplesPage.tsx`, matching the current filename — no
`SamplesPageView.tsx` exists in the repo) — zero matches for
`location`/`storageLocation` (grepped both files directly). #478 already
migrated both onto `SampleStorageLocationDTO`/`SampleEmbeddedStorageLocation`.

`SampleDetailsPage.tsx` and `types/models.ts` — every remaining
`location`/`locationID` reference in both files is the **separate**
legacy `Location` entity (`api/backend/src/models/Location.js`, the
`locations` collection this doc's mapping table covers: `block`/`rack`/
`drawer`/`box`/`wellPosition`, fetched via `useLocations()` ->
`locationService` -> its own CRUD API), not `Sample.storageLocation`.
`SampleDetailsPage.tsx`'s `getLocationInfo`/`locationOptions` render
block/rack/drawer/box/well fields pulled from that hook's `locations`
array, keyed by the sample's own `locationID` field — exactly what
#478's close comment already scoped *out* as "a separate legacy
`locations`-collection lookup, not this box-based storage system."
`types/models.ts` already carries `storageLocation?:
SampleEmbeddedStorageLocation | null` (the correct typed DTO) alongside
several unrelated `locationID` fields belonging to `Location` and other
non-`Sample` types — not a stale untyped `Sample.storageLocation` field.

So #454's four-file list was already fully resolved before pickup: two
files by #478's actual migration, two files because they were never
migrating this field in the first place (they consume the still-live,
intentionally-uncoexisting `Location` entity, which stays as-is until
#460 retires it). No frontend code changed for this issue.
