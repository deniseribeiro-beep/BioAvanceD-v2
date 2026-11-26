#!/usr/bin/env node
/**
 * Offline hybrid crosswalk: enrich BiomarkerAssociation JSONL with ORPHA/MONDO condition
 * codings while keeping MarkerDB provisional labels and evidence intact.
 *
 *   node crosswalkMarkerDbConditions.js --in associations.jsonl --out enriched.jsonl
 *   node crosswalkMarkerDbConditions.js --in associations.jsonl --out enriched.jsonl \
 *     --orpha-jsonl /path/ORPHA/data.jsonl --mondo-jsonl /path/MONDO/data.jsonl
 *   node crosswalkMarkerDbConditions.js --in associations.jsonl --out enriched.jsonl --mongo
 */
const path = require('path');
const {
  crosswalkAssociationRecords,
  loadJsonlTerminologyIndex,
  loadMongoTerminologyIndex,
  readJsonlFile,
  writeJsonl,
  defaultRepoRoot,
} = require('./markerDbConditionCrosswalkLib');

const FIXTURE_ORPHA = path.join(__dirname, '..', 'fixtures', 'orpha-sample.jsonl');
const FIXTURE_MONDO = path.join(__dirname, '..', 'fixtures', 'mondo-sample.jsonl');

function parseArgs(argv) {
  const args = {
    inPath: null,
    outPath: null,
    orphaJsonl: FIXTURE_ORPHA,
    mondoJsonl: FIXTURE_MONDO,
    unmatchedPath: null,
    useMongo: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--in') args.inPath = argv[++i];
    else if (flag === '--out') args.outPath = argv[++i];
    else if (flag === '--orpha-jsonl') args.orphaJsonl = argv[++i];
    else if (flag === '--mondo-jsonl') args.mondoJsonl = argv[++i];
    else if (flag === '--unmatched-out') args.unmatchedPath = argv[++i];
    else if (flag === '--mongo') args.useMongo = true;
  }
  return args;
}

function defaultUnmatchedPath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(defaultRepoRoot(), 'docs', 'data', 'markerdb', `crosswalk-unmatched-${date}.jsonl`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inPath || !args.outPath) {
    console.error('Usage: node crosswalkMarkerDbConditions.js --in <in.jsonl> --out <out.jsonl> [--orpha-jsonl] [--mondo-jsonl] [--unmatched-out] [--mongo]');
    process.exit(1);
  }

  const records = await readJsonlFile(args.inPath);

  let indices;
  let mondoToOrpha;
  if (args.useMongo) {
    // eslint-disable-next-line global-require
    require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });
    // eslint-disable-next-line global-require
    const { connectNewDB, closeConnection } = require('../../../database/mongo');
    const db = await connectNewDB();
    try {
      const loaded = await loadMongoTerminologyIndex(db);
      indices = { orpha: loaded.orpha, mondo: loaded.mondo };
      mondoToOrpha = loaded.mondoToOrpha;
    } finally {
      await closeConnection().catch(() => {});
    }
  } else {
    const loaded = await loadJsonlTerminologyIndex(args.orphaJsonl, args.mondoJsonl);
    indices = { orpha: loaded.orpha, mondo: loaded.mondo };
    mondoToOrpha = loaded.mondoToOrpha;
  }

  const { enriched, unmatched, summary } = crosswalkAssociationRecords(records, indices, mondoToOrpha);
  writeJsonl(args.outPath, enriched);
  const unmatchedPath = args.unmatchedPath || defaultUnmatchedPath();
  writeJsonl(unmatchedPath, unmatched);

  const result = {
    inPath: args.inPath,
    outPath: args.outPath,
    unmatchedPath,
    terminology: args.useMongo
      ? { source: 'mongo:terminologyConcepts' }
      : { orphaJsonl: args.orphaJsonl, mondoJsonl: args.mondoJsonl },
  };
  console.log(JSON.stringify({ ...result, summary, unmatchedWritten: unmatched.length }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { parseArgs, main };