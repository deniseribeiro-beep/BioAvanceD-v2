import { describe, it, expect } from 'vitest';
const { runSeed } = require('../../../scripts/seed-essential-reference-data');
const canonicalDictionary = require('../../../src/reference-data/canonical-dictionary');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');

function createFakeCollection() {
  const docs = [];
  const matches = (doc, filter) => Object.keys(filter).every((key) => doc[key] === filter[key]);
  return {
    docs,
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (doc) {
        if (update.$setOnInsert) Object.assign(doc, update.$setOnInsert);
        return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
      }
      docs.push({ ...(update.$setOnInsert || {}) });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    },
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id || 'fake-id' };
    },
    find(filter = {}) {
      const sorted = docs.filter((doc) => matches(doc, filter));
      return {
        sort: () => ({
          limit: () => ({
            next: async () => sorted[sorted.length - 1] || null,
          }),
        }),
      };
    },
  };
}

function createFakeDb() {
  const collections = {};
  return {
    collections,
    collection(name) {
      if (!collections[name]) collections[name] = createFakeCollection();
      return collections[name];
    },
  };
}

describe('seed-essential-reference-data canonical v2 gate', () => {
  it('records a FoundationDataRun pinned to the approved v2 dictionary checksum', async () => {
    const fakeDb = createFakeDb();

    await runSeed({ db: fakeDb, args: { dryRun: false, list: false, only: null }, environment: 'test', deploymentId: 'test-host' });

    const runDoc = fakeDb.collections[CANONICAL_COLLECTIONS.foundationDataRuns].docs[0];
    expect(runDoc.runStatus).toBe('completed');
    expect(runDoc.dictionaryVersion).toBe('2.0.0');
    expect(runDoc.dictionaryVersion).toBe(canonicalDictionary.DICTIONARY_VERSION);
    expect(runDoc.dictionaryChecksum).toBe(await canonicalDictionary.dictionaryChecksum());
  });

  it('carries the complete 1,644-element reconciliation gate in validationSummary', async () => {
    const fakeDb = createFakeDb();

    await runSeed({ db: fakeDb, args: { dryRun: false, list: false, only: null }, environment: 'test', deploymentId: 'test-host' });

    const runDoc = fakeDb.collections[CANONICAL_COLLECTIONS.foundationDataRuns].docs[0];
    expect(runDoc.validationSummary.dictionaryCompleteness).toMatchObject({
      expectedTotal: 1644,
      loadedTotal: 1644,
      historicalTotal: 929,
      newTotal: 715,
      entityTotal: 146,
      verified: true,
    });
  });
});
