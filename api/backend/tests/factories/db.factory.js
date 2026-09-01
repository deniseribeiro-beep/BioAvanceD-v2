const { randomUUID } = require('crypto');

function createCollectionMock(overrides = {}) {
  const v = globalThis.vi;
  if (!v) {
    throw new Error('Vitest global "vi" is not available in db factory context');
  }

  const createCursor = (docs = []) => {
    let current = Array.isArray(docs) ? [...docs] : [];
    return {
      sort: v.fn().mockImplementation((criteria = {}) => {
        const [[field, direction = 1]] = Object.entries(criteria);
        if (field) {
          current.sort((a, b) => {
            const left = a?.[field] ?? 0;
            const right = b?.[field] ?? 0;
            if (left === right) return 0;
            return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
          });
        }
        return createCursor(current);
      }),
      skip: v.fn().mockImplementation((n = 0) => createCursor(current.slice(Math.max(0, n)))),
      limit: v.fn().mockImplementation((n) => {
        if (typeof n !== 'number' || n < 0) return createCursor(current);
        return createCursor(current.slice(0, n));
      }),
      project: v.fn().mockImplementation((proj = {}) => {
        if (!proj || Object.keys(proj).length === 0) return createCursor(current);
        const projected = current.map((doc) => {
          const out = {};
          for (const k of Object.keys(proj)) {
            if (proj[k]) out[k] = doc?.[k];
          }
          return out;
        });
        return createCursor(projected);
      }),
      toArray: v.fn().mockResolvedValue(current),
    };
  };

  return {
    deleteOne: v.fn().mockResolvedValue({ deletedCount: 0 }),
    insertOne: v.fn().mockResolvedValue({ insertedId: randomUUID() }),
    updateOne: v.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    findOne: v.fn().mockResolvedValue(null),
    find: v.fn().mockImplementation(() => createCursor([])),
    countDocuments: v.fn().mockResolvedValue(0),
    createIndex: v.fn().mockResolvedValue(null),
    collectionName: 'mock_collection',
    ...overrides,
  };
}

function createDbMock(collections = {}) {
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedMap = {};
  Object.keys(collections).forEach((k) => {
    normalizedMap[normalize(k)] = collections[k];
  });

  const aliasFallback = {
    pacientes: 'patients',
    amostras: 'samples',
    consent_templates: 'consentTemplates',
    consenttemplates: 'consentTemplates',
    biomarkerobservations: 'biomarker_observations',
    observations: 'observations',
  };

  return {
    collection: (name) => {
      const n = normalize(name);
      if (normalizedMap[n]) return normalizedMap[n];
      const alias = aliasFallback[n];
      if (alias && normalizedMap[normalize(alias)]) return normalizedMap[normalize(alias)];
      // try to find by substring match
      const foundKey = Object.keys(normalizedMap).find((k) => k === n || k.includes(n) || n.includes(k));
      if (foundKey) return normalizedMap[foundKey];
      return createCollectionMock();
    },
  };
}

const FOREIGN_BSON_ERROR_MESSAGE = 'Unsupported BSON version, bson types must be from bson 7.x.x';

function assertNoForeignObjectId(value) {
  const { ObjectId: NativeObjectId } = require('mongodb');
  const seen = new Set();
  const walk = (val) => {
    if (val === null || typeof val !== 'object') return;
    if (val instanceof NativeObjectId) {
      throw new Error(FOREIGN_BSON_ERROR_MESSAGE);
    }
    if (seen.has(val)) return;
    seen.add(val);
    const entries = Array.isArray(val) ? val : Object.values(val);
    entries.forEach(walk);
  };
  walk(value);
}

// #651: mongoose bundles its own bson, major-version-diverged from the
// top-level `mongodb` package's bson. A live ObjectId *instance* built from
// `require('mongodb')` and handed to a query run through the mongoose
// connection throws "Unsupported BSON version, bson types must be from bson
// 7.x.x" -- bytes already stored in Mongo round-trip fine through either
// connection, only a foreign in-memory instance crossing codecs fails. This
// helper reproduces that failure mode on a collection mock's find/findOne so
// a regression at a mongoose-backed call site (someone reintroducing
// `require('mongodb').ObjectId`) fails loudly instead of silently returning
// zero matches. Additive only -- does not change createCollectionMock's
// default find/findOne behaviour for existing callers.
function createForeignBsonGuardCollectionMock(overrides = {}) {
  const v = globalThis.vi;
  if (!v) {
    throw new Error('Vitest global "vi" is not available in db factory context');
  }

  const mock = createCollectionMock(overrides);
  ['find', 'findOne'].forEach((method) => {
    const inner = mock[method];
    mock[method] = v.fn().mockImplementation((filter, ...rest) => {
      assertNoForeignObjectId(filter);
      return inner(filter, ...rest);
    });
  });
  return mock;
}

module.exports = {
  createCollectionMock,
  createDbMock,
  createForeignBsonGuardCollectionMock,
};
