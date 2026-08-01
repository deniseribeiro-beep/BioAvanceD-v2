const canonicalDictionary = require('../src/reference-data/canonical-dictionary');

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

  if (messages.length) fail(messages);
  console.log(`Canonical dictionary catalog validation passed: ${completeness.loadedTotal}/${completeness.expectedTotal} elements verified (v${completeness.dictionaryVersion}).`);
}

main();
