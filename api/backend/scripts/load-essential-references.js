require('dotenv').config();

const crypto = require('crypto');
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const ReferenceImportRunModel = require('../src/models/ReferenceImportRun');
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');
const { selectEntries, planSteps, upsertDocs, missingDocsOf } = require('../src/foundation/essential-references');

// Phase 2 (plano §5, RF028) for the essential reference set: the MIABIS and
// SPREC minimal sets and the RCS-GOV 1.0 package. Foundation (Phase 1,
// seed-essential-reference-data.js) prepares their loaders and populates
// none of them (RF022 AC7); this one-shot job loads them, after a ready
// ReadinessReport and before the API.
//
// Each entry's attempt is one ReferenceImportRun (RF028 AC5), linked to the
// Foundation run whose report allowed it and checkpointing the _ids it
// inserted. Upserts use $setOnInsert, so a re-run inserts nothing and says
// so. referenceDatasetReleaseId stays null: registering a release before the
// load (plano §5 step 1) is BioAvanceD-v2#1319's.
//
//   (default)   full: upsert every entry, then check every doc is present
//   --dry-run   dry_run: loads and checks each entry, writes only its run
//   --only=<k>  one manifest entry

const INITIATED_BY = 'system:essential-reference-load';

function parseArgs(argv) {
  const args = { dryRun: false, only: null };
  for (const token of argv) {
    if (token === '--dry-run') args.dryRun = true;
    else if (token.startsWith('--only=')) args.only = token.slice('--only='.length);
  }
  return args;
}

function checksumFor(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Phase 2 runs only on a Foundation that promoted (plano §4 F1.11).
async function readyReport(db, environment) {
  return db.collection(CANONICAL_COLLECTIONS.readinessReports)
    .find({ environment }).sort({ generatedAt: -1 }).limit(1).next();
}

async function loadEntry(db, step, { dryRun, foundationDataRunId }) {
  const { entry, docsByCollection, payload, keyless } = step;
  const inputChecksum = checksumFor({ docsByCollection, payload });
  const recordsRead = Object.values(docsByCollection).reduce((total, docs) => total + docs.length, 0);
  const startedAt = new Date();
  const insertedIds = {};
  let missing = [];
  if (!dryRun && keyless === 0) {
    for (const [collectionName, docs] of Object.entries(docsByCollection)) {
      insertedIds[collectionName] = await upsertDocs(db, collectionName, docs, entry.uniqueKeys || []);
    }
    missing = await missingDocsOf(db, step);
  }
  const recordsInserted = Object.values(insertedIds).reduce((total, ids) => total + ids.length, 0);
  const failed = keyless > 0 || missing.length > 0;
  const run = ReferenceImportRunModel.create({
    referenceDatasetReleaseId: null,
    foundationDataRunId,
    datasetCode: entry.key,
    importMode: dryRun ? 'dry_run' : 'full',
    idempotencyKey: `${entry.key}:${entry.version}:sha256:${inputChecksum}`,
    startedAt,
    completedAt: new Date(),
    runStatus: failed ? 'failed' : dryRun ? 'validated' : 'completed',
    checkpoint: dryRun ? null : { insertedIds },
    recordsRead,
    recordsValidated: recordsRead - keyless,
    recordsInserted,
    recordsSkipped: dryRun ? 0 : recordsRead - recordsInserted,
    recordsRejected: keyless,
    inputChecksum,
    validationSummary: { fatal: failed ? 1 : 0, errors: 0, warnings: 0, rejectionRate: recordsRead ? keyless / recordsRead : 0, approved: !failed, missing: missing.slice(0, 20) },
    initiatedBy: INITIATED_BY,
  });
  await db.collection(CANONICAL_COLLECTIONS.referenceImportRuns).insertOne(run);
  return run;
}

/**
 * Returns { blocked, runs }. `blocked` names why nothing loaded: no ready
 * ReadinessReport for this environment.
 */
async function runLoad({ db, args, environment }) {
  const selected = selectEntries(args.only);
  const report = await readyReport(db, environment);
  if (!report || report.status !== 'ready') {
    return { blocked: report ? `foundation_${report.status}` : 'no_readiness_report', runs: [] };
  }
  const runs = [];
  for (const step of planSteps(selected)) {
    runs.push(await loadEntry(db, step, { dryRun: args.dryRun, foundationDataRunId: report.foundationDataRunId }));
  }
  return { blocked: null, runs };
}

function exitCodeFor({ blocked, runs }) {
  if (blocked) return 1;
  return runs.every((run) => run.runStatus !== 'failed') ? 0 : 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const environment = require('../src/config/env').NODE_ENV;
  const db = await connectNewDB();
  let code = 0;
  try {
    const result = await runLoad({ db, args, environment });
    console.log(JSON.stringify({
      blocked: result.blocked,
      runs: result.runs.map(({ datasetCode, importMode, runStatus, recordsRead, recordsInserted, recordsSkipped }) => ({ datasetCode, importMode, runStatus, recordsRead, recordsInserted, recordsSkipped })),
    }, null, 2));
    code = exitCodeFor(result);
  } finally {
    await closeConnection().catch(() => {});
  }
  process.exitCode = code;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { runLoad, parseArgs, exitCodeFor };
