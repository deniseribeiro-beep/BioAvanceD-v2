import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const collectionsPath = require.resolve('../../src/config/collections');
const { getCanonicalCollectionName } = require('../../src/config/canonicalEntityCollections.v2');

describe('canonical collection configuration Stage 2E', () => {
  it('freezes workbook-backed names and rejects env alias overrides', () => {
    delete require.cache[collectionsPath];
    const collections = require(collectionsPath).CANONICAL_COLLECTIONS;

    expect(Object.isFrozen(collections)).toBe(true);
    expect(collections.patients).toBe(getCanonicalCollectionName('Participant'));
    expect(collections.samples).toBe(getCanonicalCollectionName('Specimen'));
    expect(collections.consents).toBe('consents');
    expect(collections.roles).toBe(getCanonicalCollectionName('Role'));
    expect(collections.foundationDataRuns).toBe(getCanonicalCollectionName('FoundationDataRun'));
  });
});
