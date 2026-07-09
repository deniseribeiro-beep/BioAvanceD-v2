require('dotenv').config();

const crypto = require('crypto');
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const { getManifest, getManifestByKey } = require('../src/reference-data/essential');
const miabisSeed = require('../src/reference-data/miabis.min.json');
const sprecSeed = require('../src/reference-data/sprec.min.json');
const rcsReferenceData = require('../src/services/rcs-reference-data');

function parseArgs(argv) {
  const args = { dryRun: false, list: false, strict: false, only: null };
  for (const token of argv) {
    if (token === '--dry-run') args.dryRun = true;
    else if (token === '--list') args.list = true;
    else if (token === '--strict') args.strict = true;
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
      docsByCollection: {
        referenceSeedRuns: [
          {
            key: 'rcs-gov-1.0',
            version: '1.0',
            system: 'RCS-GOV',
            checksum: checksumFor(rcsReferenceData),
            executedAt: new Date().toISOString(),
            seedRun: true,
            payload: {
              catalogs: rcsReferenceData.catalogs,
              severityMappings: rcsReferenceData.severityMappings,
              weights: rcsReferenceData.weights,
              thresholds: rcsReferenceData.thresholds,
              governanceRules: rcsReferenceData.governanceRules,
            },
          },
        ],
      },
    };
  }

  throw new Error(`Loader not implemented for seed key: ${key}`);
}

async function upsertDocs(db, collectionName, docs) {
  const collection = db.collection(collectionName);
  let planned = 0;
  for (const doc of docs) {
    const key = doc.key || doc.id || doc.code || doc.axis;
    const filter = key ? { [doc.key ? 'key' : doc.id ? 'id' : doc.code ? 'code' : 'axis']: key } : { _id: doc._id };
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
    for (const entry of selected) {
      const loaded = loadByKey(entry.key);
      const docsByCollection = loaded.docsByCollection || {};
      const plannedCounts = Object.fromEntries(Object.entries(docsByCollection).map(([collection, docs]) => [collection, docs.length]));
      console.log(JSON.stringify({ key: entry.key, dryRun: args.dryRun, plannedCounts }, null, 2));
      if (!args.dryRun) {
        for (const [collectionName, docs] of Object.entries(docsByCollection)) {
          await upsertDocs(db, collectionName, docs);
        }
      }
    }
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
