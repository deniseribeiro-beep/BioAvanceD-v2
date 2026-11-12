import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const sampleService = require('../../src/services/sample.service');
const qualityDomain = require('../../src/services/quality-domain.service');
const { sampleOrganizationScopeClause } = require('../../src/services/sampleTenancy.service');
const { ObjectId, MongoServerError } = require('mongodb');
const env = require('../../src/config/env');

// #1378 (ELM-0116): runs `body` with the Sample.barcode migration window closed.
async function withBarcodeWindowClosed(body) {
  const saved = env.SAMPLE_BARCODE_WINDOW_CLOSED;
  env.SAMPLE_BARCODE_WINDOW_CLOSED = true;
  try {
    return await body();
  } finally {
    env.SAMPLE_BARCODE_WINDOW_CLOSED = saved;
  }
}

const BOX_ID = new ObjectId();
const RACK_ID = new ObjectId();
const SHELF_ID = new ObjectId();
const FREEZER_ID = new ObjectId();

function makeCursor(docs = []) {
  const cursor = {
    sort: vi.fn(() => cursor),
    skip: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    project: vi.fn(() => cursor),
    toArray: vi.fn().mockResolvedValue(docs),
    next: vi.fn().mockResolvedValue(docs[0] || null)
  };
  return cursor;
}

function makeCollection(name) {
  return {
    collectionName: name,
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn(() => makeCursor([])),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'generated-id' }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: vi.fn().mockResolvedValue(0),
    // #779: was `{ value: { seq: 1 } }` -- the PRE-v5 driver shape, which
    // #294 already established is wrong for this repo's mongodb version
    // (v5+/6.x returns the modified document directly; the wrapped form only
    // appears with `includeResultMetadata: true`). A generic fake asserting
    // the legacy shape is the same defect #294 fixed in product code, one
    // layer down, and it is what made every counter consumer read
    // `undefined`. See `counters` in makeDb for a real stateful counter.
    findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
    createIndex: vi.fn().mockResolvedValue(true)
  };
}

// #779: a real in-memory `counters` collection -- honours $setOnInsert on
// upsert, $inc, and the v5+ `returnDocument: 'after'` shape (the document
// directly, not `{ value: doc }`; see #294).
function makeCountersCollection() {
  const store = {};
  return {
    collectionName: 'counters',
    findOne: vi.fn(async (query) => (query._id in store ? { _id: query._id, ...store[query._id] } : null)),
    updateOne: vi.fn(async (query, update, options = {}) => {
      if (!(query._id in store) && options.upsert) store[query._id] = { ...(update.$setOnInsert || {}) };
      return { acknowledged: true };
    }),
    findOneAndUpdate: vi.fn(async (query, update, options = {}) => {
      if (!(query._id in store)) {
        if (!options.upsert) return null;
        store[query._id] = { ...(update.$setOnInsert || {}) };
      }
      for (const [field, by] of Object.entries(update.$inc || {})) {
        store[query._id][field] = (store[query._id][field] || 0) + by;
      }
      return { _id: query._id, ...store[query._id] };
    }),
    createIndex: vi.fn().mockResolvedValue(true),
    __store: store
  };
}

// #1374: the physical-chain collections the allocation writes. Each keeps
// what is inserted and matches a query by equality and `$or`, so the echo
// read after the create finds the placement the allocation wrote.
const CHAIN_COLLECTIONS = ['containers', 'specimenContainerAssignments', 'containerPositionAssignments', 'rackLocationAssignments'];

function matchesChainQuery(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) =>
    key === '$or' ? value.some((branch) => matchesChainQuery(doc, branch)) : doc[key] === value
  );
}

function makeChainCollection(name) {
  const docs = [];
  return {
    ...makeCollection(name),
    findOne: vi.fn(async (filter) => docs.find((doc) => matchesChainQuery(doc, filter)) || null),
    find: vi.fn((filter) => makeCursor(docs.filter((doc) => matchesChainQuery(doc, filter)))),
    insertOne: vi.fn(async (doc) => {
      docs.push({ ...doc });
      return { insertedId: docs.length };
    }),
    updateOne: vi.fn(async (filter, update) => {
      const doc = docs.find((row) => matchesChainQuery(row, filter));
      if (doc) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    })
  };
}

// Mirrors the real driver closely enough to prove withMongoTransaction's
// wiring (#297): withTransaction runs the handler and lets a thrown error
// propagate uncommitted, same as the real session aborting on throw.
function makeSession() {
  const session = {
    withTransaction: vi.fn(async (handler) => handler()),
    endSession: vi.fn().mockResolvedValue(undefined)
  };
  return session;
}

function makeDb(overrides = {}) {
  const collections = {
    samples: makeCollection('samples'),
    sample_movements: makeCollection('sample_movements'),
    // #779: generateUniqueBarcode seeds a per-year counter then advances it
    // atomically, so this one has to hold state -- a fixed `seq` cannot
    // advance, and every barcode after the first would collide.
    counters: makeCountersCollection(),
    patients: makeCollection('patients'),
    storageBoxes: makeCollection('storageBoxes'),
    storageContainers: makeCollection('storageContainers'),
    storageAssignments: makeCollection('storageAssignments'),
    results: makeCollection('results'),
    ...Object.fromEntries(CHAIN_COLLECTIONS.map((name) => [name, makeChainCollection(name)])),
    ...overrides
  };
  const session = makeSession();
  return {
    collections,
    collection: vi.fn((name) => collections[name] || (collections[name] = makeCollection(name))),
    // no listCollections -> collectionResolver falls back to canonical names directly
    client: {
      startSession: vi.fn(() => session)
    },
    session
  };
}

function validSampleData(overrides = {}) {
  return {
    participantId: '12345678',
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 10,
    quality: 'GOOD',
    linkedProject: 'ProjectX',
    barcode: 'BR-TEST-001',
    specimenId: 555001,
    boxId: BOX_ID.toString(),
    positionCode: 'A1',
    registeredAt: new Date('2024-01-01'),
    ...overrides
  };
}

// #462: the storage chain a valid createSample call resolves —
// BOX_ID -> RACK_ID -> SHELF_ID -> FREEZER_ID (containerID 'EQ-1'), mirroring
// the hierarchy the #461 backfill script materializes.
function mockOperationalStorage(db) {
  db.collections.patients.findOne.mockResolvedValue({ participantId: '12345678' });

  const containersById = new Map([
    [String(RACK_ID), { _id: RACK_ID, containerType: 'RACK', parent_id: SHELF_ID }],
    [String(SHELF_ID), { _id: SHELF_ID, containerType: 'SHELF', parent_id: FREEZER_ID }],
    [String(FREEZER_ID), { _id: FREEZER_ID, containerType: 'FREEZER', containerID: 'EQ-1', parent_id: null }]
  ]);

  const mocked = {
    // dimension is required by MongoStorageRepository.allocateSamplePosition's
    // in-bounds check (#474) — a box without it always fails "posição fora dos
    // limites", so it must be present even though the pre-#474 gating code
    // never looked at it.
    storageBoxes: {
      findOne: vi.fn().mockResolvedValue({ _id: BOX_ID, parent_id: RACK_ID, dimension: { rows: 8, cols: 12 } }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
    },
    storageContainers: { findOne: vi.fn((query) => Promise.resolve(containersById.get(String(query._id)) || null)) },
    equipment: { findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1' }) },
    sensors: { findOne: vi.fn().mockResolvedValue({ status: 'ok' }) },
    // #474: AllocateSampleUseCase resolves the hierarchy via storagePaths
    // (MongoStorageRepository.findStorageHierarchyForBox, not the parent_id
    // walk resolveStorageHierarchyForBox still uses for the pre-allocation
    // equipment/sensor gate above).
    storagePaths: {
      findOne: vi.fn().mockResolvedValue({ boxId: BOX_ID, rackId: RACK_ID, shelfId: SHELF_ID, freezerId: FREEZER_ID })
    },
    // #507: AllocateSampleUseCase's findSampleById resolves the canonical
    // storageAssignment via findOne before the position is even open — no
    // open assignment exists yet at create time, so this stays null.
    storageAssignments: {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'assignment-1' }),
      findOne: vi.fn().mockResolvedValue(null)
    }
  };

  db.collection.mockImplementation((name) => {
    if (mocked[name]) return mocked[name];
    return db.collections[name] || (db.collections[name] = makeCollection(name));
  });

  // #474: AllocateSampleUseCase looks the sample back up by _id (once before
  // the Mongo transaction for the lineage payload, once inside it) after
  // createSample's own insertOne — distinct from the specimenId/barcode
  // duplicate-check lookups earlier in the same call, which keep resolving
  // null (the default from makeCollection) unless a test overrides them.
  // #1374: the chain keys a placement by the business specimenId, so the
  // looked-up sample carries the one createSample inserted. The inserts are
  // kept on the db, since a case may replace or wrap samples.insertOne.
  db.insertedSamples = [];
  db.collections.samples.insertOne.mockImplementation(async (doc) => {
    db.insertedSamples.push(doc);
    return { insertedId: 'generated-id' };
  });
  db.collections.samples.findOne.mockImplementation((query) => {
    if (query && query._id !== undefined) {
      const inserted = db.insertedSamples.at(-1);
      return Promise.resolve({ _id: query._id, specimenId: inserted?.specimenId, barcode: null, storageLocation: null });
    }
    return Promise.resolve(null);
  });
}

describe('sample.service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  describe('createSample', () => {
    it('creates a sample and appends a birth movement to the ledger', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      const result = await sampleService.createSample(db, validSampleData());

      expect(result._id).toBe('generated-id');
      expect(result.barcode).toBe('BR-TEST-001');
      expect(db.collections.samples.insertOne).toHaveBeenCalledTimes(1);
      // #474: AllocateSampleUseCase's audit repository appends its own
      // 'allocate' movement to the same ledger, alongside the birth
      // 'create' movement createSample already wrote — two inserts, not one.
      expect(db.collections.sample_movements.insertOne).toHaveBeenCalledTimes(2);
      const movementTypes = db.collections.sample_movements.insertOne.mock.calls.map(([arg]) => arg.type);
      expect(movementTypes).toEqual(['create', 'allocate']);
      const [movementArg] = db.collections.sample_movements.insertOne.mock.calls[0];
      expect(movementArg.type).toBe('create');
      expect(movementArg.destination).toBe(`storage:${BOX_ID.toString()}:A1`);
    });

    it.each([
      ['a formatted CPF', '123.456.789-09'],
      ['a bare CPF', '52998224725'],
      ['an e-mail', 'joana@example.com']
    ])('refuses a caller-supplied barcode holding %s with BARCODE_PERSONAL_DATA before any write (RNF007 AC4, #1463)', async (_kind, barcode) => {
      const db = makeDb();
      mockOperationalStorage(db);

      await expect(sampleService.createSample(db, validSampleData({ barcode })))
        .rejects.toMatchObject({ statusCode: 422, code: 'BARCODE_PERSONAL_DATA' });
      expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
      expect(db.collections.sample_movements.insertOne).not.toHaveBeenCalled();
    });

    it.each([['JOANA-001'], ['JoanaXimenes'], ['XIMENES2026']])('refuses a caller-supplied barcode %s holding the participant name (RNF007 AC4, #1463)', async (barcode) => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collection('participantIdentities').findOne.mockResolvedValue({ participantId: '12345678', patientName: 'Joana Ximenes dos Santos' });

      const error = await sampleService.createSample(db, validSampleData({ barcode })).catch((caught) => caught);
      expect(error).toMatchObject({ statusCode: 422, code: 'BARCODE_PERSONAL_DATA' });
      expect(error.message).not.toContain('Joana');
      expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
      expect(db.collections.sample_movements.insertOne).not.toHaveBeenCalled();
    });

    it('reads the participant name from a ciphertext-only identity record (RNF007 AC4, #1463)', async () => {
      const participantIdentityService = require('../../src/services/participantIdentity.service');
      const encrypted = participantIdentityService.encryptIdentityFields({
        participantId: '12345678',
        patientName: 'Joana Ximenes dos Santos'
      });
      const db = makeDb();
      mockOperationalStorage(db);
      db.collection('participantIdentities').findOne.mockResolvedValue({ ...encrypted, patientName: null });

      await expect(sampleService.createSample(db, validSampleData({ barcode: 'JOANA-001' })))
        .rejects.toMatchObject({ statusCode: 422, code: 'BARCODE_PERSONAL_DATA' });
      expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
    });

    it('keeps an opaque caller-supplied barcode when the participant has a name on file (RNF007 AC4, #1463)', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collection('participantIdentities').findOne.mockResolvedValue({ participantId: '12345678', patientName: 'Joana Ximenes dos Santos' });

      const result = await sampleService.createSample(db, validSampleData());

      expect(result.barcode).toBe('BR-TEST-001');
    });

    it('persists the resolved storageLocation (boxId/positionCode) on the created sample, per issue #462', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      await sampleService.createSample(db, validSampleData({ positionCode: 'B2' }));

      const [insertedSample] = db.collections.samples.insertOne.mock.calls[0];
      expect(insertedSample.storageLocation).toEqual({ boxId: BOX_ID, position: 'B2' });
      expect(insertedSample.locationID).toBeNull();
    });

    it('exposes the current placement on the response, read from the physical chain the allocation just wrote, per issue #510/#1374', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      const result = await sampleService.createSample(db, validSampleData({ positionCode: 'B2' }));

      const [container] = db.collections.containers.insertOne.mock.calls[0];
      expect(result.storageAssignment).toEqual({
        boxId: BOX_ID.toString(),
        positionCode: 'B2',
        containerId: container.containerId,
        storagePositionId: `${BOX_ID}:B02`,
        storageRackId: BOX_ID.toString(),
        storageLocationId: null,
        placedAt: expect.any(Date),
        source: 'physical_chain'
      });
      expect(result.storageLocation).toEqual({ boxId: BOX_ID, position: 'B2' });
    });

    it('places the specimen on the physical chain at boxId/positionCode, keyed by its business specimenId, per issue #462/#474/#1374', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      await sampleService.createSample(db, validSampleData());

      expect(db.collections.containers.insertOne).toHaveBeenCalledTimes(1);
      const [container] = db.collections.containers.insertOne.mock.calls[0];
      expect(db.collections.specimenContainerAssignments.insertOne).toHaveBeenCalledTimes(1);
      expect(db.collections.specimenContainerAssignments.insertOne.mock.calls[0][0]).toMatchObject({
        specimenId: '555001',
        containerId: container.containerId
      });
      expect(db.collections.containerPositionAssignments.insertOne).toHaveBeenCalledTimes(1);
      expect(db.collections.containerPositionAssignments.insertOne.mock.calls[0][0]).toMatchObject({
        containerId: container.containerId,
        storagePositionId: `${BOX_ID}:A01`
      });
      // The legacy StorageAssignment row is no longer written.
      expect(db.collection('storageAssignments').insertOne).not.toHaveBeenCalled();
    });

    it('rejects with 422 when required MIABIS fields are missing', async () => {
      const db = makeDb();
      const bad = validSampleData();
      delete bad.sampleType;

      await expect(sampleService.createSample(db, bad)).rejects.toMatchObject({
        statusCode: 422
      });
      expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
    });

    it('rejects with 404 when the participant does not exist', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collections.patients.findOne.mockResolvedValue(null); // not found

      await expect(sampleService.createSample(db, validSampleData())).rejects.toMatchObject({
        statusCode: 404
      });
    });

    it('rejects when the barcode is already taken', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collections.samples.findOne
        .mockResolvedValueOnce(null) // specimenId dup check passes
        .mockResolvedValueOnce({ barcode: 'BR-TEST-001' }); // barcode dup check

      await expect(sampleService.createSample(db, validSampleData())).rejects.toThrow(
        /Já existe uma amostra com o código de barras/
      );
    });

    it('rejects when the specimenId is already taken', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collections.samples.findOne.mockResolvedValueOnce({ specimenId: 555001 }); // specimenId dup check

      await expect(sampleService.createSample(db, validSampleData())).rejects.toThrow(
        /Já existe um espécime com o ID/
      );
    });

    it('rejects when boxId is missing', async () => {
      const db = makeDb();

      await expect(
        sampleService.createSample(db, validSampleData({ boxId: undefined }))
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects when positionCode is an empty/whitespace string', async () => {
      const db = makeDb();

      await expect(
        sampleService.createSample(db, validSampleData({ positionCode: '   ' }))
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    it('rejects when boxId is not a valid ObjectId', async () => {
      const db = makeDb();

      await expect(
        sampleService.createSample(db, validSampleData({ boxId: 'not-an-object-id' }))
      ).rejects.toThrow(/boxId deve ser um identificador válido/);
    });

    it('rejects when boxId is provided but does not exist', async () => {
      const db = makeDb();
      db.collections.patients.findOne.mockResolvedValue({ participantId: '12345678' });
      db.collections.storageBoxes.findOne.mockResolvedValue(null);

      await expect(
        sampleService.createSample(db, validSampleData())
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    it('resolves collectionSite (ELM-0128) against a real Organization and stores it', async () => {
      const db = makeDb({ organizations: makeCollection('organizations') });
      mockOperationalStorage(db);
      db.collections.organizations.findOne.mockResolvedValue({ organizationId: 'org-uuid-123' });

      const result = await sampleService.createSample(db, validSampleData({ collectionSite: 'org-uuid-123' }));

      expect(db.collections.organizations.findOne).toHaveBeenCalledWith({ organizationId: 'org-uuid-123' });
      expect(result.collectionSite).toBe('org-uuid-123');
    });

    // #1192: Sample.organizationId, the tenancy key, is stamped from the
    // caller's server-built options only, never from the sample data.
    it('stores the organizationId option as the sample organizationId (#1192)', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      await sampleService.createSample(db, validSampleData(), { organizationId: 'org-1' });

      expect(db.collections.samples.insertOne.mock.calls[0][0].organizationId).toBe('org-1');
    });

    it('stores a null organizationId when the caller passes no option (#1192)', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      await sampleService.createSample(db, validSampleData());

      expect(db.collections.samples.insertOne.mock.calls[0][0].organizationId).toBeNull();
    });

    it('never takes organizationId from the sample data (#1192)', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      await sampleService.createSample(db, validSampleData({ organizationId: 'org-evil' }));

      expect(db.collections.samples.insertOne.mock.calls[0][0].organizationId).toBeNull();
    });

    it('rejects with 404 when collectionSite does not resolve to an Organization', async () => {
      const db = makeDb({ organizations: makeCollection('organizations') });
      mockOperationalStorage(db);
      db.collections.organizations.findOne.mockResolvedValue(null);

      await expect(
        sampleService.createSample(db, validSampleData({ collectionSite: 'org-does-not-exist' }))
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('accepts an active study and an approved protocol (RF021 AC#5, #591)', async () => {
      const db = makeDb({ studies: makeCollection('studies'), protocols: makeCollection('protocols') });
      mockOperationalStorage(db);
      db.collections.studies.findOne.mockResolvedValue({ studyId: 'STU-1', studyStatus: 'active' });
      db.collections.protocols.findOne.mockResolvedValue({ protocolId: 'PRO-1', approvalStatus: 'approved' });

      const result = await sampleService.createSample(db, validSampleData({ studyId: 'STU-1', protocolId: 'PRO-1' }));

      expect(result.studyId).toBe('STU-1');
      expect(result.protocolId).toBe('PRO-1');
    });

    it('rejects with 422 when the study is not active (RF021 AC#5, #591)', async () => {
      const db = makeDb({ studies: makeCollection('studies') });
      mockOperationalStorage(db);
      db.collections.studies.findOne.mockResolvedValue({ studyId: 'STU-1', studyStatus: 'closed-to-accrual' });

      await expect(
        sampleService.createSample(db, validSampleData({ studyId: 'STU-1' }))
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
    });

    it('rejects with 422 when the protocol is not approved (RF021 AC#5, #591)', async () => {
      const db = makeDb({ protocols: makeCollection('protocols') });
      mockOperationalStorage(db);
      db.collections.protocols.findOne.mockResolvedValue({ protocolId: 'PRO-1', approvalStatus: 'draft' });

      await expect(
        sampleService.createSample(db, validSampleData({ protocolId: 'PRO-1' }))
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
    });

    it('rejects with 422 when the protocol is retired (RF021 AC#5, #591)', async () => {
      const db = makeDb({ protocols: makeCollection('protocols') });
      mockOperationalStorage(db);
      db.collections.protocols.findOne.mockResolvedValue({ protocolId: 'PRO-1', approvalStatus: 'retired' });

      await expect(
        sampleService.createSample(db, validSampleData({ protocolId: 'PRO-1' }))
      ).rejects.toMatchObject({ statusCode: 422 });
    });

    // RF004 AC3/AC4/AC7: a collection admits a specimen only with the one
    // context its regime names and an approval in force.
    const GOVERNED = {
      collectionId: 'COL-1',
      governanceRegime: 'biorepository',
      governanceContext: {
        biorepositoryContextId: 'ctx-1', studyId: 'STU-1', protocolId: 'PRO-1', ethicsApprovalId: 'APR-1',
        validityPeriod: { start: '2020-01-01', end: null },
      },
    };
    const IN_FORCE = { approvalId: 'APR-1', collectionId: 'COL-1', status: 'active', effectivePeriod: { start: '2020-01-01', end: null } };

    function governedDb(collectionDoc, approvals) {
      const db = makeDb({ collections: makeCollection('collections'), collectionGovernanceApprovals: makeCollection('collectionGovernanceApprovals') });
      mockOperationalStorage(db);
      db.collections.collections.findOne.mockResolvedValue(collectionDoc);
      db.collections.collectionGovernanceApprovals.find.mockReturnValue(makeCursor(approvals));
      return db;
    }

    it('rejects with 422 a collection with a regime and no governance context', async () => {
      const db = governedDb({ collectionId: 'COL-1', governanceRegime: 'biorepository' }, []);

      await expect(
        sampleService.createSample(db, validSampleData({ collectionId: 'COL-1' }))
      ).rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/sem contexto de governança/) });
      expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
    });

    it('rejects with 422 a governed collection whose approval is suspended', async () => {
      const db = governedDb(GOVERNED, [{ ...IN_FORCE, status: 'suspended' }]);

      await expect(
        sampleService.createSample(db, validSampleData({ collectionId: 'COL-1' }))
      ).rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/sem aprovação de governança vigente/) });
    });

    it('accepts a specimen into a governed collection with its approval in force', async () => {
      const db = governedDb(GOVERNED, [IN_FORCE]);

      const result = await sampleService.createSample(db, validSampleData({ collectionId: 'COL-1' }));

      expect(result.collectionId).toBe('COL-1');
    });

    it('rejects with 422 a biorepository specimen naming another study (RF004 AC4)', async () => {
      const db = governedDb(GOVERNED, [IN_FORCE]);
      db.collections.studies = makeCollection('studies');
      db.collections.studies.findOne.mockResolvedValue({ studyId: 'STU-2', studyStatus: 'active' });

      await expect(
        sampleService.createSample(db, validSampleData({ collectionId: 'COL-1', studyId: 'STU-2' }))
      ).rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/studyId STU-2 difere/) });
    });

    it('rolls back the inserted sample when the ledger append fails', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collections.sample_movements.insertOne.mockRejectedValue(new Error('ledger down'));

      await expect(sampleService.createSample(db, validSampleData())).rejects.toThrow(
        /Falha ao registrar cadeia de custódia/
      );
      expect(db.collections.samples.deleteOne).toHaveBeenCalledWith({ _id: 'generated-id' });
    });

    // #1378: without a transaction a failed label issue deletes the inserted
    // sample, as a failed allocation does.
    it('rolls back the inserted sample when its code is already an active label (#1378)', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collections.labelIdentifiers = makeCollection('labelIdentifiers');
      db.collections.labelIdentifiers.insertOne.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

      await expect(sampleService.createSample(db, validSampleData())).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(/^Falha ao emitir a etiqueta da amostra: Valor BR-TEST-001 já ativo/)
      });
      expect(db.collections.samples.deleteOne).toHaveBeenCalledWith({ _id: 'generated-id' });
    });

    // #1378: once the migration window is closed, the code is issued only as
    // the label; the inserted sample carries no Sample.barcode (ELM-0116).
    it('with the barcode window closed, inserts no barcode while the label and the birth movement carry the code (#1378)', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      await withBarcodeWindowClosed(() => sampleService.createSample(db, validSampleData()));

      const [insertedSample] = db.collections.samples.insertOne.mock.calls[0];
      expect(insertedSample).not.toHaveProperty('barcode');
      expect(db.collections.labelIdentifiers.insertOne).toHaveBeenCalledTimes(1);
      expect(db.collections.labelIdentifiers.insertOne.mock.calls[0][0]).toMatchObject({ encodedValue: 'BR-TEST-001', status: 'active' });
      const [birthMovement] = db.collections.sample_movements.insertOne.mock.calls[0];
      expect(birthMovement).toMatchObject({ type: 'create', barcode: 'BR-TEST-001' });
    });

    // RF023 AC3, RNF019 C1: the create's insert, birth movement, allocation,
    // SPECIMEN_UPSERTED and the caller's in-transaction step commit in one
    // transaction where the deployment runs one.
    describe('one transaction where one runs (#1367)', () => {
      const OUTBOX = 'graph_projection_outbox';

      // A replica-set `hello`, and a session that applies the writes made
      // with it only when the transaction body returns: a throw discards
      // them, as the server's abort does.
      //
      // #1369: the counters collection keeps the server's rule too. A counter
      // document written outside the session while the transaction runs
      // commits after its snapshot, so the transaction's own later write to
      // that document raises WriteConflict.
      function makeTransactionalDb() {
        // #1378: the label the create issues on the allocated container.
        const db = makeDb({ [OUTBOX]: makeCollection(OUTBOX), labelIdentifiers: makeChainCollection('labelIdentifiers') });
        mockOperationalStorage(db);
        db.client.db = vi.fn(() => ({ command: vi.fn().mockResolvedValue({ setName: 'rs0' }) }));
        // As the driver does, a second startSession is a session of its own,
        // so a write in a transaction a callee opens is not the create's.
        db.client.startSession.mockImplementationOnce(() => db.session).mockImplementation(() => makeSession());

        const committed = { samples: [], sample_movements: [] };
        const transaction = { inBody: false };
        const writtenOutside = new Set();
        let staged = [];
        db.session.withTransaction = vi.fn(async (body) => {
          staged = [];
          writtenOutside.clear();
          transaction.inBody = true;
          try {
            await body();
          } catch (error) {
            staged = [];
            throw error;
          } finally {
            transaction.inBody = false;
          }
          for (const [name, doc] of staged) committed[name].push(doc);
        });
        const counterUpdate = db.collections.counters.findOneAndUpdate;
        db.collections.counters.findOneAndUpdate = vi.fn(async (query, update, options) => {
          if (transaction.inBody) {
            if (options?.session !== db.session) {
              writtenOutside.add(query._id);
            } else if (writtenOutside.has(query._id)) {
              throw new MongoServerError({
                message: 'Caused by :: Write conflict during plan execution and yielding is disabled. :: Please retry your operation or multi-document transaction.',
                code: 112,
                codeName: 'WriteConflict',
                errorLabels: ['TransientTransactionError']
              });
            }
          }
          return counterUpdate(query, update, options);
        });
        const stagedInsert = (name) => vi.fn(async (doc, options) => {
          if (name === 'samples') db.insertedSamples.push(doc);
          if (options?.session === db.session) staged.push([name, doc]);
          else committed[name].push(doc);
          return { insertedId: 'generated-id' };
        });
        db.collections.samples.insertOne = stagedInsert('samples');
        db.collections.sample_movements.insertOne = stagedInsert('sample_movements');
        return { db, committed, transaction };
      }

      const outboxCall = (db, eventType) => db.collections[OUTBOX].updateOne.mock.calls
        .find(([, update]) => update?.$setOnInsert?.eventType === eventType);

      it('writes the insert, both movements, the allocation and both outbox appends with the one session, and hands it to the caller step', async () => {
        const { db, committed } = makeTransactionalDb();
        const onCreatedInTransaction = vi.fn().mockResolvedValue(undefined);

        const result = await sampleService.createSample(db, validSampleData(), { onCreatedInTransaction });

        expect(result._id).toBe('generated-id');
        expect(db.client.startSession).toHaveBeenCalledTimes(1);
        expect(db.session.withTransaction).toHaveBeenCalledTimes(1);

        expect(db.collections.samples.insertOne.mock.calls[0][1]).toEqual({ session: db.session });
        const movementSessions = db.collections.sample_movements.insertOne.mock.calls.map(([doc, options]) => [doc.type, options?.session]);
        expect(movementSessions).toEqual([['create', db.session], ['allocate', db.session]]);
        expect(db.collection('storageBoxes').updateOne.mock.calls[0][2]).toEqual({ session: db.session });
        expect(db.collections.samples.updateOne.mock.calls[0][2]).toEqual({ session: db.session });
        // #1374: the allocation's chain writes take the create's session.
        for (const name of ['containers', 'specimenContainerAssignments', 'containerPositionAssignments']) {
          const inserts = db.collections[name].insertOne.mock.calls;
          expect(inserts).toHaveLength(1);
          expect(inserts[0][1]).toEqual({ session: db.session });
        }
        expect(db.collection('storageAssignments').insertOne).not.toHaveBeenCalled();

        const specimenUpserted = outboxCall(db, 'SPECIMEN_UPSERTED');
        expect(specimenUpserted).toBeDefined();
        expect(specimenUpserted[2]).toEqual({ upsert: true, session: db.session });
        const allocateCustody = outboxCall(db, 'CUSTODY_EVENT_RECORDED');
        expect(allocateCustody[1].$setOnInsert.payload.custodyEventType).toBe('allocate');
        expect(allocateCustody[2]).toEqual({ upsert: true, session: db.session });

        expect(onCreatedInTransaction).toHaveBeenCalledTimes(1);
        expect(onCreatedInTransaction).toHaveBeenCalledWith(
          expect.objectContaining({ _id: 'generated-id', barcode: 'BR-TEST-001' }),
          db.session
        );
        expect(committed.samples).toHaveLength(1);
        expect(committed.sample_movements).toHaveLength(2);
      });

      it('takes the birth movement id in the create\'s session, so the allocation\'s audit id does not conflict with it (#1369)', async () => {
        const { db, committed } = makeTransactionalDb();

        await expect(sampleService.createSample(db, validSampleData(), { onCreatedInTransaction: vi.fn() }))
          .resolves.toMatchObject({ _id: 'generated-id' });

        expect(committed.samples).toHaveLength(1);
        expect(committed.sample_movements).toHaveLength(2);
        const movementCounterCalls = db.collections.counters.findOneAndUpdate.mock.calls
          .filter(([query]) => query._id === 'sample_movements');
        expect(movementCounterCalls).toHaveLength(2);
        for (const [, , options] of movementCounterCalls) expect(options.session).toBe(db.session);
        expect(db.collections.counters.__store.sample_movements.seq).toBe(2);
      });

      it('no document write made while the create\'s transaction runs goes outside its session (#1369)', async () => {
        const { db, transaction } = makeTransactionalDb();
        const WRITES = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'bulkWrite'];
        const outside = [];
        const watched = new WeakSet();
        const watch = (name, collection) => {
          if (!collection || watched.has(collection)) return collection;
          watched.add(collection);
          for (const method of WRITES) {
            const original = collection[method];
            if (typeof original !== 'function') continue;
            collection[method] = (...args) => {
              const options = method.startsWith('insert') || method === 'bulkWrite' ? args[1] : args[2];
              if (transaction.inBody && options?.session !== db.session) outside.push([name, method]);
              return original.apply(collection, args);
            };
          }
          return collection;
        };
        // #1374, #1378: kept before the watch wraps them, to show the chain
        // and the label were written.
        const chainInserts = [...CHAIN_COLLECTIONS, 'labelIdentifiers'].map((name) => [name, db.collections[name].insertOne]);
        for (const [name, collection] of Object.entries(db.collections)) watch(name, collection);
        const resolve = db.collection.getMockImplementation();
        db.collection.mockImplementation((name) => watch(name, resolve(name)));

        await expect(sampleService.createSample(db, validSampleData()))
          .resolves.toMatchObject({ _id: 'generated-id' });

        const written = chainInserts.filter(([, insertOne]) => insertOne.mock.calls.length > 0).map(([name]) => name);
        expect(written).toEqual(['containers', 'specimenContainerAssignments', 'containerPositionAssignments', 'labelIdentifiers']);
        expect(outside).toEqual([]);
      });

      it('#1368: no document write made while a derivative\'s create transaction runs goes outside its session', async () => {
        const { db, transaction } = makeTransactionalDb();
        seedParents(db, [parentSample()]);
        const outboxUpdate = db.collections[OUTBOX].updateOne;
        const labelInsert = db.collections.labelIdentifiers.insertOne;
        const WRITES =['insertOne', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'bulkWrite'];
        const outside = [];
        const watched = new WeakSet();
        const watch = (name, collection) => {
          if (!collection || watched.has(collection)) return collection;
          watched.add(collection);
          for (const method of WRITES) {
            const original = collection[method];
            if (typeof original !== 'function') continue;
            collection[method] = (...args) => {
              const options = method.startsWith('insert') || method === 'bulkWrite' ? args[1] : args[2];
              if (transaction.inBody && options?.session !== db.session) outside.push([name, method]);
              return original.apply(collection, args);
            };
          }
          return collection;
        };
        for (const [name, collection] of Object.entries(db.collections)) watch(name, collection);
        const resolve = db.collection.getMockImplementation();
        db.collection.mockImplementation((name) => watch(name, resolve(name)));

        await expect(sampleService.createSample(db, validSampleData({ parentSpecimenIds: ['SP-PARENT'] })))
          .resolves.toMatchObject({ _id: 'generated-id' });

        expect(outboxUpdate.mock.calls.map(([, update]) => update?.$setOnInsert?.eventType)).toContain('LINEAGE_REGISTERED');
        expect(labelInsert).toHaveBeenCalledTimes(1);
        expect(outside).toEqual([]);
      });

      // #1378: the sample's code is issued as a LabelIdentifier on the
      // container the allocation loaded, in the create's session.
      it('issues one active LabelIdentifier for the barcode on the allocated container, in the create\'s session (#1378)', async () => {
        const { db, committed } = makeTransactionalDb();

        await sampleService.createSample(db, validSampleData(), { auditInfo: { userId: 'user-7' } });

        const containerInserts = db.collections.containers.insertOne.mock.calls;
        expect(containerInserts).toHaveLength(1);
        const labelInserts = db.collections.labelIdentifiers.insertOne.mock.calls;
        expect(labelInserts).toHaveLength(1);
        const [label, options] = labelInserts[0];
        expect(options).toEqual({ session: db.session });
        expect(label).toMatchObject({
          encodedValue: 'BR-TEST-001',
          targetType: 'container',
          targetId: containerInserts[0][0].containerId,
          identifierOrigin: 'institution_applied',
          status: 'active',
          printBatchId: null,
          issuedBy: 'user-7'
        });
        expect(committed.samples).toEqual([expect.objectContaining({ barcode: 'BR-TEST-001' })]);
      });

      it('with the barcode window closed, commits a sample with no barcode while the label and the birth movement carry the code (#1378)', async () => {
        const { db, committed } = makeTransactionalDb();

        await withBarcodeWindowClosed(() => sampleService.createSample(db, validSampleData()));

        expect(committed.samples).toHaveLength(1);
        expect(committed.samples[0]).not.toHaveProperty('barcode');
        const labelInserts = db.collections.labelIdentifiers.insertOne.mock.calls;
        expect(labelInserts).toHaveLength(1);
        expect(labelInserts[0][0]).toMatchObject({ encodedValue: 'BR-TEST-001', status: 'active' });
        expect(labelInserts[0][1]).toEqual({ session: db.session });
        expect(committed.sample_movements[0]).toMatchObject({ type: 'create', barcode: 'BR-TEST-001' });
      });

      it('a code already active as a label aborts the create with 409: nothing committed, no compensating delete (#1378)', async () => {
        const { db, committed } = makeTransactionalDb();
        db.collections.labelIdentifiers.insertOne.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
        const onCreatedInTransaction = vi.fn();

        await expect(sampleService.createSample(db, validSampleData(), { onCreatedInTransaction })).rejects.toMatchObject({
          statusCode: 409,
          message: expect.stringMatching(/^Falha ao emitir a etiqueta da amostra: Valor BR-TEST-001 já ativo/)
        });

        expect(committed.samples).toEqual([]);
        expect(committed.sample_movements).toEqual([]);
        expect(db.collections.samples.deleteOne).not.toHaveBeenCalled();
        expect(onCreatedInTransaction).not.toHaveBeenCalled();
      });

      // #1368: a derivative's parents, found by the create's
      // samples.find({ specimenId: { $in } }) read.
      const PARENT_ID = new ObjectId();
      const seedParents = (db, parents) => {
        db.collections.samples.find = vi.fn((query) => {
          const wanted = query?.specimenId?.$in;
          return makeCursor(Array.isArray(wanted) ? parents.filter((parent) => wanted.includes(parent.specimenId)) : []);
        });
      };
      const parentSample = (overrides = {}) => ({
        _id: PARENT_ID, specimenId: 'SP-PARENT', participantId: '12345678', specimenStatus: 'available', ...overrides
      });

      it('#1368: a derivative appends one LINEAGE_REGISTERED per parent, keyed by the parent _id, in the create\'s session', async () => {
        const { db, committed } = makeTransactionalDb();
        seedParents(db, [parentSample()]);

        await sampleService.createSample(db, validSampleData({ parentSpecimenIds: ['SP-PARENT'] }));

        const lineage = outboxCall(db, 'LINEAGE_REGISTERED');
        expect(lineage).toBeDefined();
        expect(lineage[1].$setOnInsert.payload).toStrictEqual({ specimenId: 'generated-id', parentSpecimenId: String(PARENT_ID) });
        expect(lineage[2]).toEqual({ upsert: true, session: db.session });
        expect(committed.samples).toHaveLength(1);
        expect(committed.samples[0].parentSpecimenIds).toStrictEqual(['SP-PARENT']);
      });

      it('#1368: a failed LINEAGE_REGISTERED append aborts the create: nothing committed, no compensating delete', async () => {
        const { db, committed } = makeTransactionalDb();
        seedParents(db, [parentSample()]);
        db.collections[OUTBOX].updateOne.mockImplementation(async (_filter, update) => {
          if (update?.$setOnInsert?.eventType === 'LINEAGE_REGISTERED') throw new Error('outbox down');
          return { acknowledged: true };
        });
        const onCreatedInTransaction = vi.fn();

        await expect(sampleService.createSample(db, validSampleData({ parentSpecimenIds: ['SP-PARENT'] }), { onCreatedInTransaction }))
          .rejects.toThrow('outbox down');

        expect(committed.samples).toEqual([]);
        expect(committed.sample_movements).toEqual([]);
        expect(db.collections.samples.deleteOne).not.toHaveBeenCalled();
        expect(onCreatedInTransaction).not.toHaveBeenCalled();
      });

      it('#1368: a sample without parentSpecimenIds appends no LINEAGE_REGISTERED', async () => {
        const { db, committed } = makeTransactionalDb();

        await sampleService.createSample(db, validSampleData());

        expect(outboxCall(db, 'LINEAGE_REGISTERED')).toBeUndefined();
        expect(committed.samples[0].parentSpecimenIds).toStrictEqual([]);
      });

      it('#1368: an unknown parent is refused with 404 before any insert', async () => {
        const { db } = makeTransactionalDb();
        seedParents(db, []);

        await expect(sampleService.createSample(db, validSampleData({ parentSpecimenIds: ['SP-NOPE'] })))
          .rejects.toMatchObject({ statusCode: 404, message: 'parentSpecimenIds SP-NOPE não encontrado' });

        expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
        expect(db.session.withTransaction).not.toHaveBeenCalled();
      });

      it('#1368: a parent of another participant is refused with 422', async () => {
        const { db } = makeTransactionalDb();
        seedParents(db, [parentSample({ participantId: '87654321' })]);

        await expect(sampleService.createSample(db, validSampleData({ parentSpecimenIds: ['SP-PARENT'] })))
          .rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('outro participante') });

        expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
      });

      it('#1368: a closed parent is refused with 422', async () => {
        const { db } = makeTransactionalDb();
        seedParents(db, [parentSample({ specimenStatus: 'closed' })]);

        await expect(sampleService.createSample(db, validSampleData({ parentSpecimenIds: ['SP-PARENT'] })))
          .rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('encerrada') });

        expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
      });

      it('refuses a quarantined parent with 422 before any write (RF019 AC3)', async () => {
        const { db } = makeTransactionalDb();
        seedParents(db, [parentSample({ specimenStatus: 'quarantined' })]);

        await expect(sampleService.createSample(db, validSampleData({ parentSpecimenIds: ['SP-PARENT'] })))
          .rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('em quarentena') });

        expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
      });

      it('#1368: the sample named as its own parent is refused with 422', async () => {
        const { db } = makeTransactionalDb();
        seedParents(db, []);

        await expect(sampleService.createSample(db, validSampleData({ specimenId: 'SP-SELF', parentSpecimenIds: ['SP-SELF'] })))
          .rejects.toMatchObject({ statusCode: 422 });

        expect(db.collections.samples.insertOne).not.toHaveBeenCalled();
      });

      // Decided 7 of the legacy placement chain: with the create's session
      // the chain builds no index, since an index build beside the open
      // transaction is a write conflict.
      it('builds no physical-chain index while the create\'s transaction runs (#1374)', async () => {
        const { db, transaction } = makeTransactionalDb();
        const builtInside = [];
        for (const name of CHAIN_COLLECTIONS) {
          db.collections[name].createIndex.mockImplementation(async () => {
            if (transaction.inBody) builtInside.push(name);
            return true;
          });
        }

        await expect(sampleService.createSample(db, validSampleData()))
          .resolves.toMatchObject({ _id: 'generated-id' });

        expect(db.collections.containerPositionAssignments.insertOne).toHaveBeenCalledTimes(1);
        expect(builtInside).toEqual([]);
      });

      it('builds the movement indexes before the transaction opens (#1369)', async () => {
        const { db } = makeTransactionalDb();

        await sampleService.createSample(db, validSampleData());

        expect(db.collections.sample_movements.createIndex.mock.invocationCallOrder[0])
          .toBeLessThan(db.session.withTransaction.mock.invocationCallOrder[0]);
      });

      it('a failed SPECIMEN_UPSERTED append aborts the create: no sample, no movement, no compensating delete', async () => {
        const { db, committed } = makeTransactionalDb();
        db.collections[OUTBOX].updateOne.mockImplementation(async (_filter, update) => {
          if (update?.$setOnInsert?.eventType === 'SPECIMEN_UPSERTED') throw new Error('outbox down');
          return { acknowledged: true };
        });
        const onCreatedInTransaction = vi.fn();

        await expect(sampleService.createSample(db, validSampleData(), { onCreatedInTransaction }))
          .rejects.toThrow('outbox down');

        expect(db.collections.samples.insertOne).toHaveBeenCalledTimes(1);
        expect(committed.samples).toEqual([]);
        expect(committed.sample_movements).toEqual([]);
        expect(db.collections.samples.deleteOne).not.toHaveBeenCalled();
        expect(onCreatedInTransaction).not.toHaveBeenCalled();
      });

      // #1370: the driver retries the transaction body only for a MongoError
      // labelled TransientTransactionError, so such an error must leave the
      // body as itself, not inside the create's wrapper.
      const transientConflict = () => new MongoServerError({
        message: 'Write conflict during plan execution',
        code: 112,
        codeName: 'WriteConflict',
        errorLabels: ['TransientTransactionError']
      });

      it('#1370: a transient conflict from the allocation leaves the create as the same error, for the driver to retry', async () => {
        const { db } = makeTransactionalDb();
        const conflict = transientConflict();
        db.collections.containerPositionAssignments.insertOne.mockImplementation(async (_doc, options) => {
          if (options?.session === db.session) throw conflict;
          return { insertedId: 'placement-1' };
        });

        await expect(sampleService.createSample(db, validSampleData())).rejects.toBe(conflict);
      });

      it('#1370: a transient conflict from the birth movement append leaves the create as the same error', async () => {
        const { db } = makeTransactionalDb();
        const conflict = transientConflict();
        db.collections.sample_movements.insertOne = vi.fn(async (_doc, options) => {
          if (options?.session === db.session) throw conflict;
          return { insertedId: 'generated-id' };
        });

        await expect(sampleService.createSample(db, validSampleData())).rejects.toBe(conflict);
      });

      it('#1370: a MongoServerError with no transient label from the allocation keeps the wrapper and its 422', async () => {
        const { db } = makeTransactionalDb();
        const failure = new MongoServerError({ message: 'assignment write failed', code: 2 });
        db.collections.containerPositionAssignments.insertOne.mockImplementation(async (_doc, options) => {
          if (options?.session === db.session) throw failure;
          return { insertedId: 'placement-1' };
        });

        await expect(sampleService.createSample(db, validSampleData())).rejects.toMatchObject({
          statusCode: 422,
          message: expect.stringMatching(/Falha ao alocar amostra.*assignment write failed/)
        });
      });

      it('a failed caller step aborts the create the same way', async () => {
        const { db, committed } = makeTransactionalDb();
        const onCreatedInTransaction = vi.fn().mockRejectedValue(new Error('register append failed'));

        await expect(sampleService.createSample(db, validSampleData(), { onCreatedInTransaction }))
          .rejects.toThrow('register append failed');

        expect(committed.samples).toEqual([]);
        expect(committed.sample_movements).toEqual([]);
      });

      it('without a known transactional deployment the writes run in sequence as before, with no session and no caller step', async () => {
        const db = makeDb({ [OUTBOX]: makeCollection(OUTBOX) });
        mockOperationalStorage(db);
        const onCreatedInTransaction = vi.fn();

        const result = await sampleService.createSample(db, validSampleData(), { onCreatedInTransaction });

        expect(result._id).toBe('generated-id');
        expect(db.collections.samples.insertOne.mock.calls[0]).toHaveLength(1);
        expect(db.collections.sample_movements.insertOne.mock.calls[0][1]).toBeUndefined();
        expect(outboxCall(db, 'SPECIMEN_UPSERTED')[2]).toEqual({ upsert: true });
        // The allocation still opens its own transaction, as before.
        expect(db.client.startSession).toHaveBeenCalledTimes(1);
        expect(onCreatedInTransaction).not.toHaveBeenCalled();
      });

      it('a failed SPECIMEN_UPSERTED append without a transaction is logged and the sample stands, as before', async () => {
        const db = makeDb({ [OUTBOX]: makeCollection(OUTBOX) });
        mockOperationalStorage(db);
        db.collections[OUTBOX].updateOne.mockImplementation(async (_filter, update) => {
          if (update?.$setOnInsert?.eventType === 'SPECIMEN_UPSERTED') throw new Error('outbox down');
          return { acknowledged: true };
        });

        const result = await sampleService.createSample(db, validSampleData());

        expect(result._id).toBe('generated-id');
        expect(db.collections.samples.deleteOne).not.toHaveBeenCalled();
      });

      it('#1368: without a transaction the lineage is appended after the insert, and a failed append is logged while the sample stands', async () => {
        const db = makeDb({ [OUTBOX]: makeCollection(OUTBOX) });
        mockOperationalStorage(db);
        seedParents(db, [parentSample()]);
        db.collections[OUTBOX].updateOne.mockImplementation(async (_filter, update) => {
          if (update?.$setOnInsert?.eventType === 'LINEAGE_REGISTERED') throw new Error('outbox down');
          return { acknowledged: true };
        });
        const errorSpy = vi.spyOn(require('../../src/utils/logger'), 'error').mockImplementation(() => {});

        const result = await sampleService.createSample(db, validSampleData({ parentSpecimenIds: ['SP-PARENT'] }));

        expect(result._id).toBe('generated-id');
        const outboxUpdate = db.collections[OUTBOX].updateOne.mock;
        const lineage = outboxCall(db, 'LINEAGE_REGISTERED');
        expect(lineage[1].$setOnInsert.payload).toStrictEqual({ specimenId: 'generated-id', parentSpecimenId: String(PARENT_ID) });
        expect(lineage[2]).toEqual({ upsert: true });
        expect(outboxUpdate.invocationCallOrder[outboxUpdate.calls.indexOf(lineage)])
          .toBeGreaterThan(db.collections.samples.insertOne.mock.invocationCallOrder[0]);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('LINEAGE_REGISTERED nao registrado'));
        expect(db.collections.samples.deleteOne).not.toHaveBeenCalled();
      });

      it('a known standalone deployment keeps today\'s outcome: the allocation refuses and the inserted sample is deleted', async () => {
        const db = makeDb({ [OUTBOX]: makeCollection(OUTBOX) });
        mockOperationalStorage(db);
        db.client.db = vi.fn(() => ({ command: vi.fn().mockResolvedValue({ ismaster: true }) }));
        const onCreatedInTransaction = vi.fn();

        await expect(sampleService.createSample(db, validSampleData(), { onCreatedInTransaction }))
          .rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/Falha ao alocar amostra.*replica set/) });

        expect(db.collections.samples.insertOne.mock.calls[0]).toHaveLength(1);
        expect(db.collections.samples.deleteOne).toHaveBeenCalledWith({ _id: 'generated-id' });
        expect(db.client.startSession).not.toHaveBeenCalled();
        expect(onCreatedInTransaction).not.toHaveBeenCalled();
      });
    });

    it('generates a specimenId automatically when none is provided', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      const result = await sampleService.createSample(db, validSampleData({ specimenId: undefined }));

      expect(result.specimenId).toBeDefined();
      expect(db.collections.samples.insertOne).toHaveBeenCalledTimes(1);
    });

    it('rejects when quantity is a numeric string instead of a number', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      await expect(
        sampleService.createSample(db, validSampleData({ quantity: '10' }))
      ).rejects.toThrow(/Quantidade deve ser um número maior que zero/);
    });

    // Fixed per issue #253: the malformed-format guard now uses a synchronous
    // regex check (mirroring validateParticipantId's own internal check)
    // instead of calling the async validateParticipantId without db/await.
    // A malformed participantId now correctly throws 400 "inválido" instead
    // of falling through to the existence check's 404 "não encontrado".
    it('returns 400 (participantId inválido) for a malformed participantId, per issue #253', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      await expect(
        sampleService.createSample(db, validSampleData({ participantId: 'not-8-digits' }))
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('participantId inválido') });
    });

    it('rejects when the box resolves to a hierarchy whose freezer has no linked equipment registered', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collection.mockImplementation((name) => {
        if (name === 'storageBoxes') return { findOne: vi.fn().mockResolvedValue({ _id: BOX_ID, parent_id: RACK_ID }) };
        if (name === 'storageContainers') {
          const containersById = new Map([
            [String(RACK_ID), { _id: RACK_ID, containerType: 'RACK', parent_id: SHELF_ID }],
            [String(SHELF_ID), { _id: SHELF_ID, containerType: 'SHELF', parent_id: FREEZER_ID }],
            [String(FREEZER_ID), { _id: FREEZER_ID, containerType: 'FREEZER', containerID: 'EQ-1', parent_id: null }]
          ]);
          return { findOne: vi.fn((query) => Promise.resolve(containersById.get(String(query._id)) || null)) };
        }
        if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue(null) };
        return db.collections[name] || (db.collections[name] = makeCollection(name));
      });

      await expect(
        sampleService.createSample(db, validSampleData())
      ).rejects.toThrow(/Equipamento vinculado à localização física não está cadastrado/);
    });

    it('rejects when the box hierarchy has no FREEZER at its root', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collection.mockImplementation((name) => {
        if (name === 'storageBoxes') return { findOne: vi.fn().mockResolvedValue({ _id: BOX_ID, parent_id: RACK_ID }) };
        if (name === 'storageContainers') return { findOne: vi.fn().mockResolvedValue(null) };
        return db.collections[name] || (db.collections[name] = makeCollection(name));
      });

      await expect(
        sampleService.createSample(db, validSampleData())
      ).rejects.toThrow(/hierarquia de armazenamento incompleta/);
    });

    it('rejects when the linked equipment is in a blocked status, per issue #470', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collection.mockImplementation((name) => {
        if (name === 'storageBoxes') return { findOne: vi.fn().mockResolvedValue({ _id: BOX_ID, parent_id: RACK_ID }) };
        if (name === 'storageContainers') {
          const containersById = new Map([
            [String(RACK_ID), { _id: RACK_ID, containerType: 'RACK', parent_id: SHELF_ID }],
            [String(SHELF_ID), { _id: SHELF_ID, containerType: 'SHELF', parent_id: FREEZER_ID }],
            [String(FREEZER_ID), { _id: FREEZER_ID, containerType: 'FREEZER', containerID: 'EQ-1', parent_id: null }]
          ]);
          return { findOne: vi.fn((query) => Promise.resolve(containersById.get(String(query._id)) || null)) };
        }
        if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1', status: 'maintenance' }) };
        return db.collections[name] || (db.collections[name] = makeCollection(name));
      });

      await expect(
        sampleService.createSample(db, validSampleData())
      ).rejects.toThrow(/Equipamento vinculado à localização física não está operacional/);
    });

    it('rejects when no sensor is associated with the resolved freezer', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collection.mockImplementation((name) => {
        if (name === 'sensors') return { findOne: vi.fn().mockResolvedValue(null) };
        if (name === 'storageBoxes') return { findOne: vi.fn().mockResolvedValue({ _id: BOX_ID, parent_id: RACK_ID }) };
        if (name === 'storageContainers') {
          const containersById = new Map([
            [String(RACK_ID), { _id: RACK_ID, containerType: 'RACK', parent_id: SHELF_ID }],
            [String(SHELF_ID), { _id: SHELF_ID, containerType: 'SHELF', parent_id: FREEZER_ID }],
            [String(FREEZER_ID), { _id: FREEZER_ID, containerType: 'FREEZER', containerID: 'EQ-1', parent_id: null }]
          ]);
          return { findOne: vi.fn((query) => Promise.resolve(containersById.get(String(query._id)) || null)) };
        }
        if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1' }) };
        return db.collections[name] || (db.collections[name] = makeCollection(name));
      });

      await expect(
        sampleService.createSample(db, validSampleData())
      ).rejects.toThrow(/Localização física sem sensor operacional associado/);
    });

    it('rejects with the sensor status in the message when the sensor is under maintenance', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collection.mockImplementation((name) => {
        if (name === 'sensors') return { findOne: vi.fn().mockResolvedValue({ status: 'maintenance' }) };
        if (name === 'storageBoxes') return { findOne: vi.fn().mockResolvedValue({ _id: BOX_ID, parent_id: RACK_ID }) };
        if (name === 'storageContainers') {
          const containersById = new Map([
            [String(RACK_ID), { _id: RACK_ID, containerType: 'RACK', parent_id: SHELF_ID }],
            [String(SHELF_ID), { _id: SHELF_ID, containerType: 'SHELF', parent_id: FREEZER_ID }],
            [String(FREEZER_ID), { _id: FREEZER_ID, containerType: 'FREEZER', containerID: 'EQ-1', parent_id: null }]
          ]);
          return { findOne: vi.fn((query) => Promise.resolve(containersById.get(String(query._id)) || null)) };
        }
        if (name === 'equipment') return { findOne: vi.fn().mockResolvedValue({ equipmentID: 'EQ-1' }) };
        return db.collections[name] || (db.collections[name] = makeCollection(name));
      });

      await expect(
        sampleService.createSample(db, validSampleData())
      ).rejects.toThrow(/Sensor atual está em status maintenance/);
    });

    it('does not persist a client-supplied legacy location object (#400 — severed in favor of storageLocation/storageBoxes)', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      const location = { freezer: 'F1', rack: 'R1', box: 'B1', position: 'A1' };

      await sampleService.createSample(db, validSampleData({ location }));

      const [insertedSample] = db.collections.samples.insertOne.mock.calls[0];
      expect(insertedSample.location).toBeUndefined();
    });

    it('generates a barcode automatically when none is provided', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      const result = await sampleService.createSample(db, validSampleData({ barcode: undefined }));

      expect(result.barcode).toBeDefined();
      expect(typeof result.barcode).toBe('string');
    });

    // #492: live POST /api/samples registration didn't compute or record
    // RCS at all — this mirrors the pattern import.service.js's CSV/XLSX
    // branch already uses (qualityDomain.resolveMethodologicalQuality ->
    // rcsAssessmentService.recordAssessment -> sealedRcsAssessmentId pin,
    // #499/#502), applied to the live registration path.
    describe('RCS server-side computation (#492)', () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('computes RCS via qualityDomain when sprec is provided, records an RcsAssessment, and pins sealedRcsAssessmentId', async () => {
        const db = makeDb();
        mockOperationalStorage(db);
        // Mirrors the real MongoDB driver, which mutates the passed document
        // with the generated _id (see import-lgpd.service.importSamples.unit.test.js's
        // rcsAssessmentsCollection for the same pattern, #499).
        db.collections.rcsAssessments = {
          insertOne: vi.fn().mockImplementation((doc) => {
            doc._id = 'assessment-1';
            return Promise.resolve({ insertedId: 'assessment-1' });
          })
        };
        vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
          governance_status: 1,
          final_grade: 'A',
          rcs_score: 87.5,
          score_based_grade: 'A',
          model_version: 'v1',
          matrix_type: 'PLASMA',
          governance_failure_reasons: [],
          governance_rule_codes: [],
          grade_route: 'DIRECT',
          axis_penalties: [],
          calculation_trace: {}
        });

        const sprec = { matrixType: 'PLASMA', sampleType: 'PLASMA' };
        const result = await sampleService.createSample(db, validSampleData({ sprec }));

        expect(qualityDomain.resolveMethodologicalQuality).toHaveBeenCalledWith({ sprec });
        expect(db.collections.rcsAssessments.insertOne).toHaveBeenCalledTimes(1);
        const recorded = db.collections.rcsAssessments.insertOne.mock.calls[0][0];
        expect(recorded.specimenId).toBe(String(result.specimenId));
        expect(recorded.rcsScore).toBe(87.5);
        expect(recorded.scoreBasedGrade).toBe('A');
        expect(db.collections.samples.updateOne).toHaveBeenCalledWith(
          { _id: 'generated-id' },
          { $set: { sealedRcsAssessmentId: 'assessment-1' } }
        );
        expect(result.sealedRcsAssessmentId).toBe('assessment-1');
        expect(result.rcsScore).toBe(87.5);
        expect(result.finalGrade).toBe('A');
      });

      it('does not compute or record RCS when no sprec is provided, matching current behavior', async () => {
        const db = makeDb();
        mockOperationalStorage(db);
        const spy = vi.spyOn(qualityDomain, 'resolveMethodologicalQuality');

        const result = await sampleService.createSample(db, validSampleData());

        expect(spy).not.toHaveBeenCalled();
        expect(db.collections.rcsAssessments).toBeUndefined();
        expect(result.sealedRcsAssessmentId ?? null).toBeNull();
      });

      // RF018 AC2 (#1320): a body's use context reaches the assessment.
      const qualificationContext = {
        intendedUseCode: 'research-sequencing', targetAnalyte: 'cfDNA', assayFamily: 'sequencing',
        workflowProtocolId: 'p1', workflowProtocolVersion: '1.0'
      };

      it('passes the body qualificationContext on to resolveMethodologicalQuality (RF018 AC2)', async () => {
        const db = makeDb();
        mockOperationalStorage(db);
        db.collections.rcsAssessments = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'assessment-1' }) };
        vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
          governance_status: 1,
          final_grade: 'A',
          rcs_score: 87.5
        });

        const sprec = { matrixType: 'PLASMA', sampleType: 'PLASMA' };
        await sampleService.createSample(db, validSampleData({ sprec, qualificationContext }));

        expect(qualityDomain.resolveMethodologicalQuality).toHaveBeenCalledWith({ sprec, qualificationContext });
      });

      it('records the body qualificationContext on the RcsAssessment document (RF018 AC2)', async () => {
        const db = makeDb();
        mockOperationalStorage(db);
        const fakeCollection = () => ({
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'ignored' }),
          deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 })
        });
        db.collections.rcsAssessments = fakeCollection();
        db.collections.rcsInputSnapshots = fakeCollection();
        db.collections.rcsGovernanceEvidenceSnapshots = fakeCollection();
        const sprec = {
          matrixType: 'fluid', sampleType: 'SER', primaryContainer: 'SST', preCentrifugation: 'A', centrifugation: 'B',
          secondCentrifugation: 'N', postCentrifugationDelay: 'A', longTermStorage: 'A'
        };

        await sampleService.createSample(db, validSampleData({ sprec, qualificationContext }));

        expect(db.collections.rcsAssessments.insertOne).toHaveBeenCalledTimes(1);
        expect(db.collections.rcsAssessments.insertOne.mock.calls[0][0].qualificationContext).toEqual(qualificationContext);
        const inserted = db.collections.rcsAssessments.insertOne.mock.calls[0][0];
        expect(inserted.assayFamily).toBe(qualificationContext.assayFamily);
        expect(inserted.workflowProtocolId).toBe(qualificationContext.workflowProtocolId);
        expect(inserted.workflowProtocolVersion).toBe(qualificationContext.workflowProtocolVersion);
        expect(inserted.intendedUseCode).toBe(qualificationContext.intendedUseCode);
        expect(inserted.targetAnalyte).toBe(qualificationContext.targetAnalyte);
      });

      it('does not fail sample creation when recording the RcsAssessment snapshot rejects', async () => {
        const db = makeDb();
        mockOperationalStorage(db);
        db.collections.rcsAssessments = {
          insertOne: vi.fn().mockRejectedValue(new Error('mongo down'))
        };
        vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
          governance_status: 1,
          final_grade: 'A',
          rcs_score: 87.5
        });

        const result = await sampleService.createSample(db, validSampleData({ sprec: { matrixType: 'PLASMA' } }));

        expect(result._id).toBe('generated-id');
        expect(db.collections.samples.updateOne).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ $set: expect.objectContaining({ sealedRcsAssessmentId: expect.anything() }) })
        );
      });
    });

    // #524: live POST /api/samples registration computes RCS (#492) but never
    // recorded a referenced SpecimenPreanalytics snapshot for the same sprec
    // payload — unlike import.service.js (#502), import-lgpd.service.js
    // (#503), and intakeWizard.js (#505), which all already call
    // specimenPreanalyticsService.recordProfile.
    describe('SpecimenPreanalytics snapshot recording (#524)', () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it('records a referenced SpecimenPreanalytics snapshot and pins sealedSpecimenPreanalyticsId when sprec is provided', async () => {
        const db = makeDb();
        mockOperationalStorage(db);
        // Mirrors the real MongoDB driver, which mutates the passed document
        // with the generated _id (same pattern the RCS test above and
        // import.service.sprec.test.js use for their own referenced-snapshot
        // collections).
        db.collections.specimenPreanalytics = {
          insertOne: vi.fn().mockImplementation((doc) => {
            doc._id = 'profile-1';
            return Promise.resolve({ insertedId: 'profile-1' });
          })
        };

        const sprec = { matrixType: 'PLASMA', sampleType: 'PLASMA' };
        const result = await sampleService.createSample(db, validSampleData({ sprec }));

        expect(db.collections.specimenPreanalytics.insertOne).toHaveBeenCalledTimes(1);
        const recorded = db.collections.specimenPreanalytics.insertOne.mock.calls[0][0];
        expect(recorded.specimenId).toBe(String(result.specimenId));
        expect(db.collections.samples.updateOne).toHaveBeenCalledWith(
          { _id: 'generated-id' },
          { $set: { sealedSpecimenPreanalyticsId: 'profile-1' } }
        );
        expect(result.sealedSpecimenPreanalyticsId).toBe('profile-1');
      });

      it('does not record a SpecimenPreanalytics snapshot when no sprec is provided', async () => {
        const db = makeDb();
        mockOperationalStorage(db);

        const result = await sampleService.createSample(db, validSampleData());

        expect(db.collections.specimenPreanalytics).toBeUndefined();
        expect(result.sealedSpecimenPreanalyticsId ?? null).toBeNull();
      });

      it('does not fail sample creation when recording the SpecimenPreanalytics snapshot rejects', async () => {
        const db = makeDb();
        mockOperationalStorage(db);
        db.collections.specimenPreanalytics = {
          insertOne: vi.fn().mockRejectedValue(new Error('mongo down'))
        };

        const result = await sampleService.createSample(db, validSampleData({ sprec: { matrixType: 'PLASMA' } }));

        expect(result._id).toBe('generated-id');
        expect(db.collections.samples.updateOne).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ $set: expect.objectContaining({ sealedSpecimenPreanalyticsId: expect.anything() }) })
        );
      });
    });
  });

  // -------------------------------------------------------------------
  describe('withdrawSample', () => {
    function existingSample(overrides = {}) {
      return {
        _id: 'sample-1',
        barcode: 'BR-1',
        currentStatus: 'Available',
        quantity: 10,
        initialQuantity: 10,
        currentQuantity: 10,
        totalWithdrawn: 0,
        unit: 'µL',
        ...overrides
      };
    }

    it('performs a total withdrawal and updates the sample', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      const result = await sampleService.withdrawSample(db, 'sample-1', {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      });

      expect(result.success).toBe(true);
      expect(result.withdrawnQuantity).toBe(10);
      expect(result.remainingQuantity).toBe(0);
      expect(db.collections.samples.updateOne).toHaveBeenCalledTimes(1);
      const [, updateArg] = db.collections.samples.updateOne.mock.calls[0];
      expect(updateArg.$set.currentQuantity).toBe(0);
      // RF006 AC2/AC3: a withdrawal moves quantityStatus; specimenStatus is
      // not written. The legacy lifecycleStatus/availabilityStatus
      // dual-write was removed in #408.
      expect(updateArg.$set.quantityStatus).toBe('depleted');
      expect(updateArg.$set.specimenStatus).toBeUndefined();
      expect(updateArg.$set.lifecycleStatus).toBeUndefined();
      expect(updateArg.$set.availabilityStatus).toBeUndefined();
      expect(result).toMatchObject({ newStatus: 'available', quantityStatus: 'depleted' });
    });

    it('moves quantityStatus, not specimenStatus, and appends no OperationalStateDecision (RF006 AC2/AC3/AC7)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample({ specimenId: 'SPC-1', specimenStatus: 'available' }));
      await sampleService.withdrawSample(db, 'sample-1', {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      });
      expect(db.collections.operationalStateDecisions?.insertOne ?? vi.fn()).not.toHaveBeenCalled();

      const again = makeDb();
      again.collections.samples.findOne.mockResolvedValue(existingSample({ specimenId: 'SPC-2', specimenStatus: 'available', currentQuantity: 6 }));
      const partial = await sampleService.withdrawSample(again, 'sample-1', {
        withdrawalType: 'Parcial',
        withdrawalQuantity: 2,
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      });
      expect(partial.quantityStatus).toBe('partial');
      expect(again.collections.samples.updateOne.mock.calls[0][1].$set.quantityStatus).toBe('partial');
      expect(again.collections.operationalStateDecisions?.insertOne ?? vi.fn()).not.toHaveBeenCalled();
    });

    it('refuses a withdrawal from a closed specimen (RF026 AC7)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample({ specimenStatus: 'closed' }));
      await expect(sampleService.withdrawSample(db, 'sample-1', {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      })).rejects.toThrow(/Status: closed/);
    });

    it('performs a partial withdrawal within available quantity', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      const result = await sampleService.withdrawSample(db, 'sample-1', {
        withdrawalType: 'Parcial',
        withdrawalQuantity: 4,
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      });

      expect(result.withdrawnQuantity).toBe(4);
      expect(result.remainingQuantity).toBe(6);
    });

    it('throws when the sample cannot be found', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      await expect(
        sampleService.withdrawSample(db, '507f1f77bcf86cd799439011', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow('Amostra não encontrada');
    });

    it('rejects when the sample is already destroyed (RF006 AC#4)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(
        existingSample({ specimenStatus: 'destroyed' })
      );

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/não está disponível para retirada/);
    });

    it('rejects a withdrawal while an active legal hold covers the specimen, and writes nothing (RF006 AC6, #1315)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample({ specimenId: 'SPC-HELD' }));
      db.collections.legalHolds = makeCollection('legalHolds');
      db.collections.legalHolds.find.mockImplementation(() => makeCursor([
        { legalHoldId: 'hold-1', targetEntityType: 'Specimen', targetEntityIds: ['SPC-HELD'], status: 'active' },
      ]));

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/Retirada bloqueada: .*hold-1/);
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    });

    it('rejects an invalid withdrawal type', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Bogus',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/Tipo de retirada inválido/);
    });

    it('rejects a responsible name without a surname', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/responsável/);
    });

    it('rejects a missing linkedProject', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: '  '
        })
      ).rejects.toThrow(/Projeto vinculado é obrigatório/);
    });

    it('rejects a partial withdrawal exceeding available quantity', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Parcial',
          withdrawalQuantity: 999,
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/Quantidade indisponível/);
    });

    it('rejects a partial withdrawal missing a quantity', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Parcial',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/obrigatória para retirada parcial/);
    });

    // #541: BLOCKED_SPECIMEN_STATUSES doesn't (and can't safely, without
    // breaking returnSample's un-deplete-on-return flow) include
    // 'depleted', so a Total re-withdrawal on an already-depleted sample
    // used to fall through the status gate. withdrawQty floored at 0
    // (availableQty was already 0) so no negative balance resulted, but it
    // silently "succeeded": a zero-quantity ledger entry plus an
    // overwritten withdrawnAt/withdrawalResponsible/sampleDestination on
    // the Sample document, with nothing actually withdrawn.
    it('rejects a Total re-withdrawal on an already-depleted sample (#541)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(
        existingSample({ specimenStatus: 'depleted', currentQuantity: 0 })
      );

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/Quantidade indisponível/);
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    });

    // Regression per issue #252: withdrawSample's barcode-fallback lookup
    // used to call a method that doesn't exist on the class
    // (`getSpecimenByBarcode` instead of `getSampleByBarcode`), so a
    // barcode-style specimenId that isn't found by the direct lookup threw
    // a TypeError instead of falling back cleanly to the barcode lookup.
    it('falls back to the barcode lookup instead of throwing, per issue #252', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);
      vi
        .spyOn(sampleService, 'getSampleByBarcode')
        .mockResolvedValue({ sample: null });

      await expect(
        sampleService.withdrawSample(db, 'BR-NOT-AN-OBJECTID', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow(/Amostra não encontrada/);

      expect(sampleService.getSampleByBarcode).toHaveBeenCalledWith(
        db,
        'BR-NOT-AN-OBJECTID'
      );
    });

    // RF006 AC#6 (#297): the ledger append and the balance update must be
    // one atomic operation, not two independent writes a crash could split.
    it('wraps the ledger append and balance update in a single Mongo transaction', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());

      await sampleService.withdrawSample(db, 'sample-1', {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      });

      expect(db.client.startSession).toHaveBeenCalledTimes(1);
      expect(db.session.withTransaction).toHaveBeenCalledTimes(1);
      expect(db.session.endSession).toHaveBeenCalledTimes(1);

      const [, insertOptions] = db.collections.sample_movements.insertOne.mock.calls[0];
      const [, , updateOptions] = db.collections.samples.updateOne.mock.calls[0];
      expect(insertOptions).toEqual({ session: db.session });
      expect(updateOptions).toEqual({ session: db.session });
    });

    it('propagates a failed balance update without a partial write left standing', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample());
      db.collections.samples.updateOne.mockRejectedValue(new Error('connection dropped'));

      await expect(
        sampleService.withdrawSample(db, 'sample-1', {
          withdrawalType: 'Total',
          withdrawalResponsible: 'Jane Doe',
          linkedProject: 'ProjectX'
        })
      ).rejects.toThrow('connection dropped');

      // The ledger insert ran inside the same transaction as the failed
      // update — real MongoDB aborts the whole transaction on throw, so
      // the movement never actually commits even though insertOne (the
      // mock) recorded the call.
      expect(db.collections.sample_movements.insertOne).toHaveBeenCalledTimes(1);
      expect(db.session.endSession).toHaveBeenCalledTimes(1);
    });

    it('stamps quantityLedgerVersion v+1 on the balance and its movement, written only on the version it read (RF006 AC4)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample({ specimenId: 'SPC-1', quantityLedgerVersion: 3 }));

      const result = await sampleService.withdrawSample(db, 'sample-1', {
        withdrawalType: 'Parcial',
        withdrawalQuantity: 2,
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      });

      expect(db.collections.samples.updateOne.mock.calls[0][0]).toEqual({ specimenId: 'SPC-1', quantityLedgerVersion: 3 });
      expect(db.collections.samples.updateOne.mock.calls[0][1].$set.quantityLedgerVersion).toBe(4);
      expect(db.collections.sample_movements.insertOne.mock.calls[0][0].quantityLedgerVersion).toBe(4);
      expect(result.quantityLedgerVersion).toBe(4);
    });

    it('reads a specimen with no quantityLedgerVersion as version 0 (RF006 AC4)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample({ specimenId: 'SPC-1' }));

      await sampleService.withdrawSample(db, 'sample-1', {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      });

      expect(db.collections.samples.updateOne.mock.calls[0][0].quantityLedgerVersion).toBeNull();
      expect(db.collections.samples.updateOne.mock.calls[0][1].$set.quantityLedgerVersion).toBe(1);
    });

    it('refuses with 409 when the ledger version moved between read and write (RF006 AC4)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(existingSample({ specimenId: 'SPC-1', quantityLedgerVersion: 3 }));
      db.collections.samples.updateOne.mockResolvedValue({ matchedCount: 0 });

      await expect(sampleService.withdrawSample(db, 'sample-1', {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Jane Doe',
        linkedProject: 'ProjectX'
      })).rejects.toMatchObject({ statusCode: 409, message: 'Amostra alterada concorrentemente; leia-a de novo' });
    });
  });

  // -------------------------------------------------------------------
  describe('getSample', () => {
    it('returns the sample by specimenId', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 'sample-1', specimenId: 'sample-1' });

      const result = await sampleService.getSample(db, 'sample-1');
      expect(result._id).toBe('sample-1');
      expect(db.collections.samples.findOne).toHaveBeenCalledWith({ specimenId: 'sample-1' });
    });

    it('propagates and logs an error from the collection lookup', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockRejectedValue(new Error('mongo down'));

      await expect(sampleService.getSample(db, 'sample-1')).rejects.toThrow('mongo down');
    });
  });

  // -------------------------------------------------------------------
  describe('listSamples', () => {
    it('builds a filtered query and returns paginated results', async () => {
      const db = makeDb();
      const cursor = makeCursor([{ specimenId: 1 }]);
      db.collections.samples.find.mockReturnValue(cursor);
      db.collections.samples.countDocuments.mockResolvedValue(1);

      const result = await sampleService.listSamples(db, {
        participantId: '12345678',
        specimenStatus: 'available',
        sampleType: 'PLASMA',
        limit: 5,
        skip: 1
      });

      expect(db.collections.samples.find).toHaveBeenCalledWith({
        participantId: '12345678',
        specimenStatus: 'available',
        sampleType: 'PLASMA'
      });
      expect(cursor.limit).toHaveBeenCalledWith(5);
      expect(cursor.skip).toHaveBeenCalledWith(1);
      // specimenStatus is normalized onto every returned document (#415) —
      // this one has none, so it falls back to the 'available' default.
      // quantityStatus is derived the same way (RF006 AC3); no quantities
      // here, so it reads depleted.
      expect(result).toEqual({ samples: [{ specimenId: 1, specimenStatus: 'available', quantityStatus: 'depleted' }], total: 1, limit: 5, skip: 1 });
    });

    it('maps a v1.3.0 partial/depleted status filter onto quantityStatus (RF006 AC2/AC3)', async () => {
      const db = makeDb();
      db.collections.samples.find.mockReturnValue(makeCursor([]));
      db.collections.samples.countDocuments.mockResolvedValue(0);

      await sampleService.listSamples(db, { specimenStatus: 'DEPLETED' });
      expect(db.collections.samples.find).toHaveBeenLastCalledWith({ quantityStatus: 'depleted' });

      await sampleService.listSamples(db, { quantityStatus: 'partial' });
      expect(db.collections.samples.find).toHaveBeenLastCalledWith({ quantityStatus: 'partial' });
    });

    it('applies default limit/skip when not specified', async () => {
      const db = makeDb();
      const result = await sampleService.listSamples(db, {});
      expect(result.limit).toBe(50);
      expect(result.skip).toBe(0);
    });

    it('propagates an error from the collection query', async () => {
      const db = makeDb();
      db.collections.samples.find.mockImplementation(() => {
        throw new Error('mongo down');
      });

      await expect(sampleService.listSamples(db, {})).rejects.toThrow('mongo down');
    });

    // #340: org-scoped caller sees only samples whose tenancy key is one of
    // their scoped organizations; #1192: the key is organizationId, falling
    // back to collectionSite.
    it('restricts the query to the sample tenancy clause for an organization scope', async () => {
      const db = makeDb();
      const organizationScope = { scope: 'organization', organizationIds: ['org-1', 'org-2'] };
      await sampleService.listSamples(db, { organizationScope });

      expect(db.collections.samples.find).toHaveBeenCalledWith({
        $and: [sampleOrganizationScopeClause(organizationScope)]
      });
    });

    it('does not filter the query for a global scope (Administrador bypass)', async () => {
      const db = makeDb();
      await sampleService.listSamples(db, {
        organizationScope: { scope: 'global', organizationIds: [] }
      });

      expect(db.collections.samples.find).toHaveBeenCalledWith({});
    });

    it('does not filter the query when no organizationScope is passed', async () => {
      const db = makeDb();
      await sampleService.listSamples(db, {});

      expect(db.collections.samples.find).toHaveBeenCalledWith({});
    });

    // #647 (found blocking a real-UI e2e proof for #647 itself): same shape
    // as #645's sensor-list bug -- no sort meant Mongo's natural (insertion)
    // order decided which samples landed on the default 50-item page. Once
    // the collection passed that default (e2e fixtures accumulate across
    // sessions), a freshly created sample was silently excluded from the
    // list, so SampleDetailsPage's client-side find-by-id in the loaded
    // list came up empty ("Amostra não encontrada") for a sample that had
    // just been created seconds earlier. makeCursor's own sort() is a
    // chain-shape no-op, so this uses a realistic order-aware cursor
    // instead, to actually prove the ordering, not just the call shape.
    it('surfaces a just-created sample on page 1 even when the collection already holds >limit older samples (natural/insertion order)', async () => {
      const older = Array.from({ length: 51 }, (_, i) => ({
        specimenId: `old-${i}`,
        createdAt: new Date(2026, 0, 1, 0, 0, i)
      }));
      const newest = { specimenId: 'just-created', createdAt: new Date(2026, 0, 2) };
      const naturalOrderDocs = [...older, newest];

      const makeRealCursor = (docs) => {
        let current = [...docs];
        const cursor = {
          sort: vi.fn((criteria) => {
            const [[field, direction]] = Object.entries(criteria);
            current = [...current].sort((a, b) => (direction >= 0 ? 1 : -1) * (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0));
            return cursor;
          }),
          limit: vi.fn((n) => { current = current.slice(0, n); return cursor; }),
          skip: vi.fn((n) => { current = current.slice(n); return cursor; }),
          toArray: vi.fn(async () => current)
        };
        return cursor;
      };

      const db = makeDb();
      db.collections.samples.find = vi.fn(() => makeRealCursor(naturalOrderDocs));
      db.collections.samples.countDocuments.mockResolvedValue(naturalOrderDocs.length);

      const result = await sampleService.listSamples(db, {});

      expect(result.samples.map((s) => s.specimenId)).toContain('just-created');
      expect(result.samples[0].specimenId).toBe('just-created');
    });
  });

  // -------------------------------------------------------------------
  describe('updateSample', () => {
    it('returns null when the sample does not exist', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      const result = await sampleService.updateSample(db, 'missing', { quantity: 5 });
      expect(result).toBeNull();
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    });

    it('refuses a barcode update holding a CPF or the participant name with BARCODE_PERSONAL_DATA (RNF007 AC4, #1463)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 'sample-1', specimenId: 'SPC-U', participantId: '12345678', initialQuantity: 10, currentQuantity: 10 });
      db.collection('participantIdentities').findOne.mockResolvedValue({ participantId: '12345678', patientName: 'Joana Ximenes dos Santos' });

      for (const barcode of ['52998224725', 'JOANA-001']) {
        await expect(sampleService.updateSample(db, 'SPC-U', { barcode }))
          .rejects.toMatchObject({ statusCode: 422, code: 'BARCODE_PERSONAL_DATA' });
      }
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    });

    it('recomputes quantityStatus and persists the update, leaving specimenStatus alone (RF006 AC2/AC3)', async () => {
      const db = makeDb();
      const existing = {
        _id: 'sample-1',
        quantity: 10,
        initialQuantity: 10,
        currentQuantity: 10,
        lifecycleStatus: 'AVAILABLE'
      };
      db.collections.samples.findOne
        .mockResolvedValueOnce(existing) // initial lookup
        .mockResolvedValueOnce({ ...existing, initialQuantity: 25, currentQuantity: 25 }); // post-update re-fetch

      const result = await sampleService.updateSample(db, 'sample-1', { initialQuantity: 25 });

      expect(db.collections.samples.updateOne).toHaveBeenCalledTimes(1);
      const [, updateArg] = db.collections.samples.updateOne.mock.calls[0];
      // The legacy lifecycleStatus/availabilityStatus dual-write was removed
      // in #408; quantity moves quantityStatus, never specimenStatus. Before
      // any movement the correction re-derives the balance (#1531): full.
      expect(updateArg.$set.quantityStatus).toBe('full');
      expect(updateArg.$set.specimenStatus).toBeUndefined();
      expect(updateArg.$set.lifecycleStatus).toBeUndefined();
      expect(updateArg.$set.availabilityStatus).toBeUndefined();
      expect(result.initialQuantity).toBe(25);
    });

    it('appends an OperationalStateDecision when an edit changes specimenStatus, and none for a quantity edit or no change (RF006 AC7, #1315)', async () => {
      const db = makeDb();
      const existing = { _id: 'sample-1', specimenId: 'SPC-U', initialQuantity: 10, currentQuantity: 10, specimenStatus: 'available' };
      db.collections.samples.findOne.mockResolvedValue(existing);

      await sampleService.updateSample(db, 'SPC-U', { initialQuantity: 20 });
      expect(db.collections.operationalStateDecisions?.insertOne ?? vi.fn()).not.toHaveBeenCalled();

      await sampleService.updateSample(db, 'SPC-U', { specimenStatus: 'reserved' });
      const decisions = db.collections.operationalStateDecisions;
      expect(decisions.insertOne).toHaveBeenCalledTimes(1);
      const [decision] = decisions.insertOne.mock.calls[0];
      expect(decision).toMatchObject({ specimenId: 'SPC-U', previousStatus: 'available', newStatus: 'reserved', rulesApplied: ['manual_status_update'], reasonCodes: ['update'] });
      expect(decision.triggerEventId).toMatch(/^sample-update:/);

      await sampleService.updateSample(db, 'SPC-U', { notes: 'no status change' });
      expect(decisions.insertOne).toHaveBeenCalledTimes(1);
    });

    // RF006 AC3 / RF026 AC7 (decision 4): the generic update refuses a
    // client quantityStatus, `closed`, a v1.3.0 value and a change out of
    // closed, with a 422-coded error, and writes nothing.
    it.each([
      ['a client quantityStatus', { specimenStatus: 'available' }, { quantityStatus: 'full' }, /quantityStatus é derivado/],
      ['closed through the generic update', { specimenStatus: 'available' }, { specimenStatus: 'closed' }, /POST \/api\/samples\/:id\/close/],
      ['a v1.3.0 value', { specimenStatus: 'available' }, { specimenStatus: 'depleted' }, /specimenStatus inválido: depleted/],
      ['a change out of closed', { specimenStatus: 'closed' }, { specimenStatus: 'available' }, /closed não admite mudança/],
    ])('refuses %s (422)', async (_label, stored, body, message) => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 'sample-1', specimenId: 'SPC-R', initialQuantity: 10, currentQuantity: 10, ...stored });
      await expect(sampleService.updateSample(db, 'SPC-R', body)).rejects.toMatchObject({
        statusCode: 422, code: 'SPECIMEN_STATUS_WRITE_REFUSED', message: expect.stringMatching(message),
      });
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    });

    // #1378 (ELM-0116): once the migration window is closed, an update naming
    // barcode, with any value, is refused and writes nothing.
    it.each([
      ['a new value', { barcode: 'BR-NEW-1' }],
      ['null', { barcode: null }],
    ])('with the barcode window closed, refuses a barcode write of %s (422)', async (_label, body) => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 'sample-1', specimenId: 'SPC-B', initialQuantity: 10, currentQuantity: 10, specimenStatus: 'available' });

      await withBarcodeWindowClosed(() => expect(sampleService.updateSample(db, 'SPC-B', { ...body, notes: 'x' })).rejects.toMatchObject({
        statusCode: 422, code: 'LEGACY_BARCODE_WRITE_REFUSED', message: expect.stringMatching(/ELM-0116/),
      }));
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    });

    it('with the barcode window closed, accepts an update that names no barcode (#1378)', async () => {
      const db = makeDb();
      const existing = { _id: 'sample-1', specimenId: 'SPC-B', initialQuantity: 10, currentQuantity: 10, specimenStatus: 'available' };
      db.collections.samples.findOne.mockResolvedValue(existing);

      const result = await withBarcodeWindowClosed(() => sampleService.updateSample(db, 'SPC-B', { notes: 'x' }));

      expect(result).toMatchObject({ specimenId: 'SPC-B' });
      expect(db.collections.samples.updateOne).toHaveBeenCalledTimes(1);
      expect(db.collections.samples.updateOne.mock.calls[0][1].$set.notes).toBe('x');
    });

    // #540: sample.service.js#updateSample used the raw MongoDB driver and
    // only stripped the three already-retired fields above — a caller
    // sending currentStatus/status in the PUT body (SampleDetailsPage.tsx's
    // edit form did exactly this) got them persisted for real.
    it('strips currentStatus/status from the persisted payload even when the caller sends them', async () => {
      const db = makeDb();
      const existing = {
        _id: 'sample-1',
        quantity: 10,
        initialQuantity: 10,
        currentQuantity: 10,
        specimenStatus: 'available'
      };
      db.collections.samples.findOne
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);

      await sampleService.updateSample(db, 'sample-1', {
        currentStatus: 'Available',
        status: 'AVAILABLE',
        notes: 'edited via SampleDetailsPage'
      });

      const [, updateArg] = db.collections.samples.updateOne.mock.calls[0];
      expect(updateArg.$set.currentStatus).toBeUndefined();
      expect(updateArg.$set.status).toBeUndefined();
      expect(updateArg.$set.notes).toBe('edited via SampleDetailsPage');
    });

    // #875: updateSample spread every non-status key from the body into
    // $set -- an unrecognized key like `hacked`, or an identity field like
    // participantId, sailed through untouched. The allowlist must drop
    // both, while still persisting recognized fields like quantity.
    it('drops unrecognized keys and participantId from the persisted payload (#875)', async () => {
      const db = makeDb();
      const existing = {
        _id: 'sample-1',
        quantity: 10,
        initialQuantity: 10,
        currentQuantity: 10,
        specimenStatus: 'available'
      };
      db.collections.samples.findOne
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);

      await sampleService.updateSample(db, 'sample-1', {
        quantity: 5,
        hacked: 'x',
        participantId: 'switch'
      });

      const [, updateArg] = db.collections.samples.updateOne.mock.calls[0];
      expect(updateArg.$set.quantity).toBe(5);
      expect(updateArg.$set.hacked).toBeUndefined();
      expect(updateArg.$set.participantId).toBeUndefined();
    });

    it('refuses a write to an RCS-derived field and persists nothing (RNF018 AC4, #1489)', async () => {
      const writes = [
        { rcsScore: 99 },
        { gradeRoute: 'Score-based certification' },
        { axisPenalties: [] },
        { biologicalPenalty: 0 }
      ];
      for (const write of writes) {
        const db = makeDb();
        db.collections.samples.findOne.mockResolvedValue({
          _id: 'sample-1',
          quantity: 10,
          initialQuantity: 10,
          currentQuantity: 10,
          specimenStatus: 'available'
        });

        await expect(sampleService.updateSample(db, 'sample-1', write)).rejects.toMatchObject({
          statusCode: 422,
          code: 'RCS_DERIVED_WRITE_REFUSED',
          fields: Object.keys(write)
        });
        expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
      }
    });

    it('refuses a write to a governance or seal field of the RCS result and persists nothing (RNF018 AC4, #1526)', async () => {
      const writes = [
        { modelVersion: 'RCS-GOV-v9' },
        { matrixType: 'solid' },
        { governanceStatus: 1 },
        { governanceFailureReasons: [] },
        { governanceRuleCodes: [] },
        { sealedRcsAssessmentId: 'forged-assessment' },
        { governanceStatus: null }
      ];
      for (const write of writes) {
        const db = makeDb();
        db.collections.samples.findOne.mockResolvedValue({
          _id: 'sample-1',
          quantity: 10,
          initialQuantity: 10,
          currentQuantity: 10,
          specimenStatus: 'available',
          governanceStatus: 0
        });

        await expect(sampleService.updateSample(db, 'sample-1', write)).rejects.toMatchObject({
          statusCode: 422,
          code: 'RCS_DERIVED_WRITE_REFUSED',
          fields: Object.keys(write)
        });
        expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
      }
    });

    it('refuses a negative or non-numeric quantity and persists nothing (RNF018 AC1, #1525)', async () => {
      const writes = [
        { currentQuantity: -1 },
        { quantity: -0.5 },
        { initialQuantity: -10 },
        { currentQuantity: 'abc' }
      ];
      for (const write of writes) {
        const db = makeDb();
        db.collections.samples.findOne.mockResolvedValue({ _id: 'sample-1', quantity: 10, initialQuantity: 10, currentQuantity: 10, specimenStatus: 'available' });

        await expect(sampleService.updateSample(db, 'sample-1', write)).rejects.toMatchObject({
          statusCode: 422,
          code: 'INVALID_QUANTITY',
          fields: Object.keys(write)
        });
        expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
      }
    });

    it('writes an initialQuantity of zero, the lowest the edit allows (RNF018 AC1, #1525)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 'sample-1', specimenId: 'SPC-1', quantity: 10, initialQuantity: 10, currentQuantity: 10, specimenStatus: 'available' });

      await sampleService.updateSample(db, 'sample-1', { initialQuantity: 0 });

      expect(db.collections.samples.updateOne.mock.calls[0][1].$set.initialQuantity).toBe(0);
    });

    // RF006 AC4 (#1531): a ledgered quantity moves only by a withdrawal or return.
    const ledgered = { _id: 'sample-1', specimenId: 'SPC-L', quantity: 10, initialQuantity: 10, currentQuantity: 4, totalWithdrawn: 6, totalReturned: 0, quantityLedgerVersion: 2, specimenStatus: 'available' };
    const unmoved = { _id: 'sample-1', specimenId: 'SPC-N', quantity: 10, initialQuantity: 10, currentQuantity: 10, totalWithdrawn: 0, totalReturned: 0, quantityLedgerVersion: 0, specimenStatus: 'available' };
    it.each([
      ['currentQuantity after a movement', ledgered, { currentQuantity: 9 }],
      ['totalWithdrawn after a movement', ledgered, { totalWithdrawn: 0 }],
      ['totalReturned after a movement', ledgered, { totalReturned: 3 }],
      ['initialQuantity after a movement', ledgered, { initialQuantity: 50 }],
      ['quantity after a movement', ledgered, { quantity: 50 }],
      ['initialQuantity on a pre-version specimen with a withdrawal', { ...ledgered, quantityLedgerVersion: undefined }, { initialQuantity: 50 }],
      ['currentQuantity before any movement', unmoved, { currentQuantity: 4 }],
      ['totalWithdrawn before any movement', unmoved, { totalWithdrawn: 6 }],
      ['every ledgered field at once', ledgered, { currentQuantity: 9, totalWithdrawn: 1, totalReturned: 1 }],
    ])('refuses an edit of %s with QUANTITY_LEDGER_WRITE_REFUSED and writes nothing (RF006 AC4, #1531)', async (_label, stored, write) => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(stored);

      await expect(sampleService.updateSample(db, 'sample-1', write)).rejects.toMatchObject({
        statusCode: 422,
        code: 'QUANTITY_LEDGER_WRITE_REFUSED',
        fields: Object.keys(write)
      });
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    });

    it('writes an edit that echoes the stored ledgered quantities, leaving them out of the write (RF006 AC4, #1531)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(ledgered);

      await sampleService.updateSample(db, 'sample-1', { currentQuantity: 4, totalWithdrawn: 6, totalReturned: 0, linkedProject: 'P-1531' });

      const [, update] = db.collections.samples.updateOne.mock.calls[0];
      expect(update.$set.linkedProject).toBe('P-1531');
      expect(update.$set).not.toHaveProperty('currentQuantity');
      expect(update.$set).not.toHaveProperty('totalWithdrawn');
      expect(update.$set).not.toHaveProperty('totalReturned');
    });

    it('writes a quantity correction before any movement (RF006 AC4, #1531)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(unmoved);

      await sampleService.updateSample(db, 'sample-1', { quantity: 12, initialQuantity: 12 });

      expect(db.collections.samples.updateOne.mock.calls[0][1].$set).toMatchObject({ quantity: 12, initialQuantity: 12 });
    });

    it.each([
      ['initialQuantity', { initialQuantity: 12 }],
      ['quantity', { quantity: 12 }, { initialQuantity: undefined }],
      ['quantity (initialQuantity sent as null)', { quantity: 12, initialQuantity: null }, { initialQuantity: undefined }],
    ])('re-derives currentQuantity from a %s correction before any movement, so the specimen stays full (RF006 AC4, #1531)', async (_label, write, storedOverride = {}) => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ ...unmoved, ...storedOverride });

      await sampleService.updateSample(db, 'sample-1', write);

      const { $set } = db.collections.samples.updateOne.mock.calls[0][1];
      expect($set.currentQuantity).toBe(12);
      expect($set.quantityStatus).toBe('full');
    });

    it('keeps the balance on a quantity-only correction when a stored initialQuantity is the base (RF006 AC4, #1531)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ ...unmoved, initialQuantity: 20, quantity: 10, currentQuantity: 20 });

      await sampleService.updateSample(db, 'sample-1', { quantity: 12 });

      const { $set } = db.collections.samples.updateOne.mock.calls[0][1];
      expect($set).not.toHaveProperty('currentQuantity');
      expect($set.quantityStatus).toBe('full');
    });

    it.each([
      ['the stored quantity', { initialQuantity: null }, 10],
      ['the sent quantity', { quantity: 12, initialQuantity: null }, 12],
    ])('re-derives currentQuantity from %s when an edit clears a stored initialQuantity before any movement (RF006 AC4, #1531)', async (_label, write, expected) => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ ...unmoved, initialQuantity: 20, quantity: 10, currentQuantity: 20 });

      await sampleService.updateSample(db, 'sample-1', write);

      const { $set } = db.collections.samples.updateOne.mock.calls[0][1];
      expect($set.currentQuantity).toBe(expected);
      expect($set.quantityStatus).toBe('full');
    });

    it('keeps the balance of a pre-ledger specimen consumed with no recorded movement on an initialQuantity correction (RF006 AC4, #1531)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 'sample-1', specimenId: 'SPC-P', quantity: 10, initialQuantity: 10, currentQuantity: 4, specimenStatus: 'available' });

      await sampleService.updateSample(db, 'sample-1', { initialQuantity: 12 });

      const { $set } = db.collections.samples.updateOne.mock.calls[0][1];
      expect($set).not.toHaveProperty('currentQuantity');
      expect($set.quantityStatus).toBe('partial');
    });

    it('returns null when updateOne matches nothing', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 'sample-1', quantity: 10 });
      db.collections.samples.updateOne.mockResolvedValue({ matchedCount: 0 });

      const result = await sampleService.updateSample(db, 'sample-1', { quantity: 5 });
      expect(result).toBeNull();
    });

    it('propagates an error from the collection lookup', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockRejectedValue(new Error('mongo down'));

      await expect(sampleService.updateSample(db, 'sample-1', { quantity: 5 })).rejects.toThrow(
        'mongo down'
      );
    });
  });

  // -------------------------------------------------------------------
  describe('deleteSample', () => {
    // #1216: the route passes the URL id, an _id or a specimenId. These
    // doubles once ignored the delete filter, which hid that a bare
    // { specimenId: <ObjectId> } filter could never match a real sample.
    it('resolves a specimenId and deletes that sample by its _id', async () => {
      const db = makeDb();
      const _id = new ObjectId();
      db.collections.samples.findOne.mockImplementation(async (filter) => (
        filter.specimenId === '3116768' ? { _id, specimenId: '3116768' } : null
      ));
      db.collections.samples.deleteOne.mockResolvedValue({ deletedCount: 1 });

      expect(await sampleService.deleteSample(db, '3116768')).toBe(true);
      expect(db.collections.samples.deleteOne).toHaveBeenCalledWith({ _id });
    });

    it('resolves a Mongo _id string and deletes that sample by its _id', async () => {
      const db = makeDb();
      const _id = new ObjectId();
      db.collections.samples.findOne.mockImplementation(async (filter) => (
        filter._id && String(filter._id) === String(_id) ? { _id, specimenId: '3116768' } : null
      ));
      db.collections.samples.deleteOne.mockResolvedValue({ deletedCount: 1 });

      expect(await sampleService.deleteSample(db, String(_id))).toBe(true);
      expect(db.collections.samples.deleteOne).toHaveBeenCalledWith({ _id });
    });

    it('returns false without deleting when no sample resolves', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      expect(await sampleService.deleteSample(db, 'missing')).toBe(false);
      expect(db.collections.samples.deleteOne).not.toHaveBeenCalled();
    });

    it('propagates an error from the collection delete', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: new ObjectId(), specimenId: 'sample-1' });
      db.collections.samples.deleteOne.mockRejectedValue(new Error('mongo down'));

      await expect(sampleService.deleteSample(db, 'sample-1')).rejects.toThrow('mongo down');
    });
  });

  // -------------------------------------------------------------------
  // #1219: every QuarantineAction writer recorded the sample's _id, and
  // this read queried the canonical specimenId, so it found nothing. The
  // find double honours the filter, so a read keyed on one form only
  // misses the other row.
  describe('getQuarantineActions', () => {
    it('returns both the legacy _id-keyed and the canonical action for a sample', async () => {
      const _id = new ObjectId();
      const actions = [
        { quarantineActionId: 'legacy', specimenIds: [String(_id)] },
        { quarantineActionId: 'canonical', specimenIds: ['3116768'] },
        { quarantineActionId: 'other', specimenIds: ['someone-else'] },
      ];
      const matches = (value, doc) => (value && Array.isArray(value.$in)
        ? value.$in.some((v) => doc.specimenIds.includes(v))
        : doc.specimenIds.includes(value));
      const quarantineActions = makeCollection('quarantineActions');
      quarantineActions.find.mockImplementation((filter) => makeCursor(actions.filter((doc) => matches(filter.specimenIds, doc))));
      const db = makeDb({ quarantineActions });
      db.collections.samples.findOne.mockImplementation(async (filter) => (
        filter.specimenId === '3116768' ? { _id, specimenId: '3116768' } : null
      ));

      const result = await sampleService.getQuarantineActions(db, '3116768');

      expect(result.map((a) => a.quarantineActionId).sort()).toEqual(['canonical', 'legacy']);
    });
  });

  describe('getQuarantineActions for an unresolved id', () => {
    it('queries the actions by the id as a string when no sample resolves', async () => {
      const quarantineActions = makeCollection('quarantineActions');
      quarantineActions.find.mockImplementation(() => makeCursor([]));
      const db = makeDb({ quarantineActions });
      db.collections.samples.findOne.mockResolvedValue(null);

      const result = await sampleService.getQuarantineActions(db, 'SPC-NONE');

      expect(result).toEqual([]);
      expect(quarantineActions.find.mock.calls[0][0]).toEqual({ specimenIds: 'SPC-NONE' });
    });

    it('rejects an id that cannot be turned into a string', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      await expect(sampleService.getQuarantineActions(db, Object.create(null))).rejects.toThrow(TypeError);
    });
  });

  describe('getStateDecisions', () => {
    it('returns the decisions keyed by specimenId and by stored _id, oldest first, and null for an unknown sample (RF006 AC7, #1315)', async () => {
      const _id = new ObjectId();
      const rows = [
        { operationalStateDecisionId: 'canonical', specimenId: 'SPC-D', occurredAt: new Date('2026-10-02') },
        { operationalStateDecisionId: 'legacy', specimenId: String(_id), occurredAt: new Date('2026-10-01') },
        { operationalStateDecisionId: 'other', specimenId: 'someone-else', occurredAt: new Date('2026-09-30') },
      ];
      const operationalStateDecisions = makeCollection('operationalStateDecisions');
      operationalStateDecisions.find.mockImplementation((filter) => makeCursor(rows.filter((doc) => doc.specimenId === filter.specimenId)));
      const db = makeDb({ operationalStateDecisions });
      db.collections.samples.findOne.mockImplementation(async (filter) => (filter.specimenId === 'SPC-D' ? { _id, specimenId: 'SPC-D' } : null));

      const result = await sampleService.getStateDecisions(db, 'SPC-D');
      expect(result.map((d) => d.operationalStateDecisionId)).toEqual(['legacy', 'canonical']);
      expect(await sampleService.getStateDecisions(db, 'missing')).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  describe('getSampleByBarcode', () => {
    it('returns the sample and an anonymized participant on exact match, resolving patientName via ParticipantIdentity (#561/#564)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValueOnce({
        _id: 's1',
        barcode: 'BR-1',
        participantId: '12345678'
      });
      db.collections.patients.findOne.mockResolvedValue({
        participantId: '12345678',
        recordNumber: 'RN1'
      });
      db.collection('participantIdentities').findOne.mockResolvedValue({
        participantId: '12345678',
        patientName: 'Maria Silva',
      });

      const { sample, participant } = await sampleService.getSampleByBarcode(db, 'BR-1');
      expect(sample._id).toBe('s1');
      expect(participant.patientName).toBe('M. S.');
      expect(participant.participantId).toBe('12345678');
    });

    it('returns nulls when no sample matches any lookup strategy', async () => {
      const db = makeDb();
      // all findOne calls resolve null (default), find() for the debug-log
      // examples query resolves an empty cursor by default too
      const result = await sampleService.getSampleByBarcode(db, 'DOES-NOT-EXIST');
      expect(result).toEqual({ sample: null, participant: null });
    });

    it('falls back to a case-insensitive match when the exact match misses', async () => {
      const db = makeDb();
      db.collections.samples.findOne
        .mockResolvedValueOnce(null) // exact match
        .mockResolvedValueOnce({ _id: 's1', barcode: 'BR-UPPER' }); // case-insensitive match

      const { sample } = await sampleService.getSampleByBarcode(db, 'br-upper');
      expect(sample._id).toBe('s1');
    });

    it('falls back to a numeric match for legacy all-digit barcodes', async () => {
      const db = makeDb();
      db.collections.samples.findOne
        .mockResolvedValueOnce(null) // exact match
        .mockResolvedValueOnce(null) // case-insensitive match
        .mockResolvedValueOnce({ _id: 's1', barcode: 123456 }); // numeric match

      const { sample } = await sampleService.getSampleByBarcode(db, '123456');
      expect(sample._id).toBe('s1');
      expect(db.collections.samples.findOne).toHaveBeenCalledWith({ barcode: 123456 });
    });

    it('falls back to a regex match as a last resort', async () => {
      const db = makeDb();
      db.collections.samples.findOne
        .mockResolvedValueOnce(null) // exact match
        .mockResolvedValueOnce(null) // case-insensitive match
        .mockResolvedValueOnce({ _id: 's1', barcode: 'BR.1' }); // regex match

      const { sample } = await sampleService.getSampleByBarcode(db, 'BR.1');
      expect(sample._id).toBe('s1');
    });

    it('returns the sample without a participant when it has no participantId', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValueOnce({ _id: 's1', barcode: 'BR-1' });

      const { sample, participant } = await sampleService.getSampleByBarcode(db, 'BR-1');
      expect(sample._id).toBe('s1');
      expect(participant).toBeNull();
    });

    it('anonymizes a single-word participant name', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValueOnce({
        _id: 's1',
        barcode: 'BR-1',
        participantId: '12345678'
      });
      db.collections.patients.findOne.mockResolvedValue({
        participantId: '12345678',
        recordNumber: 'RN1'
      });
      db.collection('participantIdentities').findOne.mockResolvedValue({
        participantId: '12345678',
        patientName: 'Cher',
      });

      const { participant } = await sampleService.getSampleByBarcode(db, 'BR-1');
      expect(participant.patientName).toBe('C***');
    });

    it('propagates an error from the collection lookup', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockRejectedValue(new Error('mongo down'));

      await expect(sampleService.getSampleByBarcode(db, 'BR-1')).rejects.toThrow('mongo down');
    });

    it('resolves patientName from a ciphertext-only ParticipantIdentity record (RF005/RNF007 #574)', async () => {
      const participantIdentityService = require('../../src/services/participantIdentity.service');
      const encrypted = participantIdentityService.encryptIdentityFields({
        participantId: '12345678',
        patientName: 'Maria Silva'
      });
      const ciphertextOnlyIdentity = { ...encrypted, patientName: null };

      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValueOnce({
        _id: 's1',
        barcode: 'BR-1',
        participantId: '12345678'
      });
      db.collections.patients.findOne.mockResolvedValue({
        participantId: '12345678',
        recordNumber: 'RN1'
      });
      db.collection('participantIdentities').findOne.mockResolvedValue(ciphertextOnlyIdentity);

      const { participant } = await sampleService.getSampleByBarcode(db, 'BR-1');
      expect(participant.patientName).toBe('M. S.');
      expect(participant.participantId).toBe('12345678');
    });
  });

  // -------------------------------------------------------------------
  describe('getSampleResults', () => {
    it('throws when the sample cannot be found', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      await expect(sampleService.getSampleResults(db, 'missing')).rejects.toThrow(
        'Amostra não encontrada'
      );
    });

    it('returns the results linked to the sample', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 's1', specimenId: 555001 });
      db.collections.results.find.mockReturnValue(makeCursor([{ resultID: 'r1' }]));

      const results = await sampleService.getSampleResults(db, 's1');
      expect(results).toEqual([{ resultID: 'r1' }]);
      expect(db.collections.results.find).toHaveBeenCalledWith({ specimenId: 555001 });
    });
  });

  // -------------------------------------------------------------------
  describe('getBarcodeIndustrialAssets', () => {
    it('throws for an empty/invalid barcode', async () => {
      await expect(sampleService.getBarcodeIndustrialAssets('   ')).rejects.toThrow(
        'Código de barras inválido para renderização industrial'
      );
    });

    it('generates industrial artifacts for a valid barcode', async () => {
      const assets = await sampleService.getBarcodeIndustrialAssets('BR-2024-001');
      expect(assets.canonicalValue).toBe('BR-2024-001');
      expect(assets.code128.imagePng).toBeDefined();
      expect(assets.dataMatrix.imagePng).toBeDefined();
    });
  });

  // -------------------------------------------------------------------
  describe('returnSample', () => {
    function withdrawnSample(overrides = {}) {
      return {
        _id: 'sample-1',
        barcode: 'BR-1',
        quantity: 10,
        initialQuantity: 10,
        currentQuantity: 4,
        totalWithdrawn: 6,
        totalReturned: 0,
        unit: 'µL',
        ...overrides
      };
    }

    it('throws when the sample cannot be found', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      await expect(
        sampleService.returnSample(db, '507f1f77bcf86cd799439011', {
          returnResponsible: 'Jane Doe',
          condition: 'intact',
          returnType: 'Total'
        })
      ).rejects.toThrow('Amostra não encontrada');
    });

    it('un-depletes a depleted specimen through quantityStatus, with no OperationalStateDecision (RF006 AC2/AC3/AC7)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample({
        specimenId: 'SPC-R', specimenStatus: 'available', quantityStatus: 'depleted', currentQuantity: 0, totalWithdrawn: 10,
      }));
      const result = await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'intact',
        returnType: 'Parcial',
        returnQuantity: 3
      });
      expect(result).toMatchObject({ newStatus: 'available', quantityStatus: 'partial', newAvailableQuantity: 3 });
      expect(db.collections.samples.updateOne.mock.calls[0][1].$set).toMatchObject({ quantityStatus: 'partial' });
      expect(db.collections.samples.updateOne.mock.calls[0][1].$set.specimenStatus).toBeUndefined();
      expect(db.collections.operationalStateDecisions?.insertOne ?? vi.fn()).not.toHaveBeenCalled();
    });

    it('a return moves quantityLedgerVersion too, on the version it read (RF006 AC4)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample({ specimenId: 'SPC-1', quantityLedgerVersion: 1 }));

      await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'intact',
        returnType: 'Parcial',
        returnQuantity: 3
      });

      expect(db.collections.samples.updateOne.mock.calls[0][0].quantityLedgerVersion).toBe(1);
      expect(db.collections.samples.updateOne.mock.calls[0][1].$set.quantityLedgerVersion).toBe(2);
    });

    it('refuses a return to a closed specimen (RF026 AC7)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample({ specimenStatus: 'closed' }));
      await expect(sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'intact',
        returnType: 'Total'
      })).rejects.toThrow(/Status: closed/);
    });

    it('rejects when there is nothing pending to return', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(
        withdrawnSample({ totalWithdrawn: 5, totalReturned: 5 })
      );

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jane Doe',
          condition: 'intact',
          returnType: 'Total'
        })
      ).rejects.toThrow(/Não há quantidade pendente de devolução/);
    });

    it('rejects a missing/too-short responsible name', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jo',
          condition: 'intact',
          returnType: 'Total'
        })
      ).rejects.toThrow(/Responsável pela devolução é obrigatório/);
    });

    it('rejects a genuinely invalid/unspecified condition', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jane Doe',
          condition: 'not-a-real-condition',
          returnType: 'Total'
        })
      ).rejects.toThrow(/Condição da amostra é obrigatória/);
    });

    it('accepts a PT-BR condition alias from the UI copy and normalizes it', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      const result = await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'Íntegra',
        returnType: 'Total'
      });

      expect(result.success).toBe(true);
      expect(result.condition).toBe('intact');
    });

    it('completes a total return with the "intact" condition (observations supplied)', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      const result = await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'intact',
        observations: 'Returned in good condition',
        returnType: 'Total'
      });

      expect(result.success).toBe(true);
      expect(result.returnedQuantity).toBe(6);
      expect(result.newAvailableQuantity).toBe(10);

      // RF006 AC3: a full return restores quantityStatus to full and closes
      // the withdrawal fields; specimenStatus is not written. The legacy
      // lifecycleStatus/availabilityStatus dual-write was removed in #408.
      const [, updateArg] = db.collections.samples.updateOne.mock.calls[0];
      expect(updateArg.$set.quantityStatus).toBe('full');
      expect(updateArg.$set.withdrawnAt).toBeNull();
      expect(updateArg.$set.specimenStatus).toBeUndefined();
      expect(updateArg.$set.lifecycleStatus).toBeUndefined();
      expect(updateArg.$set.availabilityStatus).toBeUndefined();
    });

    it('does not require observations for the "intact" condition', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      const result = await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'intact',
        returnType: 'Total'
      });

      expect(result.success).toBe(true);
    });

    it('does not restock the available quantity when the condition is "unusable"', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      const result = await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'unusable',
        observations: 'Sample was damaged in transit',
        returnType: 'Total'
      });

      expect(result.newAvailableQuantity).toBe(4);
    });

    it('rejects a partial return quantity exceeding the pending amount', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jane Doe',
          condition: 'intact',
          observations: 'n/a',
          returnType: 'Parcial',
          returnQuantity: 999
        })
      ).rejects.toThrow(/Quantidade excede o pendente de devolução/);
    });

    it('rejects a partial return missing a quantity', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jane Doe',
          condition: 'intact',
          observations: 'n/a',
          returnType: 'Parcial'
        })
      ).rejects.toThrow(/Quantidade a devolver é obrigatória/);
    });

    it('requires observations when the condition is not "intact"', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jane Doe',
          condition: 'unusable',
          returnType: 'Total'
        })
      ).rejects.toThrow(/Observações são obrigatórias quando a condição não é Íntegra/);
    });

    it('falls back to a barcode lookup when the direct specimenId lookup misses', async () => {
      const db = makeDb();
      db.collections.samples.findOne
        .mockResolvedValueOnce(null) // direct specimenId lookup misses
        .mockResolvedValueOnce(withdrawnSample()); // barcode-lookup exact match

      const result = await sampleService.returnSample(db, 'BR-NOT-AN-OBJECTID', {
        returnResponsible: 'Jane Doe',
        condition: 'intact',
        returnType: 'Total'
      });

      expect(result.success).toBe(true);
    });

    // RF006 AC#6 (#297): same requirement as withdrawSample — ledger append
    // and balance update must be one atomic transaction.
    it('wraps the ledger append and balance update in a single Mongo transaction', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());

      await sampleService.returnSample(db, 'sample-1', {
        returnResponsible: 'Jane Doe',
        condition: 'intact',
        returnType: 'Total'
      });

      expect(db.client.startSession).toHaveBeenCalledTimes(1);
      expect(db.session.withTransaction).toHaveBeenCalledTimes(1);
      expect(db.session.endSession).toHaveBeenCalledTimes(1);

      const [, insertOptions] = db.collections.sample_movements.insertOne.mock.calls[0];
      const [, , updateOptions] = db.collections.samples.updateOne.mock.calls[0];
      expect(insertOptions).toEqual({ session: db.session });
      expect(updateOptions).toEqual({ session: db.session });
    });

    it('propagates a failed balance update without a partial write left standing', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(withdrawnSample());
      db.collections.samples.updateOne.mockRejectedValue(new Error('connection dropped'));

      await expect(
        sampleService.returnSample(db, 'sample-1', {
          returnResponsible: 'Jane Doe',
          condition: 'intact',
          returnType: 'Total'
        })
      ).rejects.toThrow('connection dropped');

      expect(db.collections.sample_movements.insertOne).toHaveBeenCalledTimes(1);
      expect(db.session.endSession).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------
  describe('reconcileQuantityLedger', () => {
    function reconcileDb(sample, movements) {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(sample);
      db.collections.sample_movements.find.mockReturnValue(makeCursor(movements));
      return db;
    }

    it('reconciles when the ledger head carries the specimen version and currentQuantity', async () => {
      const db = reconcileDb({ specimenId: 'SPC-1', currentQuantity: 6, quantityLedgerVersion: 2 }, [{ quantityLedgerVersion: 2, newQuantity: 6 }]);
      const result = await sampleService.reconcileQuantityLedger(db, 'SPC-1');
      expect(result.reconciled).toBe(true);
    });

    it('does not reconcile when currentQuantity differs from the ledger head', async () => {
      const db = reconcileDb({ specimenId: 'SPC-1', currentQuantity: 5, quantityLedgerVersion: 2 }, [{ quantityLedgerVersion: 2, newQuantity: 6 }]);
      const result = await sampleService.reconcileQuantityLedger(db, 'SPC-1');
      expect(result.reconciled).toBe(false);
    });

    it('does not reconcile a versioned specimen with no versioned movement', async () => {
      const db = reconcileDb({ specimenId: 'SPC-1', currentQuantity: 6, quantityLedgerVersion: 2 }, []);
      const result = await sampleService.reconcileQuantityLedger(db, 'SPC-1');
      expect(result.reconciled).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  describe('getSampleMovements', () => {
    it('queries movements by specimenId/barcode and sorts by newest first', async () => {
      const db = makeDb();
      const cursor = makeCursor([{ movementID: 2 }, { movementID: 1 }]);
      db.collections.sample_movements.find.mockReturnValue(cursor);

      const movements = await sampleService.getSampleMovements(db, 'sample-1');

      expect(db.collections.sample_movements.find).toHaveBeenCalledWith({
        $or: [{ specimenId: 'sample-1' }, { barcode: 'sample-1' }]
      });
      expect(cursor.sort).toHaveBeenCalledWith({ timestamp: -1 });
      expect(movements).toEqual([{ movementID: 2 }, { movementID: 1 }]);
    });

    it('stringifies an object-like specimenId before querying', async () => {
      const db = makeDb();
      const cursor = makeCursor([]);
      db.collections.sample_movements.find.mockReturnValue(cursor);
      const objectIdLike = { toString: () => 'sample-1' };

      await sampleService.getSampleMovements(db, objectIdLike);

      expect(db.collections.sample_movements.find).toHaveBeenCalledWith({
        $or: [{ specimenId: 'sample-1' }, { barcode: 'sample-1' }]
      });
    });

    // #1220: a legacy movement keyed by the sample's _id, under another
    // barcode, still belongs to the sample's history.
    it('returns a movement keyed by the sample _id under a different barcode', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue({ _id: 'oid-1', specimenId: 'SPC-1', barcode: 'BC-1' });
      const rows = [
        { movementID: 1, specimenId: 'oid-1', barcode: 'BC-OLD' },
        { movementID: 2, specimenId: 'other', barcode: 'BC-OTHER' },
      ];
      db.collections.sample_movements.find.mockImplementation((filter) => makeCursor(
        rows.filter((row) => filter.$or.some((arm) => Object.entries(arm).every(([key, value]) => row[key] === value))),
      ));

      const movements = await sampleService.getSampleMovements(db, 'SPC-1');

      expect(movements).toEqual([{ movementID: 1, specimenId: 'oid-1', barcode: 'BC-OLD' }]);
    });

    it('propagates an error from the collection query', async () => {
      const db = makeDb();
      db.collections.sample_movements.find.mockImplementation(() => {
        throw new Error('mongo down');
      });

      await expect(sampleService.getSampleMovements(db, 'sample-1')).rejects.toThrow('mongo down');
    });
  });

  // -------------------------------------------------------------------
  describe('getRcsAssessments', () => {
    it('resolves the specimenId from the sample document and queries rcsAssessments sorted by newest first', async () => {
      const db = makeDb({ rcsAssessments: makeCollection('rcsAssessments') });
      db.collections.samples.findOne.mockResolvedValue({ specimenId: 'sample-1', barcode: 'BR-1' });
      const cursor = makeCursor([{ rcsScore: 95 }, { rcsScore: 70 }]);
      db.collections.rcsAssessments.find.mockReturnValue(cursor);

      const assessments = await sampleService.getRcsAssessments(db, 'sample-1');

      expect(db.collections.rcsAssessments.find).toHaveBeenCalledWith({ specimenId: 'sample-1' });
      expect(cursor.sort).toHaveBeenCalledWith({ assessedAt: -1 });
      expect(assessments).toEqual([{ rcsScore: 95 }, { rcsScore: 70 }]);
    });

    it('stringifies an object-like specimenId when the sample cannot be resolved', async () => {
      const db = makeDb({ rcsAssessments: makeCollection('rcsAssessments') });
      const cursor = makeCursor([]);
      db.collections.rcsAssessments.find.mockReturnValue(cursor);
      const objectIdLike = { toString: () => 'sample-1' };

      await sampleService.getRcsAssessments(db, objectIdLike);

      expect(db.collections.rcsAssessments.find).toHaveBeenCalledWith({ specimenId: 'sample-1' });
    });

    it('propagates an error from the collection query', async () => {
      const db = makeDb({ rcsAssessments: makeCollection('rcsAssessments') });
      db.collections.rcsAssessments.find.mockImplementation(() => {
        throw new Error('mongo down');
      });

      await expect(sampleService.getRcsAssessments(db, 'sample-1')).rejects.toThrow('mongo down');
    });
  });

  // -------------------------------------------------------------------
  describe('getSprecProfiles', () => {
    it('resolves the specimenId from the sample document and queries specimenPreanalytics sorted by newest first', async () => {
      const db = makeDb({ specimenPreanalytics: makeCollection('specimenPreanalytics') });
      db.collections.samples.findOne.mockResolvedValue({ specimenId: 'sample-1', barcode: 'BR-1' });
      const cursor = makeCursor([{ matrixType: 'solid' }, { matrixType: 'fluid' }]);
      db.collections.specimenPreanalytics.find.mockReturnValue(cursor);

      const profiles = await sampleService.getSprecProfiles(db, 'sample-1');

      expect(db.collections.specimenPreanalytics.find).toHaveBeenCalledWith({ specimenId: 'sample-1' });
      expect(cursor.sort).toHaveBeenCalledWith({ recordedAt: -1 });
      expect(profiles).toEqual([{ matrixType: 'solid' }, { matrixType: 'fluid' }]);
    });

    it('stringifies an object-like specimenId when the sample cannot be resolved', async () => {
      const db = makeDb({ specimenPreanalytics: makeCollection('specimenPreanalytics') });
      const cursor = makeCursor([]);
      db.collections.specimenPreanalytics.find.mockReturnValue(cursor);
      const objectIdLike = { toString: () => 'sample-1' };

      await sampleService.getSprecProfiles(db, objectIdLike);

      expect(db.collections.specimenPreanalytics.find).toHaveBeenCalledWith({ specimenId: 'sample-1' });
    });

    it('propagates an error from the collection query', async () => {
      const db = makeDb({ specimenPreanalytics: makeCollection('specimenPreanalytics') });
      db.collections.specimenPreanalytics.find.mockImplementation(() => {
        throw new Error('mongo down');
      });

      await expect(sampleService.getSprecProfiles(db, 'sample-1')).rejects.toThrow('mongo down');
    });
  });

  // -------------------------------------------------------------------
  describe('findAvailableSamplesForResearch', () => {
    it('forces specimenStatus to available even if the caller requests something else', async () => {
      const db = makeDb();
      const cursor = makeCursor([{ specimenStatus: 'available' }]);
      db.collections.samples.find.mockReturnValue(cursor);

      const result = await sampleService.findAvailableSamplesForResearch(db, {
        specimenStatus: 'quarantined',
        sampleType: 'PLASMA'
      });

      // RF006 AC3: a depleted specimen is available in state but unusable.
      expect(db.collections.samples.find).toHaveBeenCalledWith({
        sampleType: 'PLASMA',
        specimenStatus: 'available',
        quantityStatus: { $ne: 'depleted' }
      });
      expect(result).toEqual([{ specimenStatus: 'available' }]);
    });
  });

  // -------------------------------------------------------------------
  // RF026 AC7 (dictionary RULE-006): closing a fully consumed specimen.
  describe('closeSpecimen', () => {
    function consumedSample(overrides = {}) {
      return {
        _id: 'sample-1', specimenId: 'SPC-C', specimenStatus: 'available',
        quantity: 10, initialQuantity: 10, currentQuantity: 0, ...overrides,
      };
    }

    it('closes a depleted specimen and appends an OperationalStateDecision with the write', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(consumedSample());

      const result = await sampleService.closeSpecimen(db, 'SPC-C', { actorId: 'user-1' });

      expect(result).toMatchObject({ specimenId: 'SPC-C', previousStatus: 'available', specimenStatus: 'closed', quantityStatus: 'depleted' });
      const [filter, update] = db.collections.samples.updateOne.mock.calls[0];
      expect(filter).toEqual({ _id: 'sample-1', specimenStatus: 'available' });
      expect(update.$set).toMatchObject({ specimenStatus: 'closed', quantityStatus: 'depleted' });
      const [decision] = db.collections.operationalStateDecisions.insertOne.mock.calls[0];
      expect(decision).toMatchObject({
        specimenId: 'SPC-C', previousStatus: 'available', newStatus: 'closed',
        rulesApplied: ['rf026_ac7_validated_consumption'], reasonCodes: ['total_consumption'],
      });
      expect(decision.triggerEventId).toMatch(/^sample-close:/);
      expect(result.operationalStateDecisionId).toBe(decision.operationalStateDecisionId);
    });

    it('closes a not-yet-migrated v1.3.0 depleted specimen, recording it from available', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(consumedSample({ specimenStatus: 'depleted' }));
      await sampleService.closeSpecimen(db, 'SPC-C');
      expect(db.collections.samples.updateOne.mock.calls[0][0]).toEqual({ _id: 'sample-1', specimenStatus: 'depleted' });
      expect(db.collections.operationalStateDecisions.insertOne.mock.calls[0][0]).toMatchObject({ previousStatus: 'available', newStatus: 'closed' });
    });

    it.each([
      ['material remains (partial)', { currentQuantity: 4 }, /consumo total validado: quantityStatus é partial/],
      ['material remains (full), whatever a stale stored quantityStatus says', { currentQuantity: 10, quantityStatus: 'depleted' }, /quantityStatus é full/],
      ['it is already closed', { specimenStatus: 'closed' }, /já está encerrada/],
    ])('refuses (409) when %s, and writes nothing', async (_label, overrides, message) => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(consumedSample(overrides));
      await expect(sampleService.closeSpecimen(db, 'SPC-C')).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(message) });
      expect(db.collections.samples.updateOne).not.toHaveBeenCalled();
    });

    it('returns null for an unknown specimen', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);
      expect(await sampleService.closeSpecimen(db, 'missing')).toBeNull();
    });
  });
});
