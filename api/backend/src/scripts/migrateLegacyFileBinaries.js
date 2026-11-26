/**
 * #1419: move the binaries of legacy DataFile rows (written to local disk
 * before the object store, so with no storageObjectVersion) into the object
 * store, through services/legacyFileMigration.service.js. Once moved, the
 * key-rotation rewrite (npm run encryption:rewrite) can re-encrypt them.
 *
 * A row is moved only on positive evidence and every other row is counted
 * and left untouched; the disk file is never removed or changed
 * (docs/decisions/2026-10-30-data-file-legacy-disk-rows-migration.md).
 *
 * One-way: no rollback. --apply overwrites a moved row's storagePath,
 * storageUri and storageObjectVersion, and its version rows' objectUri, with
 * the object store's, and keeps the earlier values nowhere, so nothing
 * points the row back at its disk file. Once npm run encryption:rewrite
 * re-keys the object, the row's envelope no longer opens the disk bytes
 * either. The disk files are never changed: undo the move by restoring
 * sample_files, assayFiles, datasetFiles and dataFileVersions from a backup
 * taken before --apply.
 *
 * Usage, from api/backend:
 *   npm run files:migrate-legacy              dry run: counts, writes nothing
 *   npm run files:migrate-legacy -- --apply   moves the binaries
 *
 * Exits 1 when any collection counts a fileMissing or unreadable row.
 */

const { connectDB, closeConnection } = require('../database/mongo');
const { migrateLegacyFileBinaries } = require('../services/legacyFileMigration.service');

async function run(argv = process.argv.slice(2), { db, objectStore, roots } = {}) {
  const database = db || await connectDB();
  const summaries = await migrateLegacyFileBinaries(database, { apply: argv.includes('--apply'), objectStore, roots });
  console.log(JSON.stringify({ mode: argv.includes('--apply') ? 'apply' : 'dry-run', files: summaries }, null, 2));
  if (Object.values(summaries).some((s) => s.fileMissing > 0 || s.unreadable > 0)) process.exitCode = 1;
  return summaries;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro ao migrar arquivos legados para o Object Storage:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
