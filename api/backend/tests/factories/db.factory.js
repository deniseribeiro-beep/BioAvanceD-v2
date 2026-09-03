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

// #1000: a real MongoClient reaching a transactional call site (six of them,
// per issue #1000) is derived from `db.client || db.s?.client` and needs
// BOTH capabilities below -- never just one:
//   - `startSession()` -- `withMongoTransaction`/`MongoStorageRepository`
//     open the session through this.
//   - `db('admin').command({ hello: 1 })` -- `probeTopology`
//     (isTransactionCapable/isKnownStandaloneDeployment, src/utils/mongoTransaction.js)
//     reaches this before a session is even opened, to decide whether the
//     deployment is replica-set/mongos-capable.
// 646a2c5d is the regression this mirrors: three tests once replaced
// `db.client` wholesale with `{ db }` (dropping startSession) and broke,
// because a real MongoClient always has both. A mock with startSession alone
// reproduces the same defect from the other side -- it would make
// probeTopology return 'unknown' rather than exercising the topology probe
// at all. So both are always present here, unconditionally: every
// createDbMock() consumer gets a client capable of a transaction, by
// default landing on a replica-set-shaped `hello` response (transactional,
// not standalone) so a happy-path transactional call site just works without
// per-test wiring. A test asserting standalone-refusal behaviour overrides
// `db.client` itself, same as it always could.
function createMongoClientMock() {
  const v = globalThis.vi;
  if (!v) {
    throw new Error('Vitest global "vi" is not available in db factory context');
  }

  const session = {
    withTransaction: v.fn(async (handler) => handler()),
    endSession: v.fn().mockResolvedValue(undefined),
  };

  const adminDb = {
    command: v.fn().mockResolvedValue({ setName: 'mockReplicaSet' }),
  };

  const client = {
    startSession: v.fn(() => session),
    db: v.fn((name) => (name === 'admin' ? adminDb : undefined)),
  };

  return { client, session };
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

  const { client, session } = createMongoClientMock();

  return {
    // NOTE on `session` below: a real driver `Db` has NO `session` property.
    // It is a test-ergonomics handle so a consumer can assert on the session
    // without digging through `client.startSession.mock.results`. Keep it that
    // way -- **[ran it]** `git grep -n -I "db\.session" -- api/backend/src`
    // returns zero, and product code derives its client from
    // `db.client || db.s?.client` (mongoTransaction.js:7,:75;
    // MongoStorageRepository.js:26), never from this. If a product path ever
    // starts reading `db.session`, delete this property rather than making it
    // real: a mock supplying a member the driver lacks is exactly the #994
    // defect, where `makeDb()` fabricated `getMongo` and 41 green tests
    // certified a dead endpoint.
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
    client,
    session,
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
