const { connectDB, closeConnection } = require('../database/mongo');
const { backfillLocationsToStorage } = require('../services/location-storage-backfill.service');

async function run() {
  const db = await connectDB();
  const { summary } = await backfillLocationsToStorage(db);
  console.log('Location -> StorageAssignment backfill:', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro no backfill de Location -> StorageAssignment:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
