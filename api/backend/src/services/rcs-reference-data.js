const fluidCatalogSeed = require('../reference-data/rcs-sprec-fluid-catalog.RCS-GOV-1.0.json');
const solidCatalogSeed = require('../reference-data/rcs-sprec-solid-catalog.RCS-GOV-1.0.json');
const severitySeed = require('../reference-data/rcs-severity-mapping.RCS-GOV-1.0.json');
const weightsSeed = require('../reference-data/rcs-axis-weights.RCS-GOV-1.0.json');
const thresholdsSeed = require('../reference-data/rcs-grade-thresholds.RCS-GOV-1.0.json');
const governanceSeed = require('../reference-data/rcs-governance-rules.RCS-GOV-1.0.json');
const governanceEvidenceSeed = require('../reference-data/rcs-governance-evidence.RCS-GOV-1.0.json');

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
  scientific_reference: Object.freeze({
    package_version: '1.0.0',
    package_commit: '9e10182f00169fa836ccf33b8c68d9f66507569c',
    doi: '10.5281/zenodo.22776282',
    computational_reference: 'C11',
  }),
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
  governanceEvidenceCategories: Object.freeze(
    governanceEvidenceSeed.categories.map((item) => Object.freeze({ ...item }))
  ),
  governanceEvidenceStates: Object.freeze([...governanceEvidenceSeed.evidence_states]),
  governanceOutcomes: Object.freeze([...governanceEvidenceSeed.governance_outcomes]),
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
