/**
 * Backfills the legacy `locations` rows onto the storage model: inserts the
 * StorageContainers and StorageBoxes they imply and places each specimen on
 * the physical chain.
 *
 * One-way: no rollback. The containers and boxes are inserted with
 * `createdBy: null` and no field marking this run, and each specimen is
 * placed on the physical chain, whose assignments are append-only
 * (physicalChain.service.js). Only the specimen-container load and a newly
 * opened rack-location assignment carry a run marker,
 * `sourceEventId: 'legacy-location-backfill:<locationID>:<sample _id>'`; the
 * container-position assignment (the placement itself) and the created
 * `containers` row carry none, and a rack that already has an open assignment
 * gets no new marker. So most of what the run writes cannot be found by it,
 * and later moves on the append-only chain build on the rows that can, so
 * deleting those is no undo. Placing a specimen also creates StorageLocation
 * mirrors for the freezer and the ancestor containers (storageLocations). The
 * source, the legacy `locations` collection, is dropped afterwards by
 * dropLegacyLocationsCollection.js (#490). Undo is restoring
 * storageContainers, storageBoxes, storageLocations and the physical-chain
 * collections (containers, specimenContainerAssignments,
 * containerPositionAssignments, rackLocationAssignments) from a backup taken
 * before the run.
 */
const { connectDB, closeConnection } = require('../database/mongo');
const { backfillLocationsToStorage } = require('../services/location-storage-backfill.service');

async function run() {
  const db = await connectDB();
  const { summary } = await backfillLocationsToStorage(db);
  console.log('Location -> cadeia física backfill:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro no backfill de Location -> cadeia física:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
