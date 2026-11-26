const fs = require('fs');
const crypto = require('crypto');
const canonicalDictionary = require('../src/reference-data/canonical-dictionary');
const canonicalDictionaryV2 = require('../src/reference-data/canonical-dictionary/v2');
const {
  parseDictionary, SOURCE_MD, parseDictionaryV2, SOURCE_MD_V2,
  readReleaseManifest, SOURCE_RELEASE_MANIFEST, OUTPUT_RELEASE_MANIFEST,
} = require('./generate-dictionary-catalog');

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

  // RF022 AC1: the approved v2.0.0 catalog, 1644 elements including the 929
  // historical ones, under the same completeness and staleness checks.
  const v2 = canonicalDictionaryV2.checkCompleteness();
  if (!v2.verified) {
    messages.push(
      `Canonical dictionary v${v2.dictionaryVersion} failed completeness: `
        + `${v2.loadedTotal}/${v2.expectedTotal} elements, ${v2.uniqueTotal} unique, `
        + `duplicates [${v2.duplicateIds.join(', ')}], `
        + `missing entity/field/cardinality/preparationPhase/changeStatus [${v2.missingRequiredFieldIds.join(', ')}], `
        + `unknown changeStatus [${v2.unknownChangeStatusIds.join(', ')}], `
        + `historical ids absent [${v2.missingHistoricalIds.join(', ')}], `
        + `historical ids given a new meaning [${v2.reassignedHistoricalIds.join(', ')}].`
    );
  }
  const freshV2 = parseDictionaryV2(fs.readFileSync(SOURCE_MD_V2, 'utf8'));
  const freshV2Checksum = crypto.createHash('sha256').update(JSON.stringify(freshV2)).digest('hex');
  if (freshV2Checksum !== canonicalDictionaryV2.dictionaryChecksum()) {
    messages.push('catalog.2.0.0.json is stale relative to docs/extracted-v2.0.0/dict-DICIONARIO.md — run `npm run dictionary:generate`.');
  }

  // #1304: the release manifest the CanonicalModelRelease is built from.
  const freshManifest = readReleaseManifest(fs.readFileSync(SOURCE_RELEASE_MANIFEST, 'utf8'));
  const carriedManifest = readReleaseManifest(fs.readFileSync(OUTPUT_RELEASE_MANIFEST, 'utf8'));
  if (JSON.stringify(freshManifest) !== JSON.stringify(carriedManifest)) {
    messages.push('release-manifest.2.0.0.json is stale relative to docs/RELEASE_MANIFEST.json — run `npm run dictionary:generate`.');
  }

  if (messages.length) fail(messages);
  console.log(`Canonical dictionary catalog validation passed: ${completeness.loadedTotal}/${completeness.expectedTotal} elements verified (v${completeness.dictionaryVersion}).`);
  console.log(`Canonical dictionary catalog validation passed: ${v2.loadedTotal}/${v2.expectedTotal} elements verified, ${v2.historicalTotal} historical present (v${v2.dictionaryVersion}).`);
}

main();
