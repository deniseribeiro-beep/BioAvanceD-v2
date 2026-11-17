const crypto = require('crypto');
const catalog = require('./catalog.2.0.0.json');
const historicalCatalog = require('./catalog.1.3.0.json');

/**
 * RF022 AC1 (Requisitos v4.0.0): Foundation reads and validates the approved
 * Canonical Data Model v2.0.0, "1644 elementos, incluindo os 929 históricos".
 * `catalog.2.0.0.json` is generated from docs/extracted-v2.0.0/dict-DICIONARIO.md
 * by `scripts/generate-dictionary-catalog.js` — regenerate it there, don't
 * hand-edit the JSON.
 *
 * Same API as `./index.js` (the v1.3.0 catalog, which its consumers still
 * load). Completeness adds the historical check: every v1.3.0 element id
 * must still exist in v2.0.0, whatever its changeStatus (a deprecated or
 * replaced element keeps its row).
 */
const DICTIONARY_VERSION = '2.0.0';
const EXPECTED_TOTAL_ELEMENTS = 1644;
const EXPECTED_HISTORICAL_ELEMENTS = 929;
// RNF031 AC1, plano F1.3: the 1644 elements fall in 146 entities/artefacts.
const EXPECTED_ENTITY_TOTAL = 146;
const REQUIRED_FIELDS = ['entity', 'field', 'cardinality', 'preparationPhase', 'changeStatus'];
const CHANGE_STATUSES = ['maintained', 'altered', 'renamed', 'replaced', 'deprecated', 'added'];

function loadCanonicalDictionary() {
  return catalog.map((element) => ({ ...element }));
}

function getElementById(elementId) {
  return catalog.find((element) => element.elementId === elementId) || null;
}

function dictionaryChecksum() {
  return crypto.createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
}

function checkCompleteness(elements = catalog, historical = historicalCatalog) {
  const ids = elements.map((element) => element.elementId);
  const uniqueIds = new Set(ids);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const missingRequiredFieldIds = elements
    .filter((element) => REQUIRED_FIELDS.some((field) => !element[field]))
    .map((element) => element.elementId);
  const unknownChangeStatusIds = elements
    .filter((element) => element.changeStatus && !CHANGE_STATUSES.includes(element.changeStatus))
    .map((element) => element.elementId);
  const missingHistoricalIds = historical
    .map((element) => element.elementId)
    .filter((id) => !uniqueIds.has(id));
  // RNF023 C3: a historical id keeps its meaning, the same entity and the same
  // field unless its row is marked renamed; one absent is in missingHistoricalIds.
  const byId = new Map(elements.map((element) => [element.elementId, element]));
  const reassignedHistoricalIds = historical
    .filter((old) => {
      const current = byId.get(old.elementId);
      return Boolean(current)
        && (current.entity !== old.entity
          || (current.field !== old.field && current.changeStatus !== 'renamed'));
    })
    .map((old) => old.elementId);
  const entityTotal = new Set(elements.map((element) => element.entity).filter(Boolean)).size;

  return {
    dictionaryVersion: DICTIONARY_VERSION,
    expectedTotal: EXPECTED_TOTAL_ELEMENTS,
    loadedTotal: elements.length,
    uniqueTotal: uniqueIds.size,
    expectedHistoricalTotal: EXPECTED_HISTORICAL_ELEMENTS,
    historicalTotal: historical.length,
    expectedEntityTotal: EXPECTED_ENTITY_TOTAL,
    entityTotal,
    duplicateIds,
    missingRequiredFieldIds,
    unknownChangeStatusIds,
    missingHistoricalIds,
    reassignedHistoricalIds,
    verified: uniqueIds.size === EXPECTED_TOTAL_ELEMENTS
      && elements.length === EXPECTED_TOTAL_ELEMENTS
      && historical.length === EXPECTED_HISTORICAL_ELEMENTS
      && duplicateIds.length === 0
      && missingRequiredFieldIds.length === 0
      && unknownChangeStatusIds.length === 0
      && missingHistoricalIds.length === 0
      && reassignedHistoricalIds.length === 0
      && entityTotal === EXPECTED_ENTITY_TOTAL,
  };
}

module.exports = {
  DICTIONARY_VERSION,
  EXPECTED_TOTAL_ELEMENTS,
  EXPECTED_HISTORICAL_ELEMENTS,
  EXPECTED_ENTITY_TOTAL,
  CHANGE_STATUSES,
  loadCanonicalDictionary,
  getElementById,
  dictionaryChecksum,
  checkCompleteness,
};
