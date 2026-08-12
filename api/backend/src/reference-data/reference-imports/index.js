const { runImport } = require('./pipeline');
const hpoSource = require('./sources/hpo');
const { normalizeRecord: normalizeHpoRecord } = require('./normalizeHpo');
const mondoSource = require('./sources/mondo');
const { normalizeRecord: normalizeMondoRecord } = require('./normalizeMondo');
const orphaSource = require('./sources/orpha');
const { normalizeRecord: normalizeOrphaRecord } = require('./normalizeOrpha');
const icd11Source = require('./sources/icd11');
const { normalizeRecord: normalizeIcd11Record } = require('./normalizeIcd11');

/** RF028 first importer — see sources/hpo.js for why HPO and why a bundled sample. */
async function runHpoImport(db, opts = {}) {
  return runImport({ db, source: hpoSource, normalizeRecord: normalizeHpoRecord, ...opts });
}

/** RF028 second importer — see sources/mondo.js for why MONDO and why a bundled sample. */
async function runMondoImport(db, opts = {}) {
  return runImport({ db, source: mondoSource, normalizeRecord: normalizeMondoRecord, ...opts });
}

/** RF028 third importer — see sources/orpha.js for why ORPHA and why a bundled sample. */
async function runOrphaImport(db, opts = {}) {
  return runImport({ db, source: orphaSource, normalizeRecord: normalizeOrphaRecord, ...opts });
}

/** RF028 fourth importer — see sources/icd11.js for why ICD-11 and why a bundled sample. */
async function runIcd11Import(db, opts = {}) {
  return runImport({ db, source: icd11Source, normalizeRecord: normalizeIcd11Record, ...opts });
}

module.exports = { runHpoImport, runMondoImport, runOrphaImport, runIcd11Import };
