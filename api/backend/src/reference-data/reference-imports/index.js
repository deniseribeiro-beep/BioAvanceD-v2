const { runImport } = require('./pipeline');
const hpoSource = require('./sources/hpo');
const { normalizeRecord: normalizeHpoRecord } = require('./normalizeHpo');
const mondoSource = require('./sources/mondo');
const { normalizeRecord: normalizeMondoRecord } = require('./normalizeMondo');

/** RF028 first importer — see sources/hpo.js for why HPO and why a bundled sample. */
async function runHpoImport(db, opts = {}) {
  return runImport({ db, source: hpoSource, normalizeRecord: normalizeHpoRecord, ...opts });
}

/** RF028 second importer — see sources/mondo.js for why MONDO and why a bundled sample. */
async function runMondoImport(db, opts = {}) {
  return runImport({ db, source: mondoSource, normalizeRecord: normalizeMondoRecord, ...opts });
}

module.exports = { runHpoImport, runMondoImport };
