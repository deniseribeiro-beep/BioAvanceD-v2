const { connectDB, closeConnection } = require('../database/mongo');
const { backfillResultSpecimenIds } = require('../services/result-specimenid-backfill.service');

async function run() {
  const db = await connectDB();
  const { summary } = await backfillResultSpecimenIds(db);
  console.log('Result.specimenId backfill (#628):', JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro no backfill de Result.specimenId:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
