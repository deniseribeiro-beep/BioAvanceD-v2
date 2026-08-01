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
const { CANONICAL_COLLECTIONS } = require('../src/config/collections');

// dict-02_DICIONARIO.md is pinned at v1.3.0; this bootstrap only wires the
// 3-entry essential manifest (#366), not the full 929-element catalog (#370
// follow-up) — dictionaryVersion/dictionaryChecksum below describe what this
// run actually validated against (the manifest itself), not the full
// canonical dictionary, until that catalog exists as a consumable artifact.
const DICTIONARY_VERSION = '1.3.0';

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = getManifest();
  const selected = args.only ? manifest.filter((entry) => entry.key === args.only) : manifest;

  if (args.list) {
    for (const entry of manifest) {
      console.log(`${entry.key}\t${entry.system}\t${entry.version}\t${entry.description}`);
    }
    return;
  }

  if (args.only && selected.length === 0) {
    throw new Error(`Unknown seed key: ${args.only}`);
  }

  const db = args.dryRun ? null : await connectNewDB();
  try {
    if (args.dryRun) {
      for (const entry of selected) {
        const loaded = loadByKey(entry.key);
        const docsByCollection = loaded.docsByCollection || {};
        const plannedCounts = Object.fromEntries(Object.entries(docsByCollection).map(([collection, docs]) => [collection, docs.length]));
        console.log(JSON.stringify({ key: entry.key, dryRun: true, plannedCounts }, null, 2));
      }
      return;
    }

    const runs = db.collection(CANONICAL_COLLECTIONS.foundationDataRuns);
    const environment = require('../src/config/env').NODE_ENV;
    const deploymentId = process.env.HOSTNAME || os.hostname();
    const previousRun = await runs.find({ environment }).sort({ startedAt: -1 }).limit(1).next();
    const steps = [];

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
        schemaVersion: DICTIONARY_VERSION,
        dictionaryVersion: DICTIONARY_VERSION,
        environment,
        deploymentId,
        runStatus: 'failed',
        executionMode: 'apply',
        configurationChecksum: checksumFor({ selectedKeys: selected.map((entry) => entry.key), only: args.only, environment, deploymentId }),
        dictionaryChecksum: checksumFor(manifest.map((entry) => ({ key: entry.key, system: entry.system, version: entry.version }))),
        completedAt: new Date(),
        steps: [...steps, { step: selected[steps.length]?.key || 'unknown', status: 'failed' }],
        validationSummary: { passed: steps.length, failed: 1 },
        errorSummary: { fatal: 1, message: error.message || String(error) },
        initiatedBy: 'system:foundation-data-pipeline',
        previousRunId: previousRun ? previousRun.foundationDataRunId : null,
      });
      await runs.insertOne(failedRun);
      throw error;
    }

    const completedRun = FoundationDataRunModel.create({
      pipelineVersion,
      schemaVersion: DICTIONARY_VERSION,
      dictionaryVersion: DICTIONARY_VERSION,
      environment,
      deploymentId,
      runStatus: 'completed',
      executionMode: 'apply',
      configurationChecksum: checksumFor({ selectedKeys: selected.map((entry) => entry.key), only: args.only, environment, deploymentId }),
      dictionaryChecksum: checksumFor(manifest.map((entry) => ({ key: entry.key, system: entry.system, version: entry.version }))),
      completedAt: new Date(),
      steps,
      validationSummary: { passed: steps.length, failed: 0 },
      initiatedBy: 'system:foundation-data-pipeline',
      previousRunId: previousRun ? previousRun.foundationDataRunId : null,
    });
    await runs.insertOne(completedRun);
  } finally {
    if (!args.dryRun) {
      await closeConnection().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
