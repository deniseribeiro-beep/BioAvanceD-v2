const fluidCatalogSeed = require('../seeders/data/rcs-sprec-fluid-catalog.RCS-GOV-1.0.json');
const solidCatalogSeed = require('../seeders/data/rcs-sprec-solid-catalog.RCS-GOV-1.0.json');
const severitySeed = require('../seeders/data/rcs-severity-mapping.RCS-GOV-1.0.json');
const weightsSeed = require('../seeders/data/rcs-axis-weights.RCS-GOV-1.0.json');
const thresholdsSeed = require('../seeders/data/rcs-grade-thresholds.RCS-GOV-1.0.json');
const governanceSeed = require('../seeders/data/rcs-governance-rules.RCS-GOV-1.0.json');

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
});

module.exports = referenceData;
