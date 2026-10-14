const { getCollection } = require('../utils/collectionResolver');

// #1379: a legacy Facility or Room (ELM-0168/0169, deprecated in v2.0.0) is
// mirrored as a StorageLocation (P1X-0098..0104). The location's own
// storageLocationId is a uuid (P1X-0098); the old id stays resolvable
// through its code, `legacy-<kind>:<_id>`, unique because the old _id is.
// The decisions are recorded in docs/decisions/2026-10-14-facility-room-locations.md.
//
// A leaf: it requires no other service, so legacyPlacementChain.service.js
// can require it.

const FACILITY_LOCATION_TYPE = 'facility';
const ROOM_LOCATION_TYPE = 'room';
const LEGACY_KINDS = [FACILITY_LOCATION_TYPE, ROOM_LOCATION_TYPE];

function legacyLocationCode(kind, id) {
  if (!LEGACY_KINDS.includes(kind)) throw new Error(`Tipo legado inválido: ${kind}`);
  return `legacy-${kind}:${String(id)}`;
}

// The StorageLocation mirroring the Facility or Room with this old id, if any.
async function findLegacyLocation(db, kind, legacyId, session) {
  return (await getCollection(db, 'storageLocations')).findOne(
    { code: legacyLocationCode(kind, legacyId), locationType: kind },
    session ? { session } : undefined,
  );
}

module.exports = {
  FACILITY_LOCATION_TYPE,
  ROOM_LOCATION_TYPE,
  legacyLocationCode,
  findLegacyLocation,
};
