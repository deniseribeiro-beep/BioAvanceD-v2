/**
 * Drops the legacy `locations` collection (#490), after writing every
 * document in it to a backup file.
 *
 * One-way: no rollback script. `drop()` cannot be undone; before it, the
 * service writes every document to `locations-backup-<timestamp>.json` under
 * the backup directory (BACKUP_DIR, or `backups` under the backend root when
 * it is unset). Restoring means inserting that file's documents back into
 * `locations`; the file is `JSON.stringify` output, so ObjectId and Date
 * values come back as strings and must be converted.
 */
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
