#!/usr/bin/env node
/**
 * Loads Orphadata-derived intake-records.jsonl into terminologies +
 * orphanet_diseases so ClinicalIntakeWizard disease search can autofill
 * ORPHA + OMIM + CID-10 from relacoes.
 *
 * Usage:
 *   node scripts/reference-imports/load-orpha-intake-records.js \
 *     --in ../../ref-full/ORPHA/intake-records.jsonl
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { MongoClient } = require('mongodb');
const { upsertTerminology } = require('../../src/services/terminologySync.service');

async function loadJsonl(filePath, db) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let upserted = 0;
  let skipped = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    const result = await upsertTerminology(record, db);
    if (result?.skipped) skipped += 1;
    else upserted += 1;
  }
  return { upserted, skipped };
}

async function main(argv = process.argv.slice(2)) {
  let inputPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') inputPath = argv[++i];
  }
  if (!inputPath) {
    process.stderr.write('Usage: load-orpha-intake-records.js --in <intake-records.jsonl>\n');
    process.exit(2);
  }
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/bioavance';
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const result = await loadJsonl(path.resolve(inputPath), db);
    process.stdout.write(`${JSON.stringify({ ...result, inputPath })}\n`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = { loadJsonl };
