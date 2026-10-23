const fluidCatalogSeed = require('../reference-data/rcs-sprec-fluid-catalog.RCS-GOV-1.0.json');
const solidCatalogSeed = require('../reference-data/rcs-sprec-solid-catalog.RCS-GOV-1.0.json');
const severitySeed = require('../reference-data/rcs-severity-mapping.RCS-GOV-1.0.json');
const weightsSeed = require('../reference-data/rcs-axis-weights.RCS-GOV-1.0.json');
const thresholdsSeed = require('../reference-data/rcs-grade-thresholds.RCS-GOV-1.0.json');
const governanceSeed = require('../reference-data/rcs-governance-rules.RCS-GOV-1.0.json');
const matrixMappingSeed = require('../reference-data/rcs-matrix-mapping.RCS-GOV-1.0.json');

const MODEL_CODE = 'RCS-GOV-1.0';
const SPREC_VERSION = 'SPREC-2.0';

function recordsFromCatalog(seed) {
  return seed.catalog.map((item) => ({
    model_code: seed.model_code,
    sprec_version: seed.sprec_version,
    matrix_type: seed.matrix_type,
    ...item,
  }));
}

const referenceData = Object.freeze({
  model_code: MODEL_CODE,
  sprec_version: SPREC_VERSION,
  catalogs: Object.freeze({
    fluid: Object.freeze(recordsFromCatalog(fluidCatalogSeed)),
    solid: Object.freeze(recordsFromCatalog(solidCatalogSeed)),
  }),
  severityMappings: Object.freeze(severitySeed.mappings.map((item) => ({
    model_code: severitySeed.model_code,
    sprec_version: severitySeed.sprec_version,
    ...item,
  }))),
  weights: Object.freeze(weightsSeed.weights.map((item) => ({
    model_code: weightsSeed.model_code,
    sprec_version: weightsSeed.sprec_version,
    ...item,
  }))),
  thresholds: Object.freeze(thresholdsSeed.thresholds.map((item) => ({
    model_code: thresholdsSeed.model_code,
    sprec_version: thresholdsSeed.sprec_version,
    ...item,
  }))),
  governanceRules: Object.freeze(governanceSeed.rules.map((item) => ({
    model_code: governanceSeed.model_code,
    sprec_version: governanceSeed.sprec_version,
    ...item,
  }))),
  // RF018 AC4 (#1320): the versioned release that resolves a matrix the
  // payload does not state.
  matrixMapping: Object.freeze({
    ...matrixMappingSeed,
    rules: Object.freeze(matrixMappingSeed.rules.map((rule) => Object.freeze({
      ...rule,
      ...(Array.isArray(rule.contains_any) ? { contains_any: Object.freeze([...rule.contains_any]) } : {}),
      ...(Array.isArray(rule.fields_any) ? { fields_any: Object.freeze([...rule.fields_any]) } : {}),
    }))),
  }),
});

function buildRcsCatalogDocuments({ model_code = MODEL_CODE, sprec_version = SPREC_VERSION, matrix_type, catalog = [] } = {}) {
  return catalog.map((item) => ({
    model_code,
    sprec_version,
    matrix_type,
    ...item,
  }));
}

async function upsertCollection(collection, keys, docs) {
  const operations = (Array.isArray(docs) ? docs : []).map((doc) => ({
    updateOne: {
      filter: Object.fromEntries(keys.map((key) => [key, doc[key]])),
      update: { $setOnInsert: { ...doc } },
      upsert: true,
    },
  }));
  if (operations.length === 0) return { modifiedCount: 0, upsertedCount: 0 };
  return collection.bulkWrite(operations, { ordered: false });
}

module.exports = Object.assign({}, referenceData, {
  buildRcsCatalogDocuments,
  upsertCollection,
});
