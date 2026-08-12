require('dotenv').config();

const { connectNewDB, closeConnection } = require('../../src/database/mongo');
const { runEdamImport } = require('../../src/reference-data/reference-imports');

// RF028 (#549) sixteenth and final operational Fase 2 importer — separate
// from import-large-reference-dataset.js, which stays a non-operational
// placeholder for any source outside this loop's 16.
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
    const result = await runEdamImport(db, { dryRun: args.dryRun });
    console.log(JSON.stringify({
      dataset: 'EDAM',
      dryRun: args.dryRun,
      idempotent: Boolean(result.idempotent),
      runStatus: result.run.runStatus,
      recordsRead: result.run.recordsRead,
      recordsValidated: result.run.recordsValidated,
      recordsInserted: result.run.recordsInserted,
      recordsRejected: result.run.recordsRejected,
    }, null, 2));
  } finally {
    await closeConnection().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
