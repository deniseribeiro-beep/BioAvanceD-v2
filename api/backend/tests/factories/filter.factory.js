/**
 * #797: a mock MongoDB collection whose `findOne`/`find` actually apply the
 * filter they are handed, instead of the `findOne: vi.fn().mockResolvedValue(doc)`
 * stub that 520 call sites across 56 test files use today. That stub returns
 * the same document for every filter, so an assertion downstream can only
 * prove "the handler did something with what findOne returned" -- never "the
 * handler asked the right question".
 *
 * That blindness is what hid #788: `GET /api/samples` looked up each sample's
 * patient with `{ $or: [{ patientID: sample.patientID }, { _id: sample.patientID }] }`,
 * a field no writer sets on either side. Live, the query degenerated to
 * `{ patientID: null }`, matched every patient document, and badged every
 * sample in the biobank from one arbitrary patient's consent record. Five
 * consent-enrichment tests covered that exact path and all five passed,
 * continuously, because all five used the identity stub.
 *
 * This is the `findOne`-filter sibling of #781's `cursor.factory.js` (which
 * covers the `.sort()/.limit()/.skip()` spec) and shares its drawer, per
 * #797's "same problem, same drawer". Where a test needs both, `find()` here
 * returns a `createCursorMock` chain, so a filter-honouring `find` still
 * captures its sort spec.
 *
 * The matcher is the union of the two hand-rolled copies this replaces --
 * `sample.routes.test.js` (#788's fix: `$or`, `$in`) and
 * `cold-chain-quarantine.service.test.js` (`$or`, `$and`, `$in`, `$ne`,
 * dotted paths). It is deliberately NOT a Mongo query engine; see the
 * documented limits on `matchesFilter`.
 */
const { createCursorMock } = require('./cursor.factory');

function requireVi() {
  const v = globalThis.vi;
  if (!v) {
    throw new Error('Vitest global "vi" is not available in filter factory context');
  }
  return v;
}

/**
 * Read `a.b.c` out of a document, the way Mongo addresses a nested field.
 * Returns `undefined` rather than throwing when the path runs off the
 * document, which is what a Mongo filter on a missing path does.
 */
function getByPath(source, path) {
  return String(path)
    .split('.')
    .reduce((value, key) => (value == null ? undefined : value[key]), source);
}

/**
 * Compare a document value against a filter value.
 *
 * Compared via `String(...)` rather than `===` on purpose: the values that
 * matter most here are `ObjectId`s, and an `ObjectId` is never `===` an equal
 * `ObjectId` or its hex string, which would make every id-keyed lookup miss.
 * The cost is that `1` matches `'1'` -- looser than Mongo, and the one place
 * this mock is more permissive than the real driver.
 *
 * `undefined` collapses into `null` on BOTH sides, because that is what the
 * Node driver does: it serializes an `undefined` filter value to BSON `null`
 * (`ignoreUndefined` is off by default), and a `null` filter value matches a
 * document whose field is null *or* absent. That is not a detail to smooth
 * over — it is the precise mechanism of #788, where `{ patientID: undefined }`
 * became `{ patientID: null }` and matched every patient document in the
 * biobank. A matcher that returned "no match" there would model a friendlier
 * database than the real one and hide the very bug this factory exists for.
 *
 * What makes the bug observable is therefore not a miss but a *different*
 * answer per filter: the degenerate query resolves whichever document happens
 * to come first, the correct query resolves the intended one, and an
 * assertion on the result can tell them apart. The identity stub could not,
 * because it returned the same document either way.
 *
 * A string is never equal to `null`: `{ a: 'null' }` does not match `a: null`.
 */
function sameValue(left, right) {
  const l = left === undefined ? null : left;
  const r = right === undefined ? null : right;
  if (l === null || r === null) return l === r;
  return String(l) === String(r);
}

function isOperatorObject(condition) {
  return (
    condition !== null &&
    typeof condition === 'object' &&
    !Array.isArray(condition) &&
    typeof condition.toHexString !== 'function' &&
    !(condition instanceof Date)
  );
}

function matchesCondition(value, condition) {
  if (isOperatorObject(condition)) {
    if (Array.isArray(condition.$in)) {
      return condition.$in.some((candidate) => sameValue(value, candidate));
    }
    if (Array.isArray(condition.$nin)) {
      return !condition.$nin.some((candidate) => sameValue(value, candidate));
    }
    if (condition.$ne !== undefined) {
      return !sameValue(value, condition.$ne);
    }
    if (condition.$exists !== undefined) {
      return condition.$exists ? value !== undefined : value === undefined;
    }
  }

  return sameValue(value, condition);
}

/**
 * Does `doc` satisfy `filter`?
 *
 * Supported: top-level field equality, dotted paths, `$or`, `$and`, `$in`,
 * `$nin`, `$ne`, `$exists`.
 *
 * Deliberately NOT supported -- a filter using one of these will not match the
 * way Mongo would, so a test needing it should assert on the captured filter
 * instead of relying on this matcher: `$gt`/`$lt`/`$gte`/`$lte`, `$regex`,
 * `$not`, `$nor`, `$elemMatch`, and array-contains semantics (Mongo matches a
 * scalar against an array field; this compares the array itself).
 */
function matchesFilter(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') {
      return Array.isArray(condition) && condition.some((entry) => matchesFilter(doc, entry));
    }
    if (key === '$and') {
      return Array.isArray(condition) && condition.every((entry) => matchesFilter(doc, entry));
    }
    return matchesCondition(getByPath(doc, key), condition);
  });
}

/**
 * A collection mock whose reads honour their filter and whose writes apply to
 * the same in-memory array, so a test can assert on the resulting documents.
 *
 * @param {object[]} seed - documents the collection starts with. Copied, not
 *   aliased, so a test can reuse a fixture array across cases.
 * @param {object} [options]
 * @param {object} [options.capturedFilters] - per-key store; when `key` is
 *   given, each filter this collection is handed is recorded under it.
 *   Mirrors `cursor.factory`'s `capturedSorts` naming (#769/#781).
 * @param {object} [options.capturedSorts] - forwarded to `createCursorMock`.
 * @param {object} [options.capturedLimits] - forwarded to `createCursorMock`.
 * @param {object} [options.capturedSkips] - forwarded to `createCursorMock`.
 * @param {string} [options.key] - the capture key for all four stores.
 * @param {string} [options.collectionName] - reported as `collectionName`.
 */
function createMatchingCollection(seed = [], options = {}) {
  const v = requireVi();
  const {
    capturedFilters,
    capturedSorts,
    capturedLimits,
    capturedSkips,
    key,
    collectionName = 'mock',
  } = options;

  const docs = Array.isArray(seed) ? [...seed] : [];

  const recordFilter = (filter) => {
    if (capturedFilters && key !== undefined) {
      capturedFilters[key] = filter;
    }
  };

  return {
    collectionName,
    // Exposed so a test can assert on post-write state. This is the live
    // array the write methods below mutate, not a copy.
    docs,
    findOne: v.fn(async (filter = {}) => {
      recordFilter(filter);
      return docs.find((doc) => matchesFilter(doc, filter)) || null;
    }),
    find: v.fn((filter = {}) => {
      recordFilter(filter);
      return createCursorMock(
        docs.filter((doc) => matchesFilter(doc, filter)),
        { capturedSorts, capturedLimits, capturedSkips, key }
      );
    }),
    countDocuments: v.fn(async (filter = {}) => {
      recordFilter(filter);
      return docs.filter((doc) => matchesFilter(doc, filter)).length;
    }),
    insertOne: v.fn(async (doc) => {
      docs.push(doc);
      return { acknowledged: true, insertedId: doc && doc._id };
    }),
    insertMany: v.fn(async (newDocs = []) => {
      newDocs.forEach((doc) => docs.push(doc));
      return { acknowledged: true, insertedCount: newDocs.length };
    }),
    updateOne: v.fn(async (filter = {}, update = {}) => {
      recordFilter(filter);
      const doc = docs.find((entry) => matchesFilter(entry, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { acknowledged: true, matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    }),
    updateMany: v.fn(async (filter = {}, update = {}) => {
      recordFilter(filter);
      const matched = docs.filter((doc) => matchesFilter(doc, filter));
      matched.forEach((doc) => {
        if (update.$set) Object.assign(doc, update.$set);
      });
      return { acknowledged: true, matchedCount: matched.length, modifiedCount: matched.length };
    }),
    deleteOne: v.fn(async (filter = {}) => {
      recordFilter(filter);
      const index = docs.findIndex((doc) => matchesFilter(doc, filter));
      if (index >= 0) docs.splice(index, 1);
      return { acknowledged: true, deletedCount: index >= 0 ? 1 : 0 };
    }),
    deleteMany: v.fn(async (filter = {}) => {
      recordFilter(filter);
      const kept = docs.filter((doc) => !matchesFilter(doc, filter));
      const deletedCount = docs.length - kept.length;
      docs.length = 0;
      kept.forEach((doc) => docs.push(doc));
      return { acknowledged: true, deletedCount };
    }),
  };
}

/**
 * Convenience per-collection capture store -- `cursor.factory`'s
 * `createCursorCaptureStore` sibling, with the filter map added.
 */
function createFilterCaptureStore() {
  return {
    capturedFilters: {},
    capturedSorts: {},
    capturedLimits: {},
    capturedSkips: {},
  };
}

module.exports = {
  matchesFilter,
  createMatchingCollection,
  createFilterCaptureStore,
};
