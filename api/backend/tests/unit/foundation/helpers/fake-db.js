// An in-memory stand-in for the native driver's db/collection, with real
// filter semantics for what the Foundation pipeline issues: exact-key and
// dotted-path equality, `$in`, upsert with `$setOnInsert` returning the
// upserted id, sort/limit cursors, counts, deletes and index listing. A
// stub returning canned data would let the pipeline's own queries go
// unchecked.

let nextId = 1;

function valueAt(doc, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([path, expected]) => {
    const actual = valueAt(doc, path);
    if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
      return expected.$in.some((candidate) => candidate === actual);
    }
    return actual === expected;
  });
}

function cursor(rows) {
  let list = [...rows];
  const api = {
    sort(spec) {
      const [[key, direction]] = Object.entries(spec);
      const order = new Map(list.map((doc, index) => [doc, index]));
      // Runs written in the same millisecond tie on their timestamps; break
      // the tie by insertion order, so "newest" is the one written last.
      list.sort((a, b) => {
        const av = valueAt(a, key);
        const bv = valueAt(b, key);
        if (+av === +bv || av === bv) return (order.get(a) - order.get(b)) * direction;
        return (av > bv ? 1 : -1) * direction;
      });
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
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
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
      return cursor(docs.filter((doc) => matches(doc, filter)));
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
