require('dotenv').config();
/**
 * Upserts SIGTAP JSONL into terminologyConcepts with systemUri BRTabelaSUS.
 * Prefers lab-converted asset; falls back to bundled sample.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { connectNewDB, closeConnection } = require('../../src/database/mongo');

const SYSTEM_URI = 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRTabelaSUS';
const DEFAULT_FIXTURE = path.join(
  __dirname,
  '../../src/reference-data/reference-imports/fixtures/sigtap-procedures-sample.jsonl',
);

function parseArgs(argv) {
  const args = { inPath: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') args.inPath = argv[++i];
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

const BATCH_SIZE = 100;

async function importFile(db, filePath, dryRun) {
  const coll = dryRun ? null : db.collection('terminologyConcepts');
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let upserted = 0;
  let rejected = 0;
  let batch = [];

  async function flush() {
    if (!batch.length || dryRun) return;
    // Lab/standalone Mongo stalls on default w:majority; force acknowledged writes.
    await coll.bulkWrite(batch, { ordered: false, writeConcern: { w: 1 } });
    batch = [];
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    const raw = JSON.parse(line);
    const code = String(raw.id || '').trim();
    const display = String(raw.lbl || '').trim();
    if (!code || !display) {
      rejected += 1;
      continue;
    }
    upserted += 1;
    if (dryRun) continue;
    batch.push({
      updateOne: {
        filter: { systemUri: SYSTEM_URI, code },
        update: {
          $set: {
            systemUri: SYSTEM_URI,
            code,
            display,
            semanticType: 'procedure',
            sourceId: 'SRC_SIGTAP',
            obsolete: Boolean(raw.obsolete),
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return { upserted, rejected, systemUri: SYSTEM_URI, filePath, dryRun };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.inPath || DEFAULT_FIXTURE;
  if (!fs.existsSync(filePath)) {
    console.error(JSON.stringify({ error: 'input file not found', filePath }));
    process.exit(2);
  }
  if (args.dryRun) {
    const result = await importFile(null, filePath, true);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const db = await connectNewDB();
  try {
    const result = await importFile(db, filePath, false);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeConnection().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { importFile, SYSTEM_URI, parseArgs, main, DEFAULT_FIXTURE };
