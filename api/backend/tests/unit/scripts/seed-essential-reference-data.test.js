import { describe, it, expect } from 'vitest';
const { runSeed } = require('../../../scripts/seed-essential-reference-data');
const canonicalDictionary = require('../../../src/reference-data/canonical-dictionary/v2');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');

/**
 * RF022 follow-up (#381): before this landed, FoundationDataRun.dictionaryChecksum
 * hashed the 3-entry essential manifest as a stopgap (see this script's own
 * former top comment) instead of the actual canonical dictionary, now the
 * approved v2.0.0 release (RF022 AC1: 1644 elements, 929 historical).
 * These assertions are that stopgap being retired — the checksum recorded on
 * a run must match the canonical-dictionary catalog, and the run must carry
 * a real completeness verdict instead of just an entry count.
 *
 * Fake collection matches the exact-key filters `runSeed` issues (real
 * query-matching semantics, not a stub returning canned data) — same
 * native-only "real backend" proof bar the reference-imports pipeline test
 * (tests/unit/reference-imports/pipeline.test.js) already established.
 */
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

describe('seed-essential-reference-data runSeed', () => {
  it('records a FoundationDataRun whose dictionaryChecksum matches the canonical-dictionary catalog', async () => {
    const fakeDb = createFakeDb();

    await runSeed({ db: fakeDb, args: { dryRun: false, list: false, only: null }, environment: 'test', deploymentId: 'test-host' });

    const runDoc = fakeDb.collections[CANONICAL_COLLECTIONS.foundationDataRuns].docs[0];
    expect(runDoc.runStatus).toBe('completed');
    expect(runDoc.dictionaryVersion).toBe('2.0.0');
    expect(runDoc.schemaVersion).toBe('2.0.0');
    expect(runDoc.dictionaryChecksum).toBe(canonicalDictionary.dictionaryChecksum());
  });

  it('carries a verified dictionary completeness gate in validationSummary', async () => {
    const fakeDb = createFakeDb();

    await runSeed({ db: fakeDb, args: { dryRun: false, list: false, only: null }, environment: 'test', deploymentId: 'test-host' });

    const runDoc = fakeDb.collections[CANONICAL_COLLECTIONS.foundationDataRuns].docs[0];
    expect(runDoc.validationSummary.dictionaryCompleteness).toMatchObject({
      dictionaryVersion: '2.0.0',
      expectedTotal: 1644,
      loadedTotal: 1644,
      historicalTotal: 929,
      missingHistoricalIds: [],
      verified: true,
    });
  });
});
