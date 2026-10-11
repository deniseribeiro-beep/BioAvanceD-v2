// An in-memory stand-in for the native driver's db/collection, with real
// filter semantics for what the Foundation pipeline issues: exact-key and
// dotted-path equality, array membership, `$in`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$exists`,
// top-level `$or`/`$and`, upsert with `$setOnInsert` returning the upserted id, multi-key
// sort/skip/limit cursors, a sorted findOne, counts, deletes and index
// listing. A
// stub returning canned data would let the pipeline's own queries go
// unchecked.

let nextId = 1;

function valueAt(doc, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
}

const isObjectId = (value) => value != null && value._bsontype === 'ObjectId';

// Equality as the driver applies it: an array field matches when any of its
// elements does, Dates compare by time, and ObjectIds by value.
function equals(actual, expected) {
  if (Array.isArray(actual) && !Array.isArray(expected)) return actual.some((item) => equals(item, expected));
  if (actual instanceof Date && expected instanceof Date) return +actual === +expected;
  if (isObjectId(actual) && isObjectId(expected)) return actual.equals(expected);
  return actual === expected;
}

const OPERATORS = {
  $in: (actual, candidates) => candidates.some((candidate) => equals(actual, candidate)),
  $ne: (actual, value) => !equals(actual, value),
  $gte: (actual, bound) => actual != null && actual >= bound,
  $lte: (actual, bound) => actual != null && actual <= bound,
  $gt: (actual, bound) => actual != null && actual > bound,
  $lt: (actual, bound) => actual != null && actual < bound,
  $exists: (actual, wanted) => (actual !== undefined) === Boolean(wanted),
};

// An operator this fake does not implement throws rather than matching
// nothing, so a test cannot pass on a filter it never evaluated.
function isOperatorObject(expected) {
  if (!expected || typeof expected !== 'object' || expected instanceof Date || Array.isArray(expected)) return false;
  const keys = Object.keys(expected);
  const unknown = keys.filter((key) => key.startsWith('$') && !(key in OPERATORS));
  if (unknown.length) throw new Error(`fake-db: unsupported filter operator ${unknown.join(', ')}`);
  return keys.length > 0 && keys.every((key) => key in OPERATORS);
}

// Top-level `$or` and `$and` take a list of filters, as the driver's do.
// Any other `$`-prefixed top-level key throws, like an unknown operator.
function matches(doc, filter = {}) {
  return Object.entries(filter).every(([path, expected]) => {
    if (path === '$or') return expected.some((clause) => matches(doc, clause));
    if (path === '$and') return expected.every((clause) => matches(doc, clause));
    if (path.startsWith('$')) throw new Error(`fake-db: unsupported top-level operator ${path}`);
    const actual = valueAt(doc, path);
    if (isOperatorObject(expected)) {
      return Object.entries(expected).every(([op, operand]) => OPERATORS[op](actual, operand));
    }
    return equals(actual, expected);
  });
}

// Compares on every key of the spec in order, as the driver does. Runs
// written in the same millisecond tie on their timestamps; a full tie is
// broken by insertion order in the first key's direction, so "newest" is
// the one written last.
function sortDocs(rows, spec) {
  const keys = Object.entries(spec);
  const order = new Map(rows.map((doc, index) => [doc, index]));
  return [...rows].sort((a, b) => {
    for (const [key, direction] of keys) {
      const av = valueAt(a, key);
      const bv = valueAt(b, key);
      // A missing field sorts below every value, as null does in BSON order.
      if (av == null || bv == null) {
        if (av == null && bv == null) continue;
        return (av == null ? -1 : 1) * direction;
      }
      if (!(+av === +bv || av === bv)) return (av > bv ? 1 : -1) * direction;
    }
    return (order.get(a) - order.get(b)) * keys[0][1];
  });
}

function cursor(rows) {
  let list = [...rows];
  const api = {
    sort(spec) {
      list = sortDocs(list, spec);
      return api;
    },
    skip(n) {
      list = list.slice(n);
      return api;
    },
    limit(n) {
      list = list.slice(0, n);
      return api;
    },
    async next() {
      return list[0] || null;
    },
    async toArray() {
      return list;
    },
  };
  return api;
}

function createFakeCollection(name, hooks = {}) {
  const docs = [];
  const indexes = [{ key: { _id: 1 }, name: '_id_' }];
  return {
    name,
    collectionName: name,
    docs,
    indexes,
    // Reads return copies, as the driver does: a caller holding a read
    // document must not see a later write through it.
    async findOne(filter = {}, options = {}) {
      const candidates = docs.filter((d) => matches(d, filter));
      const doc = options.sort ? sortDocs(candidates, options.sort)[0] : candidates[0];
      return doc ? structuredClone(doc) : null;
    },
    async updateOne(filter, update, options = {}) {
      const doc = docs.find((d) => matches(d, filter));
      if (doc) {
        if (update.$set) Object.assign(doc, update.$set);
        return { matchedCount: 1, modifiedCount: update.$set ? 1 : 0, upsertedCount: 0, upsertedId: null };
      }
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
      const inserted = { _id: `id-${nextId++}`, ...(update.$setOnInsert || {}) };
      docs.push(inserted);
      if (hooks.afterUpsert) await hooks.afterUpsert(inserted);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: inserted._id };
    },
    async updateMany(filter, update) {
      const hit = docs.filter((doc) => matches(doc, filter));
      if (update.$set) hit.forEach((doc) => Object.assign(doc, update.$set));
      return { matchedCount: hit.length, modifiedCount: update.$set ? hit.length : 0 };
    },
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id || `id-${nextId++}` };
    },
    async countDocuments(filter = {}) {
      return docs.filter((doc) => matches(doc, filter)).length;
    },
    async deleteMany(filter = {}) {
      const keep = docs.filter((doc) => !matches(doc, filter));
      const deletedCount = docs.length - keep.length;
      docs.splice(0, docs.length, ...keep);
      return { deletedCount };
    },
    find(filter = {}) {
      return cursor(docs.filter((doc) => matches(doc, filter)).map((doc) => structuredClone(doc)));
    },
    async createIndex(key, options = {}) {
      if (hooks.createIndex) await hooks.createIndex(key, options);
      if (!indexes.some((index) => JSON.stringify(index.key) === JSON.stringify(key))) {
        indexes.push({ key, name: options.name || Object.keys(key).join('_'), unique: options.unique === true });
      }
      return options.name;
    },
    async dropIndex(indexName) {
      const at = indexes.findIndex((index) => index.name === indexName);
      if (at >= 0) indexes.splice(at, 1);
    },
    listIndexes() {
      return cursor(indexes);
    },
  };
}

// `hooksByCollection[name]` lets a test make one collection misbehave.
function createFakeDb(hooksByCollection = {}) {
  const collections = {};
  const db = {
    collections,
    collection(name) {
      if (!collections[name]) collections[name] = createFakeCollection(name, hooksByCollection[name] ? hooksByCollection[name](db) : {});
      return collections[name];
    },
  };
  return db;
}

module.exports = { createFakeDb, matches };
