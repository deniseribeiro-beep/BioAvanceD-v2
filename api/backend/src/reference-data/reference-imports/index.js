const { runImport } = require('./pipeline');
const hpoSource = require('./sources/hpo');
const { normalizeRecord: normalizeHpoRecord } = require('./normalizeHpo');
const mondoSource = require('./sources/mondo');
const { normalizeRecord: normalizeMondoRecord } = require('./normalizeMondo');
const orphaSource = require('./sources/orpha');
const { normalizeRecord: normalizeOrphaRecord } = require('./normalizeOrpha');
const icd11Source = require('./sources/icd11');
const { normalizeRecord: normalizeIcd11Record } = require('./normalizeIcd11');
const icd10Source = require('./sources/icd10');
const { normalizeRecord: normalizeIcd10Record } = require('./normalizeIcd10');
const omimSource = require('./sources/omim');
const { normalizeRecord: normalizeOmimRecord } = require('./normalizeOmim');
const hgncSource = require('./sources/hgnc');
const { normalizeRecord: normalizeHgncRecord } = require('./normalizeHgnc');
const loincSource = require('./sources/loinc');
const { normalizeRecord: normalizeLoincRecord } = require('./normalizeLoinc');
const ucumSource = require('./sources/ucum');
const { normalizeRecord: normalizeUcumRecord } = require('./normalizeUcum');
const dcbSource = require('./sources/dcb');
const { normalizeRecord: normalizeDcbRecord } = require('./normalizeDcb');
const atcSource = require('./sources/atc');
const { normalizeRecord: normalizeAtcRecord } = require('./normalizeAtc');
const duoSource = require('./sources/duo');
const { normalizeRecord: normalizeDuoRecord } = require('./normalizeDuo');
const uberonSource = require('./sources/uberon');
const { normalizeRecord: normalizeUberonRecord } = require('./normalizeUberon');
const ncbitaxSource = require('./sources/ncbitax');
const { normalizeRecord: normalizeNcbitaxRecord } = require('./normalizeNcbitax');
const clSource = require('./sources/cl');
const { normalizeRecord: normalizeClRecord } = require('./normalizeCl');

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

/** RF028 fifth importer — see sources/icd10.js for why ICD-10 and why a bundled sample. */
async function runIcd10Import(db, opts = {}) {
  return runImport({ db, source: icd10Source, normalizeRecord: normalizeIcd10Record, ...opts });
}

/** RF028 sixth importer — see sources/omim.js for why OMIM and why a bundled sample. */
async function runOmimImport(db, opts = {}) {
  return runImport({ db, source: omimSource, normalizeRecord: normalizeOmimRecord, ...opts });
}

/** RF028 seventh importer — see sources/hgnc.js for why HGNC and why a bundled sample. */
async function runHgncImport(db, opts = {}) {
  return runImport({ db, source: hgncSource, normalizeRecord: normalizeHgncRecord, ...opts });
}

/** RF028 eighth importer — see sources/loinc.js for why LOINC and why a bundled sample. */
async function runLoincImport(db, opts = {}) {
  return runImport({ db, source: loincSource, normalizeRecord: normalizeLoincRecord, ...opts });
}

/** RF028 ninth importer — see sources/ucum.js for why UCUM and why a bundled sample. */
async function runUcumImport(db, opts = {}) {
  return runImport({ db, source: ucumSource, normalizeRecord: normalizeUcumRecord, ...opts });
}

/** RF028 tenth importer — see sources/dcb.js for why DCB and why a bundled sample. */
async function runDcbImport(db, opts = {}) {
  return runImport({ db, source: dcbSource, normalizeRecord: normalizeDcbRecord, ...opts });
}

/** RF028 eleventh importer — see sources/atc.js for why ATC and why a bundled sample. */
async function runAtcImport(db, opts = {}) {
  return runImport({ db, source: atcSource, normalizeRecord: normalizeAtcRecord, ...opts });
}

/** RF028 twelfth importer — see sources/duo.js for why DUO and why a bundled sample. */
async function runDuoImport(db, opts = {}) {
  return runImport({ db, source: duoSource, normalizeRecord: normalizeDuoRecord, ...opts });
}

/** RF028 thirteenth importer — see sources/uberon.js for why Uberon and why a bundled sample. */
async function runUberonImport(db, opts = {}) {
  return runImport({ db, source: uberonSource, normalizeRecord: normalizeUberonRecord, ...opts });
}

/** RF028 fourteenth importer — see sources/ncbitax.js for why NCBI Taxonomy and why a bundled sample. */
async function runNcbitaxImport(db, opts = {}) {
  return runImport({ db, source: ncbitaxSource, normalizeRecord: normalizeNcbitaxRecord, ...opts });
}

/** RF028 fifteenth importer — see sources/cl.js for why Cell Ontology and why a bundled sample. */
async function runClImport(db, opts = {}) {
  return runImport({ db, source: clSource, normalizeRecord: normalizeClRecord, ...opts });
}

module.exports = { runHpoImport, runMondoImport, runOrphaImport, runIcd11Import, runIcd10Import, runOmimImport, runHgncImport, runLoincImport, runUcumImport, runDcbImport, runAtcImport, runDuoImport, runUberonImport, runNcbitaxImport, runClImport };
