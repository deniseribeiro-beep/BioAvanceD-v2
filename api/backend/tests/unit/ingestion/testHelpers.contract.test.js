import { describe, it, expect } from 'vitest';

const { createFakeCollection, createFakeDb } = require('./testHelpers');

// #694: this fake is shared by 15 test files. Its job is to be a real
// query-matching fake rather than a canned stub, which only works if its
// surface actually matches the driver it stands in for.
//
// It did not. `find()` was `async`, returning a Promise of a plain
// `{ toArray }` object with no `.sort()`. The real driver's `find()` is
// synchronous and returns a chainable Cursor. That difference is invisible
// to `await collection.find(f)` (awaiting a non-thenable is a passthrough,
// so both shapes work) and fatal to `collection.find(f).toArray()`, which is
// the form the rest of this codebase actually uses -- e.g.
// `await collection.find({ active: true }).sort({ name: 1 }).toArray()` in
// analysis-type.controller.js.
//
// A service author who wrote the natural chained form against this fake got
// `TypeError: collection.find(...).toArray is not a function`, and
// condition.service.js / phenotype-observation.service.js were rewritten to
// the awkward two-step form to accommodate it. These tests pin the shape so
// that cannot recur.
describe('ingestion testHelpers fake collection (#694)', () => {
  const SEED = [
    { _id: 'c', systemUri: 'http://hpo', code: 'HP:3', version: '3' },
    { _id: 'a', systemUri: 'http://hpo', code: 'HP:1', version: '1' },
    { _id: 'b', systemUri: 'http://hpo', code: 'HP:2', version: '2' },
    { _id: 'z', systemUri: 'http://other', code: 'X:1', version: '1' }
  ];

  describe('find() matches the real driver shape', () => {
    it('is synchronous -- it returns a cursor, not a Promise', () => {
      const collection = createFakeCollection(SEED);

      const cursor = collection.find({ systemUri: 'http://hpo' });

      expect(typeof cursor.then).not.toBe('function');
      expect(typeof cursor.toArray).toBe('function');
    });

    it('supports the chained form find(...).toArray()', async () => {
      const collection = createFakeCollection(SEED);

      const found = await collection.find({ systemUri: 'http://hpo' }).toArray();

      expect(found.map((doc) => doc._id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('supports .sort() on the cursor', async () => {
      const collection = createFakeCollection(SEED);

      const found = await collection.find({ systemUri: 'http://hpo' }).sort({ code: 1 }).toArray();

      expect(found.map((doc) => doc.code)).toEqual(['HP:1', 'HP:2', 'HP:3']);
    });

    it('sorts descending too', async () => {
      const collection = createFakeCollection(SEED);

      const found = await collection.find({ systemUri: 'http://hpo' }).sort({ code: -1 }).toArray();

      expect(found.map((doc) => doc.code)).toEqual(['HP:3', 'HP:2', 'HP:1']);
    });

    it('supports .limit() and .skip(), chained in any order after sort', async () => {
      const collection = createFakeCollection(SEED);

      const found = await collection.find({ systemUri: 'http://hpo' }).sort({ code: 1 }).skip(1).limit(1).toArray();

      expect(found.map((doc) => doc.code)).toEqual(['HP:2']);
    });

    it('still works under the old `await find()` form, so existing callers keep passing', async () => {
      // activeCodeValidator.js line 62 does exactly this. Awaiting a
      // synchronous return is a no-op passthrough against both the real
      // driver and this fake, so the tightening is backward-compatible.
      const collection = createFakeCollection(SEED);

      const cursor = await collection.find({ systemUri: 'http://hpo' });
      const found = await cursor.toArray();

      expect(found).toHaveLength(3);
    });

    it('honours the filter rather than returning everything', async () => {
      const collection = createFakeCollection(SEED);

      const found = await collection.find({ systemUri: 'http://other' }).toArray();

      expect(found.map((doc) => doc._id)).toEqual(['z']);
    });

    it('returns an empty array, not null, when nothing matches', async () => {
      const collection = createFakeCollection(SEED);

      const found = await collection.find({ systemUri: 'http://nothing' }).toArray();

      expect(found).toEqual([]);
    });

    it('reaches collections created on demand through createFakeDb', async () => {
      const db = createFakeDb({ terminologyConcepts: SEED });

      const seeded = await db.collection('terminologyConcepts').find({ code: 'HP:2' }).toArray();
      const empty = await db.collection('neverSeeded').find({}).toArray();

      expect(seeded).toHaveLength(1);
      expect(empty).toEqual([]);
    });
  });

  describe('findOne() is unchanged', () => {
    it('stays async and still honours sort', async () => {
      const collection = createFakeCollection(SEED);

      const first = await collection.findOne({ systemUri: 'http://hpo' }, { sort: { code: -1 } });

      expect(first.code).toBe('HP:3');
    });

    it('returns null when nothing matches', async () => {
      const collection = createFakeCollection(SEED);

      expect(await collection.findOne({ code: 'nope' })).toBeNull();
    });
  });
});
