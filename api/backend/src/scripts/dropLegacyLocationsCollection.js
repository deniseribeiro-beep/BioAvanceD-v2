const { connectDB, closeConnection } = require('../database/mongo');
const { dropLegacyLocationsCollection } = require('../services/drop-legacy-locations-collection.service');

async function run() {
  const db = await connectDB();
  const result = await dropLegacyLocationsCollection(db);
  console.log('Legacy `locations` collection drop:', JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro ao remover a coleção legada `locations`:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
