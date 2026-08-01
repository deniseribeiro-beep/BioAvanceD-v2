const crypto = require('crypto');
const catalog = require('./catalog.1.3.0.json');

/**
 * RF022 follow-up (#381): the structured, versioned artifact
 * dict-08_MAIN_GAPS.md's Foundation Data Pipeline gate needs to make
 * "929 elementos verificados" a checkable fact instead of a documentation
 * claim. `catalog.1.3.0.json` is generated from dict-02_DICIONARIO.md by
 * `scripts/generate-dictionary-catalog.js` — regenerate it there, don't
 * hand-edit the JSON.
 */
const DICTIONARY_VERSION = '1.3.0';
const EXPECTED_TOTAL_ELEMENTS = 929;
const REQUIRED_FIELDS = ['entity', 'field', 'cardinality', 'phase'];

function loadCanonicalDictionary() {
  return catalog.map((element) => ({ ...element }));
}

function getElementById(elementId) {
  return catalog.find((element) => element.elementId === elementId) || null;
}

function dictionaryChecksum() {
  return crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
}

function checkCompleteness() {
  const ids = catalog.map((element) => element.elementId);
  const uniqueIds = new Set(ids);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const missingRequiredFieldIds = catalog
    .filter((element) => REQUIRED_FIELDS.some((field) => !element[field]))
    .map((element) => element.elementId);

  return {
    dictionaryVersion: DICTIONARY_VERSION,
    expectedTotal: EXPECTED_TOTAL_ELEMENTS,
    loadedTotal: catalog.length,
    uniqueTotal: uniqueIds.size,
    duplicateIds,
    missingRequiredFieldIds,
    verified: uniqueIds.size === EXPECTED_TOTAL_ELEMENTS
      && catalog.length === EXPECTED_TOTAL_ELEMENTS
      && duplicateIds.length === 0
      && missingRequiredFieldIds.length === 0,
  };
}

module.exports = {
  DICTIONARY_VERSION,
  EXPECTED_TOTAL_ELEMENTS,
  loadCanonicalDictionary,
  getElementById,
  dictionaryChecksum,
  checkCompleteness,
};
