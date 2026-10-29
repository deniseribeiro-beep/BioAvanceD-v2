const { getCollection } = require('../utils/collectionResolver');
const { createLocation } = require('./storageLocation.service');
const { organizationIdFor, LOCATION_CODE_PREFIX } = require('./legacyPlacementChain.service');
const {
  FACILITY_LOCATION_TYPE, ROOM_LOCATION_TYPE, legacyLocationCode, findLegacyLocation,
} = require('./facilityRoomLocation.service');

// #1379: every Facility and Room (ELM-0168/0169) mirrored as a
// StorageLocation, facilities first, a room under its facility's location.
// Additive: facilities, rooms and storageContainers are only read.
//
// P1X-0103 is 1..1 and neither Facility nor Room carries an organization,
// so it is derived from the freezers in a room, through their Equipment, as
// the legacy placement chain resolves a freezer's (2026-10-11 item 3). A
// facility or room whose organization is not one is not written: a location
// with an invented owner would be in the wrong tenancy. The decisions are
// recorded in docs/decisions/2026-10-14-facility-room-locations.md.
//
// Idempotent: a facility or room already mirrored is found by its code and
// counted in alreadyMigrated; a second run writes nothing.
//
// Then each freezer location written at the root before its room was
// mirrored is re-parented under its room's location, in the same
// organization (slice 2). A second run re-parents nothing.

function counters() {
  return { scanned: 0, created: 0, alreadyMigrated: 0, deleted: 0 };
}

// The distinct organizations the room's non-deleted freezers resolve to.
async function derivedOrganizations(db, room) {
  const freezers = await db.collection('storageContainers')
    .find({ containerType: 'FREEZER', roomId: room._id, deletedAt: null })
    .toArray();
  const organizationIds = new Set();
  for (const freezer of freezers) {
    const organizationId = await organizationIdFor(db, freezer);
    if (organizationId) organizationIds.add(organizationId);
  }
  return organizationIds;
}

// Under a dry run nothing is written, and a would-be facility location has
// no id yet for its rooms to name.
async function mirror(db, data, dryRun) {
  if (dryRun) return { ...data, storageLocationId: null };
  return createLocation(db, data);
}

async function assertStoredOrganization(db, organizationId) {
  if (!organizationId) return null;
  const id = String(organizationId);
  const organization = await (await getCollection(db, 'organizations')).findOne({ organizationId: id });
  if (!organization) throw new Error(`Organização ${id} não encontrada`);
  return id;
}

async function mirrorFacilitiesAndRooms(db, { dryRun = false, organizationId = null } = {}) {
  const fallbackOrganizationId = await assertStoredOrganization(db, organizationId);
  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    facilities: counters(),
    rooms: counters(),
    freezers: { scanned: 0, reparented: 0, alreadyUnderRoom: 0, noLocation: 0, roomNotMirrored: 0 },
    unresolved: [],
  };

  const facilities = await db.collection('facilities').find({}).toArray();
  const rooms = await db.collection('rooms').find({}).toArray();

  const roomOrganizations = new Map();
  for (const room of rooms) {
    if (!room.deletedAt) roomOrganizations.set(String(room._id), await derivedOrganizations(db, room));
  }

  // Facility id -> its location ({ storageLocationId, organizationId }),
  // or null when it is deleted or unresolved.
  const facilityLocations = new Map();
  for (const facility of facilities) {
    const facilityId = String(facility._id);
    summary.facilities.scanned += 1;
    facilityLocations.set(facilityId, null);
    if (facility.deletedAt) {
      summary.facilities.deleted += 1;
      continue;
    }
    const existing = await findLegacyLocation(db, FACILITY_LOCATION_TYPE, facilityId);
    if (existing) {
      summary.facilities.alreadyMigrated += 1;
      facilityLocations.set(facilityId, existing);
      continue;
    }

    const derived = new Set();
    for (const room of rooms) {
      if (room.deletedAt || String(room.facilityId) !== facilityId) continue;
      for (const id of roomOrganizations.get(String(room._id))) derived.add(id);
    }
    if (derived.size > 1) {
      summary.unresolved.push({ kind: 'facility', id: facilityId, reason: 'conflicting_organizations', organizationIds: [...derived].sort() });
      continue;
    }
    const facilityOrganizationId = derived.size === 1 ? [...derived][0] : fallbackOrganizationId;
    if (!facilityOrganizationId) {
      summary.unresolved.push({ kind: 'facility', id: facilityId, reason: 'no_organization' });
      continue;
    }

    const location = await mirror(db, {
      locationType: FACILITY_LOCATION_TYPE,
      name: facility.name,
      code: legacyLocationCode(FACILITY_LOCATION_TYPE, facilityId),
      parentLocationId: null,
      organizationId: facilityOrganizationId,
      locationStatus: 'active',
    }, dryRun);
    summary.facilities.created += 1;
    facilityLocations.set(facilityId, location);
  }

  for (const room of rooms) {
    const roomId = String(room._id);
    summary.rooms.scanned += 1;
    if (room.deletedAt) {
      summary.rooms.deleted += 1;
      continue;
    }
    if (await findLegacyLocation(db, ROOM_LOCATION_TYPE, roomId)) {
      summary.rooms.alreadyMigrated += 1;
      continue;
    }
    const facilityId = String(room.facilityId);
    if (!facilityLocations.has(facilityId)) {
      summary.unresolved.push({ kind: 'room', id: roomId, reason: 'facility_not_found' });
      continue;
    }
    const parent = facilityLocations.get(facilityId);
    if (!parent) {
      summary.unresolved.push({ kind: 'room', id: roomId, reason: 'facility_not_mirrored' });
      continue;
    }

    const derived = roomOrganizations.get(roomId);
    const parentOrganizationId = String(parent.organizationId);
    if (derived.size > 1 || (derived.size === 1 && !derived.has(parentOrganizationId))) {
      summary.unresolved.push({
        kind: 'room', id: roomId, reason: 'conflicting_organizations', organizationIds: [...new Set([...derived, parentOrganizationId])].sort(),
      });
      continue;
    }

    await mirror(db, {
      locationType: ROOM_LOCATION_TYPE,
      name: room.name,
      code: legacyLocationCode(ROOM_LOCATION_TYPE, roomId),
      parentLocationId: parent.storageLocationId,
      organizationId: parentOrganizationId,
      locationStatus: 'active',
    }, dryRun);
    summary.rooms.created += 1;
  }

  await reparentFreezers(db, summary, dryRun);
  return summary;
}

// A non-deleted FREEZER with a roomId whose location sits at the root moves
// under its room's location, when that location is in the freezer
// location's organization.
async function reparentFreezers(db, summary, dryRun) {
  const freezers = await db.collection('storageContainers')
    .find({ containerType: 'FREEZER', deletedAt: null })
    .toArray();
  const locations = await getCollection(db, 'storageLocations');
  for (const freezer of freezers) {
    if (!freezer.roomId) continue;
    summary.freezers.scanned += 1;
    const location = await locations.findOne({ code: `${LOCATION_CODE_PREFIX}${String(freezer._id)}` });
    if (!location) {
      summary.freezers.noLocation += 1;
      continue;
    }
    if (location.parentLocationId) {
      summary.freezers.alreadyUnderRoom += 1;
      continue;
    }
    const room = await findLegacyLocation(db, ROOM_LOCATION_TYPE, freezer.roomId);
    if (!room) {
      summary.freezers.roomNotMirrored += 1;
      continue;
    }
    if (String(room.organizationId) !== String(location.organizationId)) {
      summary.unresolved.push({
        kind: 'freezer', id: String(freezer._id), reason: 'conflicting_organizations',
        organizationIds: [...new Set([String(room.organizationId), String(location.organizationId)])].sort(),
      });
      continue;
    }
    if (!dryRun) {
      await locations.updateOne({ storageLocationId: location.storageLocationId }, { $set: { parentLocationId: room.storageLocationId } });
    }
    summary.freezers.reparented += 1;
  }
}

module.exports = { mirrorFacilitiesAndRooms };
