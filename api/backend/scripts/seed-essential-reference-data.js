require('dotenv').config();

const crypto = require('crypto');
const os = require('os');
const { version: pipelineVersion } = require('../package.json');
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const { getManifest, getManifestByKey } = require('../src/reference-data/essential');
const miabisSeed = require('../src/reference-data/miabis.min.json');
const sprecSeed = require('../src/reference-data/sprec.min.json');
const rcsReferenceData = require('../src/services/rcs-reference-data');
const FoundationDataRunModel = require('../src/models/FoundationDataRun');
const canonicalDictionary = require('../src/reference-data/canonical-dictionary/v2');
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');

// This bootstrap only wires the 3-entry essential manifest (#366); the full
// canonical dictionary is loaded separately (#381) purely to pin
// dictionaryVersion/dictionaryChecksum/completeness on each run. RF022 AC1
// (Requisitos v4.0.0) names the approved v2.0.0 release, 1644 elements with
// the 929 historical ones, so that is the catalog it pins — Mongo
// schemas for the ~817 non-technical domain elements are still out of scope
// (dict-08_MAIN_GAPS.md's per-domain rows, tracked independently).

function parseArgs(argv) {
  const args = { dryRun: false, list: false, only: null };
  for (const token of argv) {
    if (token === '--dry-run') args.dryRun = true;
    else if (token === '--list') args.list = true;
    else if (token.startsWith('--only=')) args.only = token.slice('--only='.length);
  }
  return args;
}

function checksumFor(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function loadByKey(key) {
  if (key === 'miabis-minimal') {
    return {
      docsByCollection: {
        sampleTypes: ensureArray(miabisSeed.sampleTypes),
        sampleOrigins: ensureArray(miabisSeed.sampleOrigins),
        extractionProtocols: ensureArray(miabisSeed.extractionProtocols),
        qualityDescriptions: ensureArray(miabisSeed.qualityDescriptions),
      },
    };
  }

  if (key === 'sprec-minimal') {
    return {
      docsByCollection: {
        terminologies: ensureArray(sprecSeed.axes).map((axis) => ({
          sistema: sprecSeed.sistema,
          fonte: sprecSeed.fonte,
          axis: axis.axis,
          code: axis.code,
          label: axis.label,
          descricao: axis.descricao,
        })),
      },
    };
  }

  if (key === 'rcs-gov-1.0') {
    return {
      docsByCollection: {},
      payload: {
        catalogs: rcsReferenceData.catalogs,
        severityMappings: rcsReferenceData.severityMappings,
        weights: rcsReferenceData.weights,
        thresholds: rcsReferenceData.thresholds,
        governanceRules: rcsReferenceData.governanceRules,
      },
    };
  }

  throw new Error(`Loader not implemented for seed key: ${key}`);
}

async function upsertDocs(db, collectionName, docs, uniqueKeys = []) {
  const collection = db.collection(collectionName);
  let planned = 0;
  for (const doc of docs) {
    const filter = uniqueKeys.length
      ? Object.fromEntries(uniqueKeys.map((key) => [key, doc[key]]))
      : { _id: doc._id };
    await collection.updateOne(filter, { $setOnInsert: { ...doc } }, { upsert: true });
    planned += 1;
  }
  return planned;
}

/**
 * Core bootstrap logic, factored out from `main()` so it can run against an
 * injected `db` (a real Mongo handle from the CLI entrypoint, or a fake
 * collection in tests) instead of always opening a live connection.
 */
async function runSeed({ db, args, environment, deploymentId }) {
  const manifest = getManifest();
  const selected = args.only ? manifest.filter((entry) => entry.key === args.only) : manifest;

  if (args.list) {
    for (const entry of manifest) {
      console.log(`${entry.key}\t${entry.system}\t${entry.version}\t${entry.description}`);
    }
    return null;
  }

  if (args.only && selected.length === 0) {
    throw new Error(`Unknown seed key: ${args.only}`);
  }

  if (args.dryRun) {
    for (const entry of selected) {
      const loaded = loadByKey(entry.key);
      const docsByCollection = loaded.docsByCollection || {};
      const plannedCounts = Object.fromEntries(Object.entries(docsByCollection).map(([collection, docs]) => [collection, docs.length]));
      console.log(JSON.stringify({ key: entry.key, dryRun: true, plannedCounts }, null, 2));
    }
    return null;
  }

  const runs = db.collection(CANONICAL_COLLECTIONS.foundationDataRuns);
  const previousRun = await runs.find({ environment }).sort({ startedAt: -1 }).limit(1).next();
  const steps = [];
  // #381, RF022 AC1: the dictionary completeness check (v2.0.0: 1644
  // elements, every historical id present) — computed
  // once per run and recorded regardless of manifest-step outcome, since it
  // verifies the dictionary artifact itself, not this run's manifest steps.
  const dictionaryCompleteness = canonicalDictionary.checkCompleteness();

  try {
    for (const entry of selected) {
      const loaded = loadByKey(entry.key);
      const docsByCollection = loaded.docsByCollection || {};
      const plannedCounts = Object.fromEntries(Object.entries(docsByCollection).map(([collection, docs]) => [collection, docs.length]));
      console.log(JSON.stringify({ key: entry.key, dryRun: false, plannedCounts }, null, 2));
      for (const [collectionName, docs] of Object.entries(docsByCollection)) {
        await upsertDocs(db, collectionName, docs, entry.uniqueKeys || []);
      }
      steps.push({ step: entry.key, system: entry.system, version: entry.version, status: 'completed', plannedCounts });
    }
  } catch (error) {
    const failedRun = FoundationDataRunModel.create({
      pipelineVersion,
      schemaVersion: canonicalDictionary.DICTIONARY_VERSION,
      dictionaryVersion: canonicalDictionary.DICTIONARY_VERSION,
      environment,
      deploymentId,
      runStatus: 'failed',
      executionMode: 'apply',
      configurationChecksum: checksumFor({ selectedKeys: selected.map((entry) => entry.key), only: args.only, environment, deploymentId }),
      dictionaryChecksum: canonicalDictionary.dictionaryChecksum(),
      completedAt: new Date(),
      steps: [...steps, { step: selected[steps.length]?.key || 'unknown', status: 'failed' }],
      validationSummary: { passed: steps.length, failed: 1, dictionaryCompleteness },
      // P1X-0409: errorSummary must stay sanitized (no secrets/tokens/raw
      // payloads) — truncate defensively since a Mongo write-error message
      // can echo back offending field values.
      errorSummary: { fatal: 1, message: String(error.message || error).slice(0, 300) },
      initiatedBy: 'system:foundation-data-pipeline',
      previousRunId: previousRun ? previousRun.foundationDataRunId : null,
    });
    await runs.insertOne(failedRun);
    throw error;
  }

  const completedRun = FoundationDataRunModel.create({
    pipelineVersion,
    schemaVersion: canonicalDictionary.DICTIONARY_VERSION,
    dictionaryVersion: canonicalDictionary.DICTIONARY_VERSION,
    environment,
    deploymentId,
    runStatus: 'completed',
    executionMode: 'apply',
    configurationChecksum: checksumFor({ selectedKeys: selected.map((entry) => entry.key), only: args.only, environment, deploymentId }),
    dictionaryChecksum: canonicalDictionary.dictionaryChecksum(),
    completedAt: new Date(),
    steps,
    validationSummary: { passed: steps.length, failed: 0, dictionaryCompleteness },
    initiatedBy: 'system:foundation-data-pipeline',
    previousRunId: previousRun ? previousRun.foundationDataRunId : null,
  });
  await runs.insertOne(completedRun);
  return completedRun;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const environment = require('../src/config/env').NODE_ENV;
  const deploymentId = process.env.HOSTNAME || os.hostname();

  const db = args.list || args.dryRun ? null : await connectNewDB();
  try {
    await runSeed({ db, args, environment, deploymentId });
  } finally {
    if (db) {
      await closeConnection().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { runSeed, parseArgs, checksumFor };
