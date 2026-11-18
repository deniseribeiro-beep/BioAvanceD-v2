/**
 * Sets `specimenId` on each Result that lacks it, from the Sample its legacy
 * `sampleID`/`sampleId` resolves to, and removes the legacy field (#628).
 *
 * One-way: no rollback. It `$unset`s `sampleID`/`sampleId`. That value held
 * one of several shapes (the Sample's `_id` string, a caller-supplied value,
 * the Sample's specimenId) and which one a Result held is not recorded, so
 * it cannot be rebuilt from `specimenId`. Undo is restoring results from a
 * backup.
 */
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
