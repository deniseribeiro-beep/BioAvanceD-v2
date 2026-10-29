const path = require('path');

// RF028 AC1: each entry also carries the fields its ReferenceDatasetRelease
// is registered with before the load (#1319), as the import sources under
// reference-imports/sources/ do:
//
// - sourceId and systemUri are the Source ID and File/URL columns of the
//   v2.0.0 matriz-FONTES.md rows SRC-MIABIS, SRC-SPREC2 and SRC-RCS.
// - license is copied literally from the "Licença/termos" column of the
//   v1.3.0 dict-01_FONTES.md rows SRC_MIABIS3, SRC_SPREC2 and SRC_RCS.
//   INFERENCE, not a citation: v2.0.0's FONTES has no license column, so
//   the v1.3.0 one is read, as the 16 import sources did. No row gives a
//   license URL, so licenseUri stays null.
// - INFERENCE, not a citation: accessMethod 'manual_upload' and
//   parserVersion/mappingVersion '1.0.0' are read off the 16 import
//   sources, every one of which bundles its data with 'manual_upload' and
//   starts at '1.0.0'. The essential set ships in this repository too.
// - INFERENCE, not a citation: sourceFormat follows those sources' rule,
//   the first formats of the dict-01 "Formatos/Interface" column
//   ("Markdown/Git", "HTML/PDF/tabelas", "JSON/regras/tabelas"). The bundled
//   files themselves are JSON (MIABIS, SPREC) and a JS module (RCS-GOV),
//   as ucum.js says of its JSONL fixture.
// - retrievalUri is the bundled file, as the import sources' fixturePath.

const miabisSource = path.join(__dirname, '..', 'miabis.min.json');
const sprecSource = path.join(__dirname, '..', 'sprec.min.json');
const rcsSource = path.join(__dirname, '..', '..', 'services', 'rcs-reference-data.js');

const retrievalUriOf = (source) => `file://${source.replace(/\\/g, '/')}`;

const manifest = Object.freeze([
  Object.freeze({
    key: 'miabis-minimal',
    system: 'MIABIS',
    version: '3.0-minimal',
    source: miabisSource,
    targetCollection: 'miabisReferenceData',
    targetCollections: ['sampleTypes', 'sampleOrigins', 'extractionProtocols', 'qualityDescriptions'],
    loader: 'loadMiabisMinimal',
    uniqueKeys: ['id'],
    required: true,
    description: 'Minimal deterministic MIABIS reference set for operational tests.',
    sourceId: 'SRC-MIABIS',
    datasetName: 'MIABIS minimal reference set',
    systemUri: 'https://github.com/BBMRI-ERIC/miabis',
    retrievalUri: retrievalUriOf(miabisSource),
    license: 'Conferir licença do repositório',
    licenseUri: null,
    accessMethod: 'manual_upload',
    // dict-01 SRC_MIABIS3: "Markdown/Git".
    sourceFormat: Object.freeze(['Markdown']),
    parserVersion: '1.0.0',
    mappingVersion: '1.0.0',
  }),
  Object.freeze({
    key: 'sprec-minimal',
    system: 'SPREC',
    version: '2.0-minimal',
    source: sprecSource,
    targetCollection: 'terminologies',
    loader: 'loadSprecMinimal',
    uniqueKeys: ['sistema', 'fonte', 'axis', 'code'],
    required: true,
    description: 'Minimal deterministic SPREC reference set for operational tests.',
    sourceId: 'SRC-SPREC2',
    datasetName: 'SPREC minimal reference set',
    systemUri: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6463986/',
    retrievalUri: retrievalUriOf(sprecSource),
    license: 'Artigo aberto; reprodução de tabelas deve ser confirmada',
    licenseUri: null,
    accessMethod: 'manual_upload',
    // dict-01 SRC_SPREC2: "HTML/PDF/tabelas".
    sourceFormat: Object.freeze(['HTML', 'PDF']),
    parserVersion: '1.0.0',
    mappingVersion: '1.0.0',
  }),
  Object.freeze({
    key: 'rcs-gov-1.0',
    system: 'RCS-GOV',
    version: '1.0',
    source: rcsSource,
    targetCollection: 'referenceSeedRuns',
    loader: 'loadRcsGovReferenceData',
    uniqueKeys: ['key', 'version'],
    required: true,
    description: 'Reference catalogs, mappings and governance rules for RCS-GOV.',
    sourceId: 'SRC-RCS',
    datasetName: 'RCS-GOV reference package',
    // INFERENCE, not a citation: SRC-RCS is an internal artefact with no
    // URL, so its system is named in the urn:bioavanced: namespace that
    // models/ReadinessReport.js and models/RcsInputSnapshot.js use.
    systemUri: 'urn:bioavanced:rcs-gov',
    retrievalUri: retrievalUriOf(rcsSource),
    license: 'Propriedade intelectual do projeto',
    licenseUri: null,
    accessMethod: 'manual_upload',
    // dict-01 SRC_RCS: "JSON/regras/tabelas".
    sourceFormat: Object.freeze(['JSON']),
    parserVersion: '1.0.0',
    mappingVersion: '1.0.0',
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
