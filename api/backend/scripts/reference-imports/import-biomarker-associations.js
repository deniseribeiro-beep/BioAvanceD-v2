require('dotenv').config();

const { connectNewDB, closeConnection } = require('../../src/database/mongo');
const { runBiomarkerAssociationImport } = require('../../src/reference-data/reference-imports/importBiomarkerAssociations');

// Curated SRC_MARKERDB sample → biomarkerAssociations (#1206 / empty UI gap).
function parseArgs(argv) {
  const args = { dryRun: false, fixturePath: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    if (argv[i] === '--in') args.fixturePath = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = await connectNewDB();
  try {
    const result = await runBiomarkerAssociationImport(db, {
      dryRun: args.dryRun,
      fixturePath: args.fixturePath || undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.recordsRejected > 0) process.exitCode = 2;
  } finally {
    await closeConnection().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
