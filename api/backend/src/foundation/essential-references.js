const { getManifest } = require('../reference-data/essential');
const miabisSeed = require('../reference-data/miabis.min.json');
const sprecSeed = require('../reference-data/sprec.min.json');
const rcsReferenceData = require('../services/rcs-reference-data');

// The essential reference set's loaders, shared by the two phases that touch
// it (plano §4 F1.7, §5). Phase 1, the Foundation job, only prepares them:
// it loads every entry and checks every planned doc carries its unique keys,
// and writes none of them (RF022 AC7). Phase 2,
// scripts/load-essential-references.js, upserts what they load.

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

function selectEntries(only) {
  const manifest = getManifest();
  const selected = only ? manifest.filter((entry) => entry.key === only) : manifest;
  if (only && selected.length === 0) {
    throw new Error(`Unknown seed key: ${only}`);
  }
  return selected;
}

// Every loader loads and every planned doc carries its unique keys. Nothing
// is written.
function planSteps(selected) {
  return selected.map((entry) => {
    const { docsByCollection = {}, payload = null } = loadByKey(entry.key);
    const plannedCounts = Object.fromEntries(Object.entries(docsByCollection).map(([collection, docs]) => [collection, docs.length]));
    const keyless = Object.values(docsByCollection).flat()
      .filter((doc) => (entry.uniqueKeys || []).some((key) => doc[key] === undefined || doc[key] === null)).length;
    return { entry, docsByCollection, payload, plannedCounts, keyless };
  });
}

// The collections the essential set writes to, across every entry.
function referenceCollections(plan) {
  return [...new Set(plan.flatMap(({ docsByCollection }) => Object.keys(docsByCollection)))];
}

function filterFor(doc, uniqueKeys) {
  return uniqueKeys.length
    ? Object.fromEntries(uniqueKeys.map((key) => [key, doc[key]]))
    : { _id: doc._id };
}

// Returns the _ids this call inserted, the load's checkpoint: a doc that
// already existed is never claimed by this run.
async function upsertDocs(db, collectionName, docs, uniqueKeys = []) {
  const collection = db.collection(collectionName);
  const insertedIds = [];
  for (const doc of docs) {
    const result = await collection.updateOne(filterFor(doc, uniqueKeys), { $setOnInsert: { ...doc } }, { upsert: true });
    if (result && result.upsertedId !== undefined && result.upsertedId !== null) insertedIds.push(result.upsertedId);
  }
  return insertedIds;
}

// Every planned doc of one plan step is present.
async function missingDocsOf(db, { entry, docsByCollection }) {
  const missing = [];
  for (const [collectionName, docs] of Object.entries(docsByCollection)) {
    for (const doc of docs) {
      const filter = filterFor(doc, entry.uniqueKeys || []);
      if (await db.collection(collectionName).countDocuments(filter) === 0) missing.push({ step: entry.key, collection: collectionName, filter });
    }
  }
  return missing;
}

module.exports = { loadByKey, selectEntries, planSteps, referenceCollections, filterFor, upsertDocs, missingDocsOf };
