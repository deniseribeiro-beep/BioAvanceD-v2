# 2026-10-14: every Facility and Room is mirrored as a StorageLocation

Dictionary: StorageLocation P1X-0098..0104; StorageAssignment.facilityId ELM-0168 and StorageAssignment.roomId ELM-0169, deprecated in v2.0.0 (Dicionário de Dados v2.0.0). Issue #1379, slices 1 and 2 of 4.

## The question

Where do the `facilities` and `rooms` collections live in v2? Neither has its own entity in v2.0.0: ELM-0168/0169 are StorageAssignment reference fields, deprecated, and the physical hierarchy is StorageLocation (`locationType` and `parentLocationId`). The legacy freezer tree is already mirrored as StorageLocation (`2026-10-11-legacy-placement-chain.md`, item 3); a facility and a room sit above it.

These decisions are inferences, not owner rulings: they extend item 3 of `2026-10-11-legacy-placement-chain.md` to the two levels above a freezer, read against the dictionary rows below.

## The dictionary rows these rest on

| Code | Field | Type | Cardinality | Obligation |
|---|---|---|---|---|
| P1X-0098 | storageLocationId | uuid | 1..1 | Core |
| P1X-0099 | locationType | code | 1..1 | Core |
| P1X-0100 | name | string | 1..1 | Core |
| P1X-0101 | code | string | 1..1 | Core |
| P1X-0102 | parentLocationId | Reference | 0..1 | Condicional |
| P1X-0103 | organizationId | Reference | 1..1 | Core |
| P1X-0104 | locationStatus | code | 1..1 | Core |

## Decided

1. **One StorageLocation per facility and per room.** A facility is `locationType: 'facility'` (the catalog's one example) with no parent; a room is `locationType: 'room'` under its facility's location. Both are `locationStatus: 'active'`. The migration is `npm run migrate:facilities-rooms-to-locations` (`services/facilityRoomLocationMigration.service.js`); it writes only `storageLocations`.
2. **Keys.** `storageLocationId` is a fresh uuid, since P1X-0098 is `uuid` and the old `_id` is an ObjectId. The old id stays resolvable through the code: `legacy-facility:<_id>` and `legacy-room:<_id>`, unique because the old `_id` is, the way a mirrored freezer is coded `legacy-storage-container:<_id>`. `findLegacyLocation(db, kind, legacyId)` (`services/facilityRoomLocation.service.js`) is that lookup.
3. **Organization** (P1X-0103, 1..1). Neither Facility nor Room carries one, so it is derived from the freezers, as item 3 resolves a freezer's: a room's derived organizations are those its non-deleted FREEZER containers (`storageContainers.roomId`) resolve to through their Equipment.
   - A facility's organization is the one organization derived over its non-deleted rooms. With none derived, it is the `--organization-id` given to the migration, which must be a stored `organizations.organizationId` or the migration writes nothing; with still none, the facility is unresolved `no_organization`. With more than one, it is unresolved `conflicting_organizations`, naming them.
   - A room's organization is its own derived one when it has exactly one, else its facility's. A room whose freezers name more than one, or one other than its facility's, is unresolved `conflicting_organizations`: a child stays in its parent's organization (RF017 AC1).
   - An unresolved facility or room is not written, and neither is a room under it (`facility_not_mirrored`). This is item 3's rule: a location with an invented owner would be in the wrong tenancy.
4. **Deleted rows are not mirrored.** A facility or room with `deletedAt` set is counted `deleted`. A room whose facility is not stored is `facility_not_found`; one whose facility is deleted or unresolved is `facility_not_mirrored`.
5. **Not carried.** A facility's `address`, `description` and its old nullable `code`, and a room's `description` and `code`, have no StorageLocation field and are not copied. The old collections stay in the database as history.
6. **Idempotent.** A facility or room whose `legacy-<kind>:<_id>` location exists is counted `alreadyMigrated` and nothing is written; a room under an already-mirrored facility takes that location as its parent and that location's organization as its facility's. A second run writes nothing. `--dry-run` writes nothing and counts what it would create.
7. **2026-10-14 (slice 2): a freezer's location sits under its room's location.** A FREEZER's mirrored location (`legacy-storage-container:<_id>`) is found by its code alone, whatever its parent, so the placement chain never duplicates a freezer that has been moved under a room; the code stays unique because the old `_id` is. When the chain first creates it, its parent is the room's location (`legacy-room:<roomId>`) if the freezer has a `roomId`, that room is mirrored, and the room's location is in the freezer's resolved organization; else it is at the root. `assignFreezerRoom(db, freezer, roomLocationRef, { session })` (`services/legacyPlacementChain.service.js`) is the one writer of that parent afterwards: it takes a room location's `storageLocationId`, an old Room `_id`, or null to unassign, refuses an unknown or non-room location (`ROOM_NOT_FOUND`, 404), another organization's room (`ROOM_OUT_OF_ORGANIZATION`, 422) and a freezer with no resolved organization (`FREEZER_ORGANIZATION_UNRESOLVED`, 422), and writes neither `storageContainers` nor `rooms`. Every read and write runs in the caller's session (`2026-10-11-legacy-placement-chain.md`, item 7). The migration re-parents a freezer location written at the root before its room was mirrored, counted in `freezers`; one whose room's location is in another organization is unresolved `conflicting_organizations`, and a second run re-parents nothing.
8. **2026-10-16: the facility and room code is retired (#1379).** The `/api/facilities` and `/api/rooms` routers, `models/Facility.js`, `models/Room.js`, `utils/facilityIndexes.js`, `MongoStorageRepository`'s facility/room walk and the `StorageContainer.roomId` schema field are gone. No frontend ever read them. The `facilities` and `rooms` collections stay in the database as history (item 5), and the migration remains their one reader. The `roomId` stored on legacy FREEZER documents is still read raw by `ensureFreezerLocated` and by the migration (items 3, 7). The guard is `api/backend/tests/architecture/legacy-facility-room-reads.arch.test.js`.

## Not decided here

- The facility and room routes reading and writing StorageLocation (slice 3).
- Retiring the facility and room routes and the `facilities` and `rooms` collections (slice 4).
