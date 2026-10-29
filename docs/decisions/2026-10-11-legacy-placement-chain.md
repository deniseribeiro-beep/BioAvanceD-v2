# 2026-10-11: a legacy box placement is written as the normalized physical chain

Dictionary: Container V2E-0646..0654, ContainerPositionAssignment V2E-0670..0676, SpecimenContainerAssignment V2E-0677..0683, RackLocationAssignment V2E-0684..0690, StorageLocation P1X-0098..0104, Specimen.primaryContainer ELM-0136, StorageAssignment ELM-0167..0178 (Dicionário de Dados v2.0.0). Requirements: RF016 AC1/AC3, RF017 AC1-AC4. Issue #1314 (phase W8: specimens are placed through SpecimenContainerAssignment, ContainerPositionAssignment and RackLocationAssignment, with no new dependency on StorageAssignment).

These decisions are inferences, not owner rulings. Two independent readings agree on each: the conventions of the chain code already in this repo (`physicalChain.service.js`, `storageLocation.service.js`, `models/StorageRack.js`), and the owner's v2.0.0 prototype of a normalized physical store. Where they differ, the difference is named.

The bridge is `services/legacyPlacementChain.service.js`. This slice wires no caller: the legacy allocate, move, auto-assign and release still write `storageAssignments`, and a later slice moves them onto the bridge.

## The dictionary rows these rest on

| Code | Field | Cardinality | Obligation |
|---|---|---|---|
| ELM-0136 | Specimen.primaryContainer | 0..1 | Core |
| ELM-0167 | StorageAssignment.storageLocationId | 1..1 | Core |
| ELM-0173 | StorageAssignment.boxId | 0..1 | Core |
| ELM-0174 | StorageAssignment.positionCode | 1..1 | Core |
| ELM-0176 | StorageAssignment.placedAt | 1..1 | Core |
| ELM-0177 | StorageAssignment.removedAt | 0..1 | Condicional |
| V2E-0646 | Container.containerId | 1..1 | Core |
| V2E-0647 | Container.containerType | 1..1 | Core |
| V2E-0648 | Container.emptyStatus | 1..1 | Core |
| V2E-0671 | ContainerPositionAssignment.containerId | 1..1 | Core |
| V2E-0672 | ContainerPositionAssignment.storagePositionId | 1..1 | Core |
| V2E-0673 | ContainerPositionAssignment.placedAt | 1..1 | Core |
| V2E-0674 | ContainerPositionAssignment.removedAt | 0..1 | Optional |
| V2E-0676 | ContainerPositionAssignment.sourceScanEventId | 0..1 | Optional |
| V2E-0678 | SpecimenContainerAssignment.specimenId | 1..1 | Core |
| V2E-0679 | SpecimenContainerAssignment.containerId | 1..1 | Core |
| V2E-0680 | SpecimenContainerAssignment.loadedAt | 1..1 | Core |
| V2E-0683 | SpecimenContainerAssignment.sourceEventId | 1..1 | Core |
| V2E-0685 | RackLocationAssignment.storageRackId | 1..1 | Core |
| V2E-0686 | RackLocationAssignment.storageLocationId | 1..1 | Core |
| V2E-0690 | RackLocationAssignment.sourceEventId | 1..1 | Core |
| P1X-0099 | StorageLocation.locationType | 1..1 | Core |
| P1X-0101 | StorageLocation.code | 1..1 | Core |
| P1X-0102 | StorageLocation.parentLocationId | 0..1 | Condicional |
| P1X-0103 | StorageLocation.organizationId | 1..1 | Core |

## Decided

1. **One container per specimen**, created and loaded at its first legacy placement and kept loaded through release, which closes only the position. A legacy specimen has no separate tube identity, and a SpecimenContainerAssignment needs a container (V2E-0679, 1..1). `containerType` (V2E-0647, 1..1) is the specimen's `primaryContainer` (ELM-0136, 0..1) when it has one, else `unidentified_container`, a code in the snake_case style of the approved example's `cryogenic_vial` meaning "container not identified". `Container.js` stores the type as given, so a code stays a code. The prototype also creates one container per specimen; it names a fixed type for every one, where this keeps the specimen's own.
2. **Rack and position ids.** A legacy box is the StorageRack: `storageRackId` is the box's `String(_id)`, and `storagePositionId` is `<storageRackId>:<code>`, the form `resolveSpecimenLocation` already splits and the prototype builds. The chain's code is zero-padded (`A1` becomes `A01`, as in the approved example); the legacy API keeps accepting and echoing `A1` (`chainPositionCode` and `legacyPositionCode`).
3. **The legacy topology is mirrored as StorageLocation.** Each FREEZER, SHELF, RACK and DRAWER above a box is found or created by its code `legacy-storage-container:<_id>` under its parent (P1X-0101: the code is unique under the parent), with `locationType` the lowercased container type (P1X-0099 has no closed list) and `parentLocationId` following the tree. A box is located (RackLocationAssignment) at its immediate parent's location when none is open.
   - **Organization** (P1X-0103, 1..1) is the root freezer's `Equipment.organizationId`, resolved as `StorageTopologyAuthoringService.assertTreeInScope` resolves it (the freezer's `containerID` against `equipment.equipmentID`, as string and number), and it must be a stored `organizations.organizationId`.
   - **With no organization resolved**, no location and no RackLocationAssignment is written: the chain ends at the rack, and a warning names the rack. A location with an invented owner would put a rack in the wrong tenancy. The prototype falls back to an equipment or room id as the location; this does not.
4. **Keys.** A specimen is keyed by its business `specimenId`, never the Mongo `_id`. The legacy `storageAssignments` rows are keyed by `String(sample._id)`, as their writer keys them, and are only read.

   2026-10-13 (#1374): the chain is keyed by the business `specimenId`, and by the sample's `_id` only for a legacy sample that has no `specimenId`. This is the rule the custody ledger uses (28f6c278, `canonicalSpecimenId`), and it is an inference from that consistent choice. The cost: such a sample's chain rows carry an `_id` where every other row carries a business id, and the reconcile maps the chain by `specimenId`.

   2026-10-13 (#1374): some legacy rows are keyed by the canonical `specimenId` (#1220). Adoption reads both forms, and the legacy reader reads the canonical row first, then the `_id` row. A sample with no `specimenId` is adopted keyed by its `_id`.
5. **Reads.** `currentPlacement` reads the chain first (open specimen assignment, then its open position, then the rack's open location), and falls back to the open legacy `storageAssignments` row, marked `source: 'legacy_storage_assignment'`.
6. **Adoption.** `adoptLegacyPlacement` decomposes a specimen's legacy rows: one container loaded from the earliest `placedAt`, one ContainerPositionAssignment per row over `[placedAt, removedAt)`, and each box located. The load and the rack locations carry `sourceEventId: legacy-storage-assignment:<storageAssignmentId>`. A second run writes nothing.
7. **Sessions.** Every bridge write runs in the caller's session. With a session the chain services neither open a transaction of their own nor build an index; an index build or a session-less write beside an open transaction is the write conflict that broke the sample create. The index specs moved into `utils/physicalChainIndexes.js`, unchanged, so a caller can build them before it opens its transaction. Without a session the chain services behave as before.

## Chosen where the sources leave a gap

- **A position assignment has no `sourceEventId`.** ContainerPositionAssignment's only event reference is `sourceScanEventId` (V2E-0676), a scan, and a legacy placement is not one. So adoption recognises a position it already wrote by container, position and `placedAt`, not by the legacy row's id.
- **A specimen with no open container at a move** is placed at the destination, as a first placement. A specimen placed only through the legacy path is meant to be adopted first.
- **Concurrent first placements into a tree not yet mirrored** may each create the same location, since only `storageLocationId` is unique. The caller's transaction makes this a narrow window, and the find by code returns one of them afterwards.

## Not decided here

- Wiring the legacy allocate, move, auto-assign and release onto the bridge, and when `storageAssignments` stops being written.
- The migration that adopts every stored placement.
- Whether `unidentified_container` joins a governed container-type catalog.
