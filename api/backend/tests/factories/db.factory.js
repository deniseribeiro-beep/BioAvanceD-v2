const { randomUUID } = require('crypto');

// #1034: the omission mirror of #994. #994 was a mock FABRICATING a method
// the real driver lacks (`getMongo`) and certifying a dead endpoint with 41
// green tests. This is the same defect from the other side: a collection
// mock that OMITTED `findOneAndUpdate` (the counter-backed movement-ID
// allocator every audit/ledger write goes through --
// MongoAuditRepository.generateMovementID, SampleMovement.generateMovementID,
// barcodeGenerator's counter path) and a cursor missing `next()` (the
// movement ledger's hash-chain read, sampleMovementLedger's
// appendMovementWithHashChain, and the mqtt-ingestion-audit/scheduler
// services' own `.find().sort().limit(1).next()` reads). Both omissions
// surface as a TypeError, caught by the use case's own catch block,
// rethrown, and mapped by the controller to a plausible HTTP 500 -- so a
// test asserting `expect(res.status).toBe(500)` for a legitimate
// infrastructure-failure case can pass against a fixture that never reached
// the code under test at all. Both are carried below by default, overridable
// per test the same way every other default here is:
//   - `findOneAndUpdate` resolves `{ seq: 1 }` -- the only field the counter
//     path reads.
//   - the cursor's `next()` resolves the first document of its current
//     contents, or `null` when empty -- the honest analogue of a real driver
//     cursor, so a test that pre-loads `find()` with documents gets a
//     sensible default without also having to override `next` by hand.
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
      next: v.fn().mockImplementation(() => Promise.resolve(current.length ? current[0] : null)),
    };
  };

  return {
    deleteOne: v.fn().mockResolvedValue({ deletedCount: 0 }),
    insertOne: v.fn().mockResolvedValue({ insertedId: randomUUID() }),
    // #1043: this default makes `matchedCount === 0` UNREACHABLE for any
    // test that leaves it alone. Every compare-and-set occupancy guard in
    // MongoStorageRepository.js -- moveSamplePosition's source (line 330)
    // and target/STORAGE_COLLISION (line 365) checks, its sample-update
    // check (line 381), allocateSamplePosition's STORAGE_COLLISION (line
    // 460), autoAssignSamplePosition's box (line 548) and sample (line 566)
    // checks, and releaseSamplePosition's "Origem inconsistente" check
    // (line 686) -- branches on that comparison and can never fire against
    // this default. A test asserting one of those guards MUST override
    // `updateOne` on this mock itself, or use `createContendedCollectionMock`
    // below, which supplies `{ matchedCount: 0, modifiedCount: 0 }` instead.
    // A green test against the default alone proves only that the write
    // path was reached, not that the guard does anything. Left unchanged on
    // purpose -- see createContendedCollectionMock, not this default, for
    // the compare-and-set-contended case.
    updateOne: v.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    findOne: v.fn().mockResolvedValue(null),
    findOneAndUpdate: v.fn().mockResolvedValue({ seq: 1 }),
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

  // Stage 2E: production resolves Specimen→specimens, Participant→participants,
  // UserAccount→userAccounts. Keep bidirectional aliases so seeds keyed with
  // either legacy or canonical names still resolve when product code asks for
  // the canonical collection name via getCollection / db.collection.
  const aliasFallback = {
    samples: 'specimens',
    specimens: 'samples',
    amostras: 'specimens',
    patients: 'participants',
    participants: 'patients',
    pacientes: 'participants',
    users: 'userAccounts',
    useraccounts: 'users',
    consent_templates: 'consentTemplates',
    consenttemplates: 'consentTemplates',
    patientconsents: 'consents',
    patient_consents: 'consents',
    sample_movements: 'sampleMovements',
    samplemovements: 'sampleMovements',
    clinical_units: 'clinicalUnits',
    clinicalunits: 'clinicalUnits',
    biomarker_observations: 'biomarkerObservations',
    biomarkerobservations: 'biomarkerObservations',
    disease_dictionary: 'diseaseDictionary',
    diseasedictionary: 'diseaseDictionary',
    medication_dictionary: 'medicationDictionary',
    medicationdictionary: 'medicationDictionary',
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

// #1043: createCollectionMock's own `updateOne` default (`matchedCount: 1,
// modifiedCount: 1`) makes every compare-and-set occupancy guard in
// MongoStorageRepository.js unreachable -- see the comment on that default
// above. This is the additive, opt-in fix: identical to createCollectionMock
// except `updateOne` resolves `{ matchedCount: 0, modifiedCount: 0 }` by
// construction, so a test asserting a guard fires doesn't have to hand-roll
// the override itself. `overrides` is applied last, same as
// createCollectionMock's own contract, so a caller can still override
// `updateOne` (or anything else) on top. Additive only -- does not change
// createCollectionMock's own default for existing callers.
function createContendedCollectionMock(overrides = {}) {
  const v = globalThis.vi;
  if (!v) {
    throw new Error('Vitest global "vi" is not available in db factory context');
  }

  return createCollectionMock({
    updateOne: v.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    ...overrides,
  });
}

module.exports = {
  createCollectionMock,
  createDbMock,
  createForeignBsonGuardCollectionMock,
  createContendedCollectionMock,
};
