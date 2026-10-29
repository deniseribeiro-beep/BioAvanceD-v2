require('dotenv').config();

const { connectNewDB, closeConnection } = require('../../src/database/mongo');
const { runHgncImport } = require('../../src/reference-data/reference-imports');
const { promoteRelease } = require('../../src/services/referenceRelease.service');

// RF028 (#549) seventh operational Fase 2 importer — separate from
// import-large-reference-dataset.js, which stays a non-operational
// placeholder for the remaining sources.
function parseArgs(argv) {
  const args = { dryRun: false };
  for (const token of argv) {
    if (token === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = await connectNewDB();
  try {
    const result = await runHgncImport(db, { dryRun: args.dryRun });
    // RF028 AC8: the bootstrap promotes its own approved full run explicitly.
    const run = result.run;
    const promotion = !args.dryRun
      && run.importMode === 'full'
      && run.runStatus === 'completed'
      && run.validationSummary && run.validationSummary.approved === true
      && run.referenceDatasetReleaseId
      ? await promoteRelease({ db, releaseId: run.referenceDatasetReleaseId, approvedBy: 'system:reference-data-bootstrap' })
      : null;
    console.log(JSON.stringify({
      dataset: 'HGNC',
      dryRun: args.dryRun,
      idempotent: Boolean(result.idempotent),
      runStatus: result.run.runStatus,
      recordsRead: result.run.recordsRead,
      recordsValidated: result.run.recordsValidated,
      recordsInserted: promotion && promotion.promoted ? promotion.recordsInserted : result.run.recordsInserted,
      recordsRejected: result.run.recordsRejected,
      promoted: Boolean(promotion && promotion.promoted),
      promotionReason: promotion && !promotion.promoted ? promotion.reason : null,
    }, null, 2));
  } finally {
    await closeConnection().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
