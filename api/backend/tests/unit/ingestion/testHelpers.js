// Shared real-query-matching fake Mongo, scoped to RF029 ingestion gateway
// unit tests (#669). Not a *.test.js file itself, so vitest's discovery
// doesn't pick it up as a suite. Same "real query-matching, not a canned
// stub" bar as tests/unit/reference-imports/quarantine.test.js — this
// module's callers branch on actual filter/upsert outcomes (idempotency
// claims, active-code lookups), so a stub that returns canned data
// regardless of query would validate nothing.

function matches(doc, filter = {}) {
  return Object.keys(filter).every((key) => {
    const condition = filter[key];
    if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
      if ('$in' in condition) return condition.$in.includes(doc[key]);
    }
    return doc[key] === condition;
  });
}

function sortDocs(docs, sort) {
  if (!sort) return docs;
  const [[field, direction]] = Object.entries(sort);
  return [...docs].sort((a, b) => {
    const av = a[field] instanceof Date ? a[field].getTime() : a[field];
    const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
    if (av === bv) return 0;
    return direction >= 0 ? (av > bv ? 1 : -1) : (av > bv ? -1 : 1);
  });
}

function createFakeCollection(seedDocs = []) {
  const docs = seedDocs.map((doc) => ({ ...doc }));
  return {
    docs,
    async findOne(filter = {}, options = {}) {
      const candidates = sortDocs(docs.filter((doc) => matches(doc, filter)), options.sort);
      return candidates[0] || null;
    },
    // #694: synchronous, returning a chainable cursor -- the real driver's
    // shape. This used to be `async find()` resolving to a bare
    // `{ toArray }`, which `await collection.find(f)` tolerated (awaiting a
    // non-thenable is a passthrough) but which broke the chained
    // `collection.find(f).toArray()` form the rest of the codebase uses, and
    // offered no `.sort()` at all. Filtering is deferred to toArray() so the
    // cursor stays lazy the way a real one is.
    find(filter = {}, options = {}) {
      let sortSpec = options.sort || null;
      let skipCount = 0;
      let limitCount = null;

      const cursor = {
        sort(spec) {
          sortSpec = spec;
          return cursor;
        },
        skip(count) {
          skipCount = count;
          return cursor;
        },
        limit(count) {
          limitCount = count;
          return cursor;
        },
        async toArray() {
          let found = sortDocs(docs.filter((doc) => matches(doc, filter)), sortSpec);
          if (skipCount) found = found.slice(skipCount);
          if (limitCount !== null) found = found.slice(0, limitCount);
          return found;
        },
      };

      return cursor;
    },
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id || null, acknowledged: true };
    },
    async updateOne(filter, update, options = {}) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) {
        if (options.upsert) {
          const inserted = { ...filter, ...(update.$setOnInsert || {}), ...(update.$set || {}) };
          docs.push(inserted);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: null };
        }
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }
      if (update.$set) Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    },
  };
}

function createFakeDb(collectionSeeds = {}) {
  const collections = {};
  for (const [name, seed] of Object.entries(collectionSeeds)) {
    collections[name] = createFakeCollection(seed);
  }
  return {
    collections,
    collection(name) {
      if (!collections[name]) collections[name] = createFakeCollection([]);
      return collections[name];
    },
  };
}

module.exports = { createFakeCollection, createFakeDb, matches };
