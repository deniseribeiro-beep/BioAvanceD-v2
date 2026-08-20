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
    async find(filter = {}) {
      const found = docs.filter((doc) => matches(doc, filter));
      return { toArray: async () => found };
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
