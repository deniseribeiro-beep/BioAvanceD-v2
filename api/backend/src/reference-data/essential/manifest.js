const path = require('path');

const manifest = Object.freeze([
  Object.freeze({
    key: 'miabis-minimal',
    system: 'MIABIS',
    version: '3.0-minimal',
    source: path.join(__dirname, '..', 'miabis.min.json'),
    targetCollection: 'miabisReferenceData',
    targetCollections: ['sampleTypes', 'sampleOrigins', 'extractionProtocols', 'qualityDescriptions'],
    loader: 'loadMiabisMinimal',
    uniqueKeys: ['id'],
    required: true,
    description: 'Minimal deterministic MIABIS reference set for operational tests.',
  }),
  Object.freeze({
    key: 'sprec-minimal',
    system: 'SPREC',
    version: '2.0-minimal',
    source: path.join(__dirname, '..', 'sprec.min.json'),
    targetCollection: 'terminologies',
    loader: 'loadSprecMinimal',
    uniqueKeys: ['sistema', 'fonte', 'axis', 'code'],
    required: true,
    description: 'Minimal deterministic SPREC reference set for operational tests.',
  }),
  Object.freeze({
    key: 'rcs-gov-1.0',
    system: 'RCS-GOV',
    version: '1.0',
    source: path.join(__dirname, '..', '..', 'services', 'rcs-reference-data.js'),
    targetCollection: 'referenceSeedRuns',
    loader: 'loadRcsGovReferenceData',
    uniqueKeys: ['key', 'version'],
    required: true,
    description: 'Reference catalogs, mappings and governance rules for RCS-GOV.',
  }),
]);

function getManifest() {
  return manifest.map((entry) => ({ ...entry }));
}

function getManifestByKey(key) {
  return manifest.find((entry) => entry.key === key) || null;
}

module.exports = {
  getManifest,
  getManifestByKey,
};
