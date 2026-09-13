import { describe, it, expect } from 'vitest';
const fs = require('fs');
const { parseDictionary, SOURCE_MD } = require('../../../scripts/generate-dictionary-catalog');
const canonicalDictionary = require('../../../src/reference-data/canonical-dictionary');

/**
 * RF022 follow-up (#381): the issue asked for the dictionary's checksum to
 * make drift between the checked-in catalog artifact and
 * dict-02_DICIONARIO.md detectable — not just drift between two runs of the
 * artifact itself. A checksum computed only from the committed JSON can't
 * tell you the JSON is stale relative to its source; this re-parses the
 * source directly and compares, so an edit to dict-02_DICIONARIO.md that
 * nobody regenerated the catalog for fails here instead of silently no-op'ing.
 */
describe('generate-dictionary-catalog source-vs-artifact drift', () => {
  it('produces a catalog whose checksum matches the checked-in canonical-dictionary artifact', () => {
    const freshCatalog = parseDictionary(fs.readFileSync(SOURCE_MD, 'utf8'));
    const freshChecksum = require('crypto').createHash('sha256').update(JSON.stringify(freshCatalog)).digest('hex');

    expect(freshChecksum).toBe(canonicalDictionary.dictionaryChecksum());
  });
});
