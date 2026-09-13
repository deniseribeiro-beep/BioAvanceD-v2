const fs = require('fs');
const crypto = require('crypto');
const canonicalDictionary = require('../src/reference-data/canonical-dictionary');
const { parseDictionary, SOURCE_MD } = require('./generate-dictionary-catalog');

/**
 * RF022 follow-up (#381): dict-08_MAIN_GAPS.md's Foundation Data Pipeline
 * gate is "929 elementos verificados" — this makes that gate a real CI
 * check instead of only a library function, mirroring
 * `validate-essential-reference-data.js`'s CI-gate pattern
 * (`current-state:ci` runs both).
 */
function fail(messages) {
  for (const message of messages) console.error(message);
  process.exit(1);
}

function main() {
  const completeness = canonicalDictionary.checkCompleteness();
  const messages = [];

  if (completeness.loadedTotal !== completeness.expectedTotal) {
    messages.push(`Canonical dictionary catalog has ${completeness.loadedTotal} elements, expected ${completeness.expectedTotal}.`);
  }
  if (completeness.duplicateIds.length) {
    messages.push(`Duplicate element IDs in canonical dictionary catalog: ${completeness.duplicateIds.join(', ')}`);
  }
  if (completeness.missingRequiredFieldIds.length) {
    messages.push(`Elements missing entity/field/cardinality/phase: ${completeness.missingRequiredFieldIds.join(', ')}`);
  }

  // The checksum above is computed from the checked-in catalog.1.3.0.json —
  // it can't, by itself, tell you that JSON is stale relative to
  // dict-02_DICIONARIO.md. Re-parse the source directly and compare so an
  // edited dictionary with a forgotten regeneration fails here.
  const freshCatalog = parseDictionary(fs.readFileSync(SOURCE_MD, 'utf8'));
  const freshChecksum = crypto.createHash('sha256').update(JSON.stringify(freshCatalog)).digest('hex');
  if (freshChecksum !== canonicalDictionary.dictionaryChecksum()) {
    messages.push('catalog.1.3.0.json is stale relative to dict-02_DICIONARIO.md — run `npm run dictionary:generate`.');
  }

  if (messages.length) fail(messages);
  console.log(`Canonical dictionary catalog validation passed: ${completeness.loadedTotal}/${completeness.expectedTotal} elements verified (v${completeness.dictionaryVersion}).`);
}

main();
