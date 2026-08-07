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
