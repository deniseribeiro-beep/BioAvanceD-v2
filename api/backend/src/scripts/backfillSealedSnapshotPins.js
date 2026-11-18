/**
 * Pins `sealedRcsAssessmentId` and `sealedSpecimenPreanalyticsId` on the
 * samples that lack them and have a snapshot for their specimenId (#504).
 *
 * One-way: no rollback. The pins it sets are the same fields a seal writes
 * since #502, so nothing tells this run's pins apart, and removing a pin
 * reopens the "resolve newest" fallback the pin closes. Undo is restoring
 * samples from a backup.
 */
const { connectDB, closeConnection } = require('../database/mongo');
const { backfillSealedSnapshotPins } = require('../services/sealed-snapshot-backfill.service');

async function run() {
  const db = await connectDB();
  const { summary } = await backfillSealedSnapshotPins(db);
  console.log('sealedRcsAssessmentId/sealedSpecimenPreanalyticsId backfill:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro no backfill de sealedRcsAssessmentId/sealedSpecimenPreanalyticsId:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
