const { runImport } = require('./pipeline');
const hpoSource = require('./sources/hpo');
const { normalizeRecord: normalizeHpoRecord } = require('./normalizeHpo');

/** RF028 first importer — see sources/hpo.js for why HPO and why a bundled sample. */
async function runHpoImport(db, opts = {}) {
  return runImport({ db, source: hpoSource, normalizeRecord: normalizeHpoRecord, ...opts });
}

module.exports = { runHpoImport };
