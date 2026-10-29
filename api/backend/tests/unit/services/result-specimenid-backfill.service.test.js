import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { backfillResultSpecimenIds } = require('../../../src/services/result-specimenid-backfill.service');
const { ObjectId } = require('mongodb');

/**
 * Real query-matching fake (findOne exact-match, insertOne/updateOne),
 * per this repo's native-only "real backend" proof bar. Mirrors
 * sealed-snapshot-backfill.service.test.js's fake shape. Compares by
 * String() rather than strict equality so an ObjectId filter value
 * (backfillResultSpecimenIds' _id-tier lookup) matches a doc whose own
 * `_id` is either a real ObjectId or a plain string with the same value
 * -- a real MongoDB driver treats those as equal.
 */
function createFakeCollection() {
  const docs = [];
  const matches = (doc, filter) => Object.keys(filter).every((key) => String(doc[key]) === String(filter[key]));
  return {
    docs,
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    find(filter = {}) {
      const current = docs.filter((doc) => matches(doc, filter));
      return { toArray: async () => current };
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$unset) {
        for (const key of Object.keys(update.$unset)) delete doc[key];
      }
      return { matchedCount: 1 };
    },
  };
}

function createFakeDb(seed = {}) {
  const collections = { results: createFakeCollection(), samples: createFakeCollection() };
  for (const [key, docs] of Object.entries(seed)) {
    for (const doc of docs) collections[key].docs.push(doc);
  }
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

describe('result-specimenid-backfill.service', () => {
  it('resolves via the Sample _id shape (POST /upload\'s pre-#628 write path) and sets specimenId, removing the legacy field', async () => {
    const sampleOid = new ObjectId().toString();
    const db = createFakeDb({
      samples: [{ _id: sampleOid, specimenId: 'SPEC-1' }],
      results: [{ _id: 'result-1', sampleID: sampleOid }],
    });

    const { summary } = await backfillResultSpecimenIds(db);

    expect(summary).toEqual({ resultsProcessed: 1, migrated: 1, alreadyMigrated: 0, unresolved: 0 });
    const result = db.collections.results.docs[0];
    expect(result.specimenId).toBe('SPEC-1');
    expect(result).not.toHaveProperty('sampleID');
  });

  it('resolves via a Sample.specimenId shape (a caller-supplied specimenId, pre-#628 POST / write path)', async () => {
    const db = createFakeDb({
      samples: [{ _id: 'sample-1', specimenId: 'SPEC-2' }],
      results: [{ _id: 'result-1', sampleID: 'SPEC-2' }],
    });

    const { summary } = await backfillResultSpecimenIds(db);

    expect(summary.migrated).toBe(1);
    expect(db.collections.results.docs[0].specimenId).toBe('SPEC-2');
  });

  // Nothing writes a numeric sampleID to the samples collection, so a Result
  // holding one is left for manual follow-up rather than looked up on it.
  it('leaves a Result holding a legacy numeric Sample.sampleID unresolved', async () => {
    const db = createFakeDb({
      samples: [{ _id: 'sample-1', specimenId: 'SPEC-3', sampleID: 42 }],
      results: [{ _id: 'result-1', sampleID: 42 }],
    });

    const { summary } = await backfillResultSpecimenIds(db);

    expect(summary.migrated).toBe(0);
    expect(summary.unresolved).toBe(1);
    expect(db.collections.results.docs[0].specimenId).toBeUndefined();
  });

  it('also checks the sampleId (lowercase d) spelling', async () => {
    const db = createFakeDb({
      samples: [{ _id: 'sample-1', specimenId: 'SPEC-4' }],
      results: [{ _id: 'result-1', sampleId: 'SPEC-4' }],
    });

    const { summary } = await backfillResultSpecimenIds(db);

    expect(summary.migrated).toBe(1);
    expect(db.collections.results.docs[0].specimenId).toBe('SPEC-4');
  });

  it('is a no-op for a Result that already carries the specimenId own-property, even if the value is null', async () => {
    const db = createFakeDb({
      results: [{ _id: 'result-1', specimenId: null, sampleID: 'sample-1' }],
    });

    const { summary } = await backfillResultSpecimenIds(db);

    expect(summary).toEqual({ resultsProcessed: 1, migrated: 0, alreadyMigrated: 1, unresolved: 0 });
    expect(db.collections.results.docs[0].specimenId).toBeNull();
    expect(db.collections.results.docs[0].sampleID).toBe('sample-1');
  });

  it('counts as unresolved (leaves untouched) when the legacy identifier has no matching sample', async () => {
    const db = createFakeDb({
      results: [{ _id: 'result-1', sampleID: 'ghost-sample' }],
    });

    const { summary } = await backfillResultSpecimenIds(db);

    expect(summary).toEqual({ resultsProcessed: 1, migrated: 0, alreadyMigrated: 0, unresolved: 1 });
    const result = db.collections.results.docs[0];
    expect(result).not.toHaveProperty('specimenId');
    expect(result.sampleID).toBe('ghost-sample');
  });

  it('counts as unresolved when the matched sample itself has no specimenId', async () => {
    const sampleOid = new ObjectId().toString();
    const db = createFakeDb({
      samples: [{ _id: sampleOid }],
      results: [{ _id: 'result-1', sampleID: sampleOid }],
    });

    const { summary } = await backfillResultSpecimenIds(db);

    expect(summary.unresolved).toBe(1);
    expect(db.collections.results.docs[0]).not.toHaveProperty('specimenId');
  });

  it('counts as unresolved when neither legacy field is present at all', async () => {
    const db = createFakeDb({
      results: [{ _id: 'result-1', fileType: 'PDF' }],
    });

    const { summary } = await backfillResultSpecimenIds(db);

    expect(summary).toEqual({ resultsProcessed: 1, migrated: 0, alreadyMigrated: 0, unresolved: 1 });
  });

  it('is idempotent -- running twice does not re-process already-migrated documents', async () => {
    const db = createFakeDb({
      samples: [{ _id: 'sample-1', specimenId: 'SPEC-1' }],
      results: [{ _id: 'result-1', sampleID: 'SPEC-1' }],
    });

    const first = await backfillResultSpecimenIds(db);
    const second = await backfillResultSpecimenIds(db);

    expect(first.summary.migrated).toBe(1);
    expect(second.summary).toEqual({ resultsProcessed: 1, migrated: 0, alreadyMigrated: 1, unresolved: 0 });
  });

  it('processes a mixed batch, tallying each outcome independently', async () => {
    const db = createFakeDb({
      samples: [{ _id: 'sample-1', specimenId: 'SPEC-1' }],
      results: [
        { _id: 'result-1', sampleID: 'SPEC-1' },
        { _id: 'result-2', specimenId: 'SPEC-ALREADY' },
        { _id: 'result-3', sampleID: 'ghost' },
      ],
    });

    const { summary } = await backfillResultSpecimenIds(db);

    expect(summary).toEqual({ resultsProcessed: 3, migrated: 1, alreadyMigrated: 1, unresolved: 1 });
  });
});
