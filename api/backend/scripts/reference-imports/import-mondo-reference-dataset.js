require('dotenv').config();

const { connectNewDB, closeConnection } = require('../../src/database/mongo');
const { runMondoImport } = require('../../src/reference-data/reference-imports');

// RF028 (#548) second operational Fase 2 importer — separate from
// import-large-reference-dataset.js, which stays a non-operational
// placeholder for the remaining 12 sources per seed-boundary.arch.test.js.
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
    const result = await runMondoImport(db, { dryRun: args.dryRun });
    console.log(JSON.stringify({
      dataset: 'MONDO',
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
