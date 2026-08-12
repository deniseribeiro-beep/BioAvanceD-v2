require('dotenv').config();

const { connectNewDB, closeConnection } = require('../../src/database/mongo');
const { runNcbitaxImport } = require('../../src/reference-data/reference-imports');

// RF028 (#549) fourteenth operational Fase 2 importer — separate from
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
    const result = await runNcbitaxImport(db, { dryRun: args.dryRun });
    console.log(JSON.stringify({
      dataset: 'NCBITAX',
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
