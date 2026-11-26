/**
 * Migration: every Facility and Room mirrored as a StorageLocation (#1379,
 * ELM-0168/0169 deprecated in v2.0.0; P1X-0098..0104).
 *
 * One StorageLocation per facility (locationType `facility`, no parent) and
 * per room (locationType `room`, under its facility's location), each coded
 * `legacy-<kind>:<_id>` so the old id stays resolvable. The organization
 * (P1X-0103, 1..1) is derived from the freezers in each room, through their
 * Equipment; a facility with none derived takes --organization-id when it is
 * given, and one still without an organization, or with conflicting ones, is
 * listed in unresolved and not written, with its rooms. Deleted facilities
 * and rooms are counted, not written. facilities and rooms are only read.
 * The rule is docs/decisions/2026-10-14-facility-room-locations.md.
 *
 * Then each FREEZER with a roomId whose mirrored location
 * (`legacy-storage-container:<_id>`) sits at the root is re-parented under
 * its room's location when that is in the same organization; one under
 * another organization's room is listed in unresolved. The summary's
 * freezers counts scanned, reparented, alreadyUnderRoom, noLocation and
 * roomNotMirrored. storageContainers is only read.
 *
 * Idempotent: a facility or room already mirrored is counted in
 * alreadyMigrated, and a freezer already under a location in
 * alreadyUnderRoom, so a second run writes nothing.
 *
 * One-way: no rollback. After the run the facilities and rooms collections
 * are read by nothing but this migration, and legacyPlacementChain.service.js
 * places a legacy FREEZER's location under its room's mirrored location at
 * run time, so locations written since sit under the mirrors and nothing
 * tells them from the ones this run moved. Deleting the mirrors would orphan
 * them. Undo it by restoring storageLocations from a backup taken before the
 * run; facilities and rooms are never changed.
 *
 * Usage (from api/backend):
 *   npm run migrate:facilities-rooms-to-locations                          applies
 *   npm run migrate:facilities-rooms-to-locations -- --dry-run             counts, writes nothing
 *   npm run migrate:facilities-rooms-to-locations -- --organization-id <id>
 *     the organization of a facility none can be derived for; it must be a
 *     stored organizationId, else nothing is written
 */

const { connectDB, closeConnection } = require('../database/mongo');
const { mirrorFacilitiesAndRooms } = require('../services/facilityRoomLocationMigration.service');

function organizationIdArg(argv) {
  const index = argv.indexOf('--organization-id');
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('--organization-id requer um valor');
  return value;
}

async function run(argv = process.argv.slice(2), { db } = {}) {
  const dryRun = argv.includes('--dry-run');
  const organizationId = organizationIdArg(argv);
  const database = db || await connectDB();
  const summary = await mirrorFacilitiesAndRooms(database, { dryRun, organizationId });
  console.log(`Facility/Room -> StorageLocation (${summary.mode}):`, JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração Facility/Room -> StorageLocation:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
