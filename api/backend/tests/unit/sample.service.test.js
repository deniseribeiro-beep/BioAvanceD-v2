import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const allocateSampleUseCasePath = require.resolve('../../src/core/use-cases/AllocateSampleUseCase');
const mongoStorageRepositoryPath = require.resolve('../../src/infrastructure/persistence/mongo/MongoStorageRepository');

let currentCanonicalPlacement = null;
let currentAllocateExecute = vi.fn(async () => ({
  success: true,
  currentStoragePlacement: currentCanonicalPlacement,
  lineageQueued: true,
  lineageEventId: 'evt-create-allocation'
}));
let currentFindCurrentStoragePlacement = vi.fn(async () => currentCanonicalPlacement);

function StableAllocateSampleUseCase() {
  this.execute = (...args) => currentAllocateExecute(...args);
}
function StableMongoStorageRepository() {
  this.findCurrentStoragePlacement = (...args) => currentFindCurrentStoragePlacement(...args);
}

require.cache[allocateSampleUseCasePath] = {
  id: allocateSampleUseCasePath,
  filename: allocateSampleUseCasePath,
  loaded: true,
  exports: StableAllocateSampleUseCase
};
require.cache[mongoStorageRepositoryPath] = {
  id: mongoStorageRepositoryPath,
  filename: mongoStorageRepositoryPath,
  loaded: true,
  exports: StableMongoStorageRepository
};

const sampleService = require('../../src/services/sample.service');
const qualityDomain = require('../../src/services/quality-domain.service');
const rcsReferenceData = require('../../src/services/rcs-reference-data');
const { ObjectId } = require('mongodb');

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
    results: makeCollection('results'),
    ...overrides
  };
  const session = makeSession();
  return {
    collections,
    collection: vi.fn((name) => collections[name] || (collections[name] = makeCollection(name))),
    // no listCollections -> collectionResolver falls back to canonical names directly
    client: {
      db: vi.fn(() => ({ command: vi.fn().mockResolvedValue({ setName: 'rs0', isWritablePrimary: true }) })),
      startSession: vi.fn(() => session)
    },
    session
  };
}

function completeGovernanceEvidence(overrides = {}) {
  return Object.fromEntries(
    rcsReferenceData.governanceEvidenceCategories.map(({ key }) => [
      key,
      Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : 'satisfied',
    ])
  );
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
    // The allocation use case resolves governed layout hierarchy from
    // storagePaths while physical custody itself is persisted by the normalized v2 chain.
    storagePaths: {
      findOne: vi.fn().mockResolvedValue({ boxId: BOX_ID, rackId: RACK_ID, shelfId: SHELF_ID, freezerId: FREEZER_ID })
    },  };

  db.collection.mockImplementation((name) => {
    if (mocked[name]) return mocked[name];
    return db.collections[name] || (db.collections[name] = makeCollection(name));
  });

  // #474: AllocateSampleUseCase looks the sample back up by _id (once before
  // the Mongo transaction for the lineage payload, once inside it) after
  // createSample's own insertOne — distinct from the specimenId/barcode
  // duplicate-check lookups earlier in the same call, which keep resolving
  // null (the default from makeCollection) unless a test overrides them.
  db.collections.samples.findOne.mockImplementation((query) => {
    if (query && query._id !== undefined) {
      return Promise.resolve({ _id: query._id, specimenId: String(query._id), barcode: null });
    }
    return Promise.resolve(null);
  });
}

describe('sample.service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    currentCanonicalPlacement = {
      specimenId: '555001',
      boxId: BOX_ID.toString(),
      positionCode: 'A1',
      storageRackId: RACK_ID.toString(),
      storagePositionId: `${RACK_ID}:A1`
    };
    currentAllocateExecute = vi.fn(async () => ({
      success: true,
      currentStoragePlacement: currentCanonicalPlacement,
      lineageQueued: true,
      lineageEventId: 'evt-create-allocation'
    }));
    currentFindCurrentStoragePlacement = vi.fn(async () => currentCanonicalPlacement);
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
      // This unit isolates SampleService: the canonical allocation use case is
      // doubled here and its own immutable audit/outbox behavior is covered
      // by AllocateSampleUseCase + storage integration tests.
      expect(db.collections.sample_movements.insertOne).toHaveBeenCalledTimes(1);
      const [movementArg] = db.collections.sample_movements.insertOne.mock.calls[0];
      expect(movementArg.type).toBe('create');
      expect(movementArg.destination).toBe(`storage:${BOX_ID.toString()}:A1`);
    });

    it('keeps physical custody out of the Sample document and exposes currentStoragePlacement as a read model', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      currentCanonicalPlacement = {
        specimenId: '555001',
        boxId: BOX_ID.toString(),
        positionCode: 'B2',
        storageRackId: RACK_ID.toString(),
        storagePositionId: `${RACK_ID}:B2`
      };

      const result = await sampleService.createSample(db, validSampleData({ positionCode: 'B2' }));
      const [insertedSample] = db.collections.samples.insertOne.mock.calls[0];

      expect(insertedSample.currentStoragePlacement).toBeUndefined();
      expect(result.currentStoragePlacement).toEqual(currentCanonicalPlacement);
      expect(result.locationID).toBeNull();
    });

    it('delegates initial physical custody to AllocateSampleUseCase using the canonical box/position command', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      currentCanonicalPlacement = {
        specimenId: '555001',
        boxId: BOX_ID.toString(),
        positionCode: 'B2',
        storageRackId: RACK_ID.toString(),
        storagePositionId: `${RACK_ID}:B2`
      };

      await sampleService.createSample(db, validSampleData({ positionCode: 'B2' }), {
        auditInfo: { userId: 'user-1', userName: 'Tester', userRole: 'Coordenador' }
      });

      expect(currentAllocateExecute).toHaveBeenCalledWith(expect.objectContaining({
        specimenId: 'generated-id',
        boxId: BOX_ID.toString(),
        position: 'B2',
        actor: expect.objectContaining({ userId: 'user-1', userName: 'Tester', userRole: 'Coordenador' })
      }));
      expect(currentFindCurrentStoragePlacement).toHaveBeenCalledWith('555001');
    });

    it('removes the newborn Sample when canonical allocation fails instead of leaving split custody state', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      currentAllocateExecute = vi.fn(async () => { throw new Error('STORAGE_COLLISION: position occupied'); });

      await expect(sampleService.createSample(db, validSampleData())).rejects.toMatchObject({ statusCode: 409 });
      expect(db.collections.samples.deleteOne).toHaveBeenCalledWith({ _id: 'generated-id' });
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

    it('rolls back the inserted sample when the ledger append fails', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      db.collections.sample_movements.insertOne.mockRejectedValue(new Error('ledger down'));

      await expect(sampleService.createSample(db, validSampleData())).rejects.toThrow(
        /Falha ao registrar cadeia de custódia/
      );
      expect(db.collections.samples.deleteOne).toHaveBeenCalledWith({ _id: 'generated-id' });
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

    it('does not persist a client-supplied legacy location object (#400 — canonical placement is normalized outside Sample)', async () => {
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
          model_version: 'RCS-GOV-1.0',
          matrix_type: 'fluid',
          governance_failure_reasons: [],
          governance_rule_codes: [],
          grade_route: 'DIRECT',
          axis_penalties: [],
          calculation_trace: {}
        });

        const sprec = {
          matrixType: 'fluid',
          sampleType: 'BLD',
          primaryContainer: 'SST',
          preCentrifugation: 'A',
          centrifugation: 'A',
          secondCentrifugation: 'A',
          postCentrifugationDelay: 'A',
          longTermStorage: 'C',
        };
        const governanceEvidence = completeGovernanceEvidence();
        const input = validSampleData({
          matrixType: 'fluid',
          sprec,
          governanceEvidence,
        });
        const result = await sampleService.createSample(db, input);

        expect(qualityDomain.resolveMethodologicalQuality).toHaveBeenCalledWith(
          expect.objectContaining({
            matrixType: 'fluid',
            sprec,
            governanceEvidence,
          })
        );
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
      // #405: specimenStatus is the source of truth; the legacy
      // lifecycleStatus/availabilityStatus dual-write was removed in #408.
      expect(updateArg.$set.specimenStatus).toBe('depleted');
      expect(updateArg.$set.lifecycleStatus).toBeUndefined();
      expect(updateArg.$set.availabilityStatus).toBeUndefined();
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
      expect(result).toEqual({ samples: [{ specimenId: 1, specimenStatus: 'available' }], total: 1, limit: 5, skip: 1 });
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

    // #340: org-scoped caller sees only samples whose collectionSite is one
    // of their scoped organizations.
    it('restricts the query to collectionSite $in organizationIds for an organization scope', async () => {
      const db = makeDb();
      await sampleService.listSamples(db, {
        organizationScope: { scope: 'organization', organizationIds: ['org-1', 'org-2'] }
      });

      expect(db.collections.samples.find).toHaveBeenCalledWith({
        collectionSite: { $in: ['org-1', 'org-2'] }
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

    it('recomputes lifecycle status and persists the update', async () => {
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
        .mockResolvedValueOnce({ ...existing, currentQuantity: 4 }); // post-update re-fetch

      const result = await sampleService.updateSample(db, 'sample-1', { currentQuantity: 4 });

      expect(db.collections.samples.updateOne).toHaveBeenCalledTimes(1);
      const [, updateArg] = db.collections.samples.updateOne.mock.calls[0];
      // #405: specimenStatus is the source of truth; the legacy
      // lifecycleStatus/availabilityStatus dual-write was removed in #408.
      expect(updateArg.$set.specimenStatus).toBe('partial');
      expect(updateArg.$set.lifecycleStatus).toBeUndefined();
      expect(updateArg.$set.availabilityStatus).toBeUndefined();
      expect(result.currentQuantity).toBe(4);
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
    it('returns true when a sample was deleted', async () => {
      const db = makeDb();
      db.collections.samples.deleteOne.mockResolvedValue({ deletedCount: 1 });

      expect(await sampleService.deleteSample(db, 'sample-1')).toBe(true);
    });

    it('returns false when nothing matched', async () => {
      const db = makeDb();
      db.collections.samples.deleteOne.mockResolvedValue({ deletedCount: 0 });

      expect(await sampleService.deleteSample(db, 'missing')).toBe(false);
    });

    it('propagates an error from the collection delete', async () => {
      const db = makeDb();
      db.collections.samples.deleteOne.mockRejectedValue(new Error('mongo down'));

      await expect(sampleService.deleteSample(db, 'sample-1')).rejects.toThrow('mongo down');
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

    it('uses exact encodedValue matching without case, numeric or regex compatibility fallbacks', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      const result = await sampleService.getSampleByBarcode(db, 'br-upper');

      expect(result).toEqual({ sample: null, participant: null });
      expect(db.collections.samples.findOne).toHaveBeenCalledTimes(1);
      expect(db.collections.samples.findOne).toHaveBeenCalledWith({ barcode: 'br-upper' });
    });

    it('does not coerce all-digit encoded values to numeric legacy barcodes', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValue(null);

      const result = await sampleService.getSampleByBarcode(db, '123456');

      expect(result).toEqual({ sample: null, participant: null });
      expect(db.collections.samples.findOne).toHaveBeenCalledTimes(1);
      expect(db.collections.samples.findOne).toHaveBeenCalledWith({ barcode: '123456' });
    });

    it('rejects retired QR and Code128 scanner prefixes', async () => {
      const db = makeDb();

      await expect(sampleService.getSampleByBarcode(db, ']Q3BR-1')).rejects.toThrow(
        'apenas Data Matrix canônico'
      );
      await expect(sampleService.getSampleByBarcode(db, ']C1BR-1')).rejects.toThrow(
        'apenas Data Matrix canônico'
      );
      expect(db.collections.samples.findOne).not.toHaveBeenCalled();
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
      expect(assets.encodedValue).toBe('BR-2024-001');
      expect(assets.symbology).toBe('data_matrix');
      expect(assets.dataMatrix.imagePng).toBeDefined();
      expect(assets.code128).toBeUndefined();
      expect(assets.qr).toBeUndefined();
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

      // #405: specimenStatus is the source of truth; the legacy
      // lifecycleStatus/availabilityStatus dual-write was removed in #408.
      const [, updateArg] = db.collections.samples.updateOne.mock.calls[0];
      expect(updateArg.$set.specimenStatus).toBe('available');
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

      expect(db.collections.samples.find).toHaveBeenCalledWith({
        sampleType: 'PLASMA',
        specimenStatus: 'available'
      });
      expect(result).toEqual([{ specimenStatus: 'available' }]);
    });
  });

describe('sample.service item 8 residual branch coverage', () => {
  it('accepts ObjectId box input and rejects a non-string positionCode', async () => {
    const db = makeDb();

    await expect(
      sampleService.createSample(db, validSampleData({ boxId: BOX_ID, positionCode: 12 }))
    ).rejects.toThrow(/positionCode é obrigatório/);
  });

  it('rejects an incomplete storage hierarchy when the box has no parent', async () => {
    const db = makeDb();
    mockOperationalStorage(db);
    const originalImpl = db.collection.getMockImplementation();
    const storageBoxes = {
      findOne: vi.fn().mockResolvedValue({ _id: BOX_ID, parent_id: null, dimension: { rows: 1, cols: 1 } }),
    };
    db.collection.mockImplementation((name) => name === 'storageBoxes' ? storageBoxes : originalImpl(name));

    await expect(sampleService.createSample(db, validSampleData()))
      .rejects.toThrow(/hierarquia de armazenamento incompleta/);
  });

  it('rejects a drawer chain whose drawer has no parent rack', async () => {
    const db = makeDb();
    mockOperationalStorage(db);
    const originalImpl = db.collection.getMockImplementation();
    const storageBoxes = {
      findOne: vi.fn().mockResolvedValue({ _id: BOX_ID, parent_id: RACK_ID, dimension: { rows: 1, cols: 1 } }),
    };
    const storageContainers = {
      findOne: vi.fn().mockResolvedValue({ _id: RACK_ID, containerType: 'DRAWER', parent_id: null }),
    };
    db.collection.mockImplementation((name) => {
      if (name === 'storageBoxes') return storageBoxes;
      if (name === 'storageContainers') return storageContainers;
      return originalImpl(name);
    });

    await expect(sampleService.createSample(db, validSampleData()))
      .rejects.toThrow(/hierarquia de armazenamento incompleta/);
  });

  it('covers the generic validation message when SampleModel reports no detailed errors', async () => {
    const { SampleModel } = require('../../src/models/Sample');
    const validateSpy = vi.spyOn(SampleModel, 'validate').mockReturnValue({ isValid: false, errors: [] });
    const db = makeDb();

    await expect(sampleService.createSample(db, validSampleData()))
      .rejects.toThrow('Dados da amostra inválidos conforme modelo MIABIS/BioAvanceD');

    validateSpy.mockRestore();
  });

  it('rejects missing study, protocol and collection references with 404', async () => {
    let db = makeDb({ studies: makeCollection('studies') });
    mockOperationalStorage(db);
    db.collections.studies.findOne.mockResolvedValue(null);
    await expect(sampleService.createSample(db, validSampleData({ studyId: 'STU-404' })))
      .rejects.toMatchObject({ statusCode: 404 });

    db = makeDb({ protocols: makeCollection('protocols') });
    mockOperationalStorage(db);
    db.collections.protocols.findOne.mockResolvedValue(null);
    await expect(sampleService.createSample(db, validSampleData({ protocolId: 'PRO-404' })))
      .rejects.toMatchObject({ statusCode: 404 });

    db = makeDb({ collections: makeCollection('collections') });
    mockOperationalStorage(db);
    db.collections.collections.findOne.mockResolvedValue(null);
    await expect(sampleService.createSample(db, validSampleData({ collectionId: 'COL-404' })))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('accepts a registered collection reference and persists it', async () => {
    const db = makeDb({ collections: makeCollection('collections') });
    mockOperationalStorage(db);
    db.collections.collections.findOne.mockResolvedValue({ collectionId: 'COL-1' });

    const result = await sampleService.createSample(db, validSampleData({ collectionId: 'COL-1' }));

    expect(result.collectionId).toBe('COL-1');
    expect(db.collections.collections.findOne).toHaveBeenCalledWith({ collectionId: 'COL-1' });
  });

  it('rejects missing equipment and covers maintenanceStatus sensor diagnostics', async () => {
    let db = makeDb();
    mockOperationalStorage(db);
    let originalImpl = db.collection.getMockImplementation();
    const missingEquipment = { findOne: vi.fn().mockResolvedValue(null) };
    db.collection.mockImplementation((name) => name === 'equipment' ? missingEquipment : originalImpl(name));

    await expect(sampleService.createSample(db, validSampleData()))
      .rejects.toThrow(/Equipamento vinculado.*não está cadastrado/);

    db = makeDb();
    mockOperationalStorage(db);
    originalImpl = db.collection.getMockImplementation();
    const maintenanceSensor = { findOne: vi.fn().mockResolvedValue({ maintenanceStatus: 'maintenance' }) };
    db.collection.mockImplementation((name) => name === 'sensors' ? maintenanceSensor : originalImpl(name));

    await expect(sampleService.createSample(db, validSampleData()))
      .rejects.toThrow(/status maintenance/);
  });

  it('accepts operationalStatus-only and blank-status sensors', async () => {
    for (const sensor of [{ operationalStatus: 'ok' }, {}]) {
      const db = makeDb();
      mockOperationalStorage(db);
      const originalImpl = db.collection.getMockImplementation();
      const sensors = { findOne: vi.fn().mockResolvedValue(sensor) };
      db.collection.mockImplementation((name) => name === 'sensors' ? sensors : originalImpl(name));

      const suffix = sensor.operationalStatus ? 'OPERATIONAL' : 'BLANK';
      const result = await sampleService.createSample(db, validSampleData({
        specimenId: sensor.operationalStatus ? 600010 : 600011,
        barcode: `BR-SENSOR-${suffix}`,
      }));
      expect(result).toBeDefined();
    }
  });

  it('generates a barcode for blank input and normalizes a numeric barcode', async () => {
    let db = makeDb();
    mockOperationalStorage(db);
    let result = await sampleService.createSample(db, validSampleData({
      specimenId: 600001,
      barcode: '   ',
    }));
    expect(result.barcode).toMatch(/^BR-/);

    db = makeDb();
    mockOperationalStorage(db);
    result = await sampleService.createSample(db, validSampleData({
      specimenId: 600002,
      barcode: 12345,
    }));
    expect(result.barcode).toBe('12345');
  });

  it('records RCS/SPREC snapshots after successful creation and keeps their ids on the returned sample', async () => {
    const rcsAssessmentService = require('../../src/services/rcs-assessment.service');
    const specimenPreanalyticsService = require('../../src/services/specimen-preanalytics.service');

    vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
      model_version: 'RCS-GOV-1.0',
      matrix_type: 'fluid',
      governance_status: 1,
      governance_failure_reasons: null,
      governance_rule_codes: null,
      rcs_score: 88,
      score_based_grade: 'B',
      final_grade: null,
      grade_route: 'score',
      axis_penalties: null,
      calculation_trace: null,
    });
    const assessmentSpy = vi.spyOn(rcsAssessmentService, 'recordAssessment')
      .mockResolvedValue({ _id: 'assessment-1' });
    const profileSpy = vi.spyOn(specimenPreanalyticsService, 'recordProfile')
      .mockResolvedValue({ _id: 'profile-1' });

    const db = makeDb();
    mockOperationalStorage(db);
    const result = await sampleService.createSample(db, validSampleData({
      specimenId: 600003,
      barcode: 'BR-RCS-1',
      sprec: { matrixType: 'fluid' },
    }));

    expect(result.sealedRcsAssessmentId).toBe('assessment-1');
    expect(result.sealedSpecimenPreanalyticsId).toBe('profile-1');
    expect(assessmentSpy).toHaveBeenCalled();
    expect(profileSpy).toHaveBeenCalled();
  });

  it('keeps RCS/SPREC snapshot persistence best-effort when both secondary writes fail', async () => {
    const rcsAssessmentService = require('../../src/services/rcs-assessment.service');
    const specimenPreanalyticsService = require('../../src/services/specimen-preanalytics.service');

    vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({
      model_version: 'RCS-GOV-1.0',
      matrix_type: 'fluid',
      governance_status: 1,
      governance_failure_reasons: [],
      governance_rule_codes: [],
      rcs_score: 88,
      score_based_grade: 'B',
      final_grade: 'B',
      grade_route: 'score',
      axis_penalties: [],
      calculation_trace: {},
    });
    vi.spyOn(rcsAssessmentService, 'recordAssessment').mockRejectedValue(new Error('assessment down'));
    vi.spyOn(specimenPreanalyticsService, 'recordProfile').mockRejectedValue(new Error('profile down'));

    const db = makeDb();
    mockOperationalStorage(db);
    const result = await sampleService.createSample(db, validSampleData({
      specimenId: 600004,
      barcode: 'BR-RCS-2',
      sprec: { matrixType: 'fluid' },
    }));

    expect(result._id).toBe('generated-id');
    expect(result.sealedRcsAssessmentId).toBeNull();
    expect(result.sealedSpecimenPreanalyticsId).toBeNull();
  });

  it('uses actorName fallback for creation audit actor and maps non-collision allocation errors to 422', async () => {
    let db = makeDb();
    mockOperationalStorage(db);
    await sampleService.createSample(db, validSampleData({
      specimenId: 600005,
      barcode: 'BR-ACTOR-1',
    }), { auditInfo: { actorName: 'Fallback Actor' } });

    const birthMovement = db.collections.sample_movements.insertOne.mock.calls[0][0];
    expect(birthMovement.responsible).toBe('Fallback Actor');
    expect(currentAllocateExecute.mock.calls[0][0].actor.userName).toBe('Fallback Actor');

    db = makeDb();
    mockOperationalStorage(db);
    currentAllocateExecute = vi.fn(async () => {
      throw { toString: () => 'ordinary allocation failure' };
    });
    await expect(sampleService.createSample(db, validSampleData({
      specimenId: 600006,
      barcode: 'BR-ALLOC-1',
    }))).rejects.toMatchObject({ statusCode: 422 });
  });

  it('maps the Portuguese already-allocated error wording to 409', async () => {
    const db = makeDb();
    mockOperationalStorage(db);
    currentAllocateExecute = vi.fn(async () => {
      throw new Error('posição já está alocada');
    });

    await expect(sampleService.createSample(db, validSampleData({
      specimenId: 600007,
      barcode: 'BR-ALLOC-2',
    }))).rejects.toMatchObject({ statusCode: 409 });
  });

  it('covers withdrawal blocked status, exhausted quantity and quantity fallback branches', async () => {
    let db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      specimenId: 'S1', specimenStatus: 'quarantined', quantity: 10, currentQuantity: 10,
    });
    await expect(sampleService.withdrawSample(db, 'S1', {
      withdrawalType: 'Total',
      withdrawalResponsible: 'Jane Doe',
      linkedProject: 'P1',
    })).rejects.toThrow(/não está disponível para retirada/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      specimenId: 'S2', specimenStatus: 'available', quantity: 10, currentQuantity: 0, unit: null,
    });
    await expect(sampleService.withdrawSample(db, 'S2', {
      withdrawalType: 'Total',
      withdrawalResponsible: 'Jane Doe',
      linkedProject: 'P1',
    })).rejects.toThrow(/Quantidade indisponível/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      specimenId: 'S3', specimenStatus: 'available', quantity: 5, currentQuantity: undefined,
      totalWithdrawn: null, unit: null, barcode: null,
    });
    const result = await sampleService.withdrawSample(db, 'S3', {
      withdrawalType: 'Total',
      withdrawalResponsible: 'Jane Doe',
      linkedProject: 'P1',
      withdrawalDestination: 'Lab B',
      justification: 'Assay',
      notes: 'Synthetic withdrawal',
    });
    expect(result.withdrawnQuantity).toBe(5);
    expect(result.remainingQuantity).toBe(0);
  });

  it('covers partial-withdrawal missing/excess quantities and fallback destination/purpose fields', async () => {
    const base = {
      specimenId: 'S4',
      specimenStatus: 'available',
      quantity: 10,
      currentQuantity: 10,
      initialQuantity: 10,
      unit: 'mL',
      barcode: 'B4',
      linkedProject: 'stored-project',
    };

    let db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ ...base });
    await expect(sampleService.withdrawSample(db, 'S4', {
      withdrawalType: 'Parcial',
      withdrawalResponsible: 'Jane Doe',
      linkedProject: 'P1',
    })).rejects.toThrow(/Quantidade a retirar é obrigatória/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ ...base });
    await expect(sampleService.withdrawSample(db, 'S4', {
      withdrawalType: 'Parcial',
      withdrawalQuantity: 99,
      withdrawalResponsible: 'Jane Doe',
      linkedProject: 'P1',
    })).rejects.toThrow(/Quantidade indisponível/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ ...base });
    const result = await sampleService.withdrawSample(db, 'S4', {
      withdrawalType: 'Parcial',
      quantity: 2,
      withdrawalResponsible: 'Jane Doe',
      linkedProject: 'P1',
      withdrawalDestination: 'Lab C',
      justification: 'Research use',
      notes: 'fallback notes',
    }, {
      userId: 'u1',
      userName: 'User One',
      userRole: 'Curator',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(result.withdrawnQuantity).toBe(2);
    const movement = db.collections.sample_movements.insertOne.mock.calls[0][0];
    expect(movement.destination).toBe('Lab C');
    expect(movement.purpose).toBe('Research use');
    expect(movement.observations).toBe('fallback notes');
  });

  it('applies every listSamples filter including organization scope', async () => {
    const db = makeDb();
    const cursor = makeCursor([{ specimenId: 'S1' }]);
    db.collections.samples.find.mockReturnValue(cursor);
    db.collections.samples.countDocuments.mockResolvedValue(1);

    const result = await sampleService.listSamples(db, {
      participantId: 'P1',
      specimenStatus: 'available',
      sampleType: 'PLASMA',
      organizationScope: { scope: 'organization', organizationIds: ['ORG-1', 'ORG-2'] },
      limit: 7,
      skip: 3,
    });

    expect(db.collections.samples.find).toHaveBeenCalledWith({
      participantId: 'P1',
      specimenStatus: 'available',
      sampleType: 'PLASMA',
      collectionSite: { $in: ['ORG-1', 'ORG-2'] },
    });
    expect(result.limit).toBe(7);
    expect(result.skip).toBe(3);
  });

  it('finds samples only by exact canonical encodedValue', async () => {
    const db = makeDb();
    db.collections.samples.findOne.mockResolvedValueOnce({
      _id: 'x',
      barcode: 'ABC',
      specimenStatus: 'available',
    });

    const result = await sampleService.getSampleByBarcode(db, ']d2ABC');

    expect(result.sample).toMatchObject({ _id: 'x', barcode: 'ABC' });
    expect(db.collections.samples.findOne).toHaveBeenCalledTimes(1);
    expect(db.collections.samples.findOne).toHaveBeenCalledWith({ barcode: 'ABC' });
  });

  it('returns the explicit not-found barcode shape and logs example barcodes', async () => {
    const db = makeDb();
    db.collections.samples.findOne.mockResolvedValue(null);
    db.collections.samples.countDocuments.mockResolvedValue(2);
    db.collections.samples.find.mockReturnValue(makeCursor([{ barcode: 'ONE' }, { barcode: 'TWO' }]));

    const result = await sampleService.getSampleByBarcode(db, 'MISSING');

    expect(result).toEqual({ sample: null, participant: null });
  });

  it('covers participant resolution with no identity, one-word identity and multi-word identity', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');

    let db = makeDb({ participantIdentities: makeCollection('participantIdentities') });
    db.collections.samples.findOne.mockResolvedValue({
      _id: 's1', barcode: 'B1', specimenStatus: 'available', participantId: 'P1',
    });
    db.collections.patients.findOne.mockResolvedValue({ participantId: 'P1', recordNumber: 'R1' });
    db.collections.participantIdentities.findOne.mockResolvedValue(null);
    let result = await sampleService.getSampleByBarcode(db, 'B1');
    expect(result.participant.patientName).toBe('***');

    db = makeDb({ participantIdentities: makeCollection('participantIdentities') });
    db.collections.samples.findOne.mockResolvedValue({
      _id: 's2', barcode: 'B2', specimenStatus: 'available', participantId: 'P2',
    });
    db.collections.patients.findOne.mockResolvedValue({ participantId: 'P2', recordNumber: 'R2' });
    db.collections.participantIdentities.findOne.mockResolvedValue({ participantId: 'P2' });
    vi.spyOn(participantIdentityService, 'decryptIdentity').mockReturnValueOnce({ patientName: 'Alice' });
    result = await sampleService.getSampleByBarcode(db, 'B2');
    expect(result.participant.patientName).toBe('A***');

    db = makeDb({ participantIdentities: makeCollection('participantIdentities') });
    db.collections.samples.findOne.mockResolvedValue({
      _id: 's3', barcode: 'B3', specimenStatus: 'available', participantId: 'P3',
    });
    db.collections.patients.findOne.mockResolvedValue({ participantId: 'P3', recordNumber: 'R3' });
    db.collections.participantIdentities.findOne.mockResolvedValue({ participantId: 'P3' });
    vi.spyOn(participantIdentityService, 'decryptIdentity').mockReturnValueOnce({ patientName: 'Alice Example' });
    result = await sampleService.getSampleByBarcode(db, 'B3');
    expect(result.participant.patientName).toBe('A. E.');
  });

  it('covers barcode sample branches with no participant id and missing participant record', async () => {
    let db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      _id: 's1', barcode: 'B1', specimenStatus: 'available',
    });
    let result = await sampleService.getSampleByBarcode(db, 'B1');
    expect(result.participant).toBeNull();

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      _id: 's2', barcode: 'B2', specimenStatus: 'available', participantId: 'P2',
    });
    db.collections.patients.findOne.mockResolvedValue(null);
    result = await sampleService.getSampleByBarcode(db, 'B2');
    expect(result.participant).toBeNull();
  });

  it('blocks returns for governed blocked statuses and covers partial quantity fallback', async () => {
    let db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      specimenId: 'S1',
      specimenStatus: 'destroyed',
      totalWithdrawn: 5,
      totalReturned: 0,
    });
    await expect(sampleService.returnSample(db, 'S1', {
      returnResponsible: 'Jane Doe',
      condition: 'intact',
      returnType: 'Total',
    })).rejects.toThrow(/não está disponível para devolução/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      specimenId: 'S2',
      specimenStatus: 'available',
      quantity: 10,
      initialQuantity: 10,
      currentQuantity: 4,
      totalWithdrawn: 6,
      totalReturned: 1,
      barcode: null,
      unit: null,
      linkedProject: 'stored-project',
    });
    const result = await sampleService.returnSample(db, 'S2', {
      returnResponsible: 'Jane Doe',
      condition: 'intact',
      returnType: 'Parcial',
      quantity: 2,
      linkedProject: '',
      notes: 'return notes',
    });
    expect(result.returnedQuantity).toBe(2);
    expect(result.newAvailableQuantity).toBe(6);
  });

  it('uses both resolved and unresolved identifiers when reading quarantine action history', async () => {
    const quarantineActionService = require('../../src/services/quarantine-action.service');
    const actionSpy = vi.spyOn(quarantineActionService, 'getActionsForSpecimen')
      .mockResolvedValue([{ quarantineActionId: 'Q1' }]);

    let db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ specimenId: 'SPEC-1' });
    await sampleService.getQuarantineActions(db, 'business-key');
    expect(actionSpy).toHaveBeenLastCalledWith(db, 'SPEC-1');

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue(null);
    const idWithoutToString = Object.create(null);
    await sampleService.getQuarantineActions(db, idWithoutToString);
    expect(actionSpy).toHaveBeenLastCalledWith(db, idWithoutToString);
  });

  it('falls back from a canonical ObjectId lookup to specimenId when the _id lookup misses', async () => {
    const db = makeDb();
    const id = '507f1f77bcf86cd799439011';
    db.collections.samples.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ specimenId: id, specimenStatus: 'available' });

    const result = await sampleService.getSample(db, id);

    expect(result.specimenId).toBe(id);
    expect(db.collections.samples.findOne).toHaveBeenNthCalledWith(1, { _id: expect.any(ObjectId) });
    expect(db.collections.samples.findOne).toHaveBeenNthCalledWith(2, { specimenId: id });
  });

  it('resolves a BOX -> DRAWER -> RACK -> SHELF -> FREEZER hierarchy without changing canonical custody semantics', async () => {
    const db = makeDb();
    mockOperationalStorage(db);
    const DRAWER_ID = new ObjectId();
    const originalImpl = db.collection.getMockImplementation();
    const storageBoxes = {
      findOne: vi.fn().mockResolvedValue({ _id: BOX_ID, parent_id: DRAWER_ID, dimension: { rows: 8, cols: 12 } }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
    };
    const chain = new Map([
      [String(DRAWER_ID), { _id: DRAWER_ID, containerType: 'DRAWER', parent_id: RACK_ID }],
      [String(RACK_ID), { _id: RACK_ID, containerType: 'RACK', parent_id: SHELF_ID }],
      [String(SHELF_ID), { _id: SHELF_ID, containerType: 'SHELF', parent_id: FREEZER_ID }],
      [String(FREEZER_ID), { _id: FREEZER_ID, containerType: 'FREEZER', containerID: 'EQ-1' }]
    ]);
    const storageContainers = {
      findOne: vi.fn(({ _id }) => Promise.resolve(chain.get(String(_id)) || null))
    };
    db.collection.mockImplementation((name) => {
      if (name === 'storageBoxes') return storageBoxes;
      if (name === 'storageContainers') return storageContainers;
      return originalImpl(name);
    });

    const result = await sampleService.createSample(db, validSampleData({
      specimenId: 600020,
      barcode: 'BR-DRAWER-1',
    }));

    expect(result).toBeDefined();
    expect(storageContainers.findOne).toHaveBeenCalledWith({ _id: RACK_ID });
  });

  it('accepts equipment readiness from maintenanceStatus or operationalStatus fallbacks', async () => {
    for (const equipment of [
      { equipmentID: 'EQ-1', maintenanceStatus: 'Calibrado' },
      { equipmentID: 'EQ-1', operationalStatus: 'Active' },
    ]) {
      const db = makeDb();
      mockOperationalStorage(db);
      const originalImpl = db.collection.getMockImplementation();
      const equipmentCollection = { findOne: vi.fn().mockResolvedValue(equipment) };
      db.collection.mockImplementation((name) => (
        name === 'equipment' ? equipmentCollection : originalImpl(name)
      ));

      const suffix = equipment.maintenanceStatus ? 'MAINT' : 'OP';
      const result = await sampleService.createSample(db, validSampleData({
        specimenId: equipment.maintenanceStatus ? 600021 : 600022,
        barcode: `BR-EQUIP-${suffix}`,
      }));
      expect(result).toBeDefined();
    }
  });

  it('covers canonical withdrawal lookup fallbacks and validation guards', async () => {
    let db = makeDb();
    db.collections.samples.findOne.mockResolvedValue(null);
    db.collections.samples.countDocuments.mockResolvedValue(0);
    db.collections.samples.find.mockReturnValue(makeCursor([]));
    await expect(sampleService.withdrawSample(db, 'UNKNOWN-BARCODE', {
      withdrawalType: 'Total',
      withdrawalResponsible: 'Jane Doe',
      linkedProject: 'P1',
    })).rejects.toThrow('Amostra não encontrada');

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      specimenId: 'S-W1', specimenStatus: 'available', quantity: 10, currentQuantity: 10,
    });
    await expect(sampleService.withdrawSample(db, 'S-W1', {
      withdrawalType: 'INVALID',
      withdrawalResponsible: 'Jane Doe',
      linkedProject: 'P1',
    })).rejects.toThrow(/Tipo de retirada inválido/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      specimenId: 'S-W2', specimenStatus: 'available', quantity: 10, currentQuantity: 10,
    });
    await expect(sampleService.withdrawSample(db, 'S-W2', {
      withdrawalType: 'Total',
      withdrawalResponsible: 'Jane',
      linkedProject: 'P1',
    })).rejects.toThrow(/nome e sobrenome/i);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      specimenId: 'S-W3', specimenStatus: 'available', quantity: 10, currentQuantity: 10,
    });
    await expect(sampleService.withdrawSample(db, 'S-W3', {
      withdrawalType: 'Total',
      withdrawalResponsible: 'Jane Doe',
      linkedProject: '   ',
    })).rejects.toThrow(/Projeto vinculado é obrigatório/);
  });

  it('covers return guards for pending quantity, responsible, condition, observations and excess quantity', async () => {
    const base = {
      specimenId: 'S-R',
      specimenStatus: 'available',
      quantity: 10,
      initialQuantity: 10,
      currentQuantity: 4,
      totalWithdrawn: 6,
      totalReturned: 1,
      unit: 'mL',
      linkedProject: 'P1',
    };

    let db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ ...base, totalWithdrawn: 1, totalReturned: 1 });
    await expect(sampleService.returnSample(db, 'S-R', {
      returnResponsible: 'Jane Doe', condition: 'intact', returnType: 'Total',
    })).rejects.toThrow(/Não há quantidade pendente/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ ...base });
    await expect(sampleService.returnSample(db, 'S-R', {
      returnResponsible: 'J', condition: 'intact', returnType: 'Total',
    })).rejects.toThrow(/Responsável pela devolução é obrigatório/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ ...base });
    await expect(sampleService.returnSample(db, 'S-R', {
      returnResponsible: 'Jane Doe', condition: 'unknown', returnType: 'Total',
    })).rejects.toThrow(/Condição da amostra é obrigatória/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ ...base });
    await expect(sampleService.returnSample(db, 'S-R', {
      returnResponsible: 'Jane Doe', condition: 'partially_compromised', returnType: 'Total',
    })).rejects.toThrow(/Observações são obrigatórias/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ ...base });
    await expect(sampleService.returnSample(db, 'S-R', {
      returnResponsible: 'Jane Doe', condition: 'intact', returnType: 'Parcial',
    })).rejects.toThrow(/Quantidade a devolver é obrigatória/);

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ ...base });
    await expect(sampleService.returnSample(db, 'S-R', {
      returnResponsible: 'Jane Doe', condition: 'intact', returnType: 'Parcial', returnQuantity: 99,
    })).rejects.toThrow(/Quantidade excede o pendente/);
  });

  it('keeps unusable returned material out of available stock and preserves a non-available computed status', async () => {
    const db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      specimenId: 'S-R2',
      specimenStatus: 'depleted',
      quantity: 10,
      initialQuantity: 10,
      currentQuantity: 0,
      totalWithdrawn: 10,
      totalReturned: 0,
      barcode: 'BR-R2',
      unit: 'mL',
      linkedProject: 'P1',
      lastWithdrawalID: 'MOV-1',
    });

    const result = await sampleService.returnSample(db, 'S-R2', {
      returnResponsible: 'Jane Doe',
      condition: 'unusable',
      observations: 'Material inutilizado durante o uso',
      returnType: 'Parcial',
      returnQuantity: 2,
    });

    expect(result.returnedQuantity).toBe(2);
    expect(result.newAvailableQuantity).toBe(0);
  });

  it('covers result lookup, deletion false result and industrial-barcode validation branches', async () => {
    let db = makeDb();
    db.collections.samples.findOne.mockResolvedValue(null);
    await expect(sampleService.getSampleResults(db, 'SPEC-404')).rejects.toThrow('Amostra não encontrada');

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ specimenId: 'SPEC-1', specimenStatus: 'available' });
    db.collections.results.find.mockReturnValue(makeCursor([{ resultId: 'R1' }]));
    const results = await sampleService.getSampleResults(db, 'SPEC-1');
    expect(results).toEqual([{ resultId: 'R1' }]);

    db = makeDb();
    db.collections.samples.deleteOne.mockResolvedValue({ deletedCount: 0 });
    await expect(sampleService.deleteSample(db, 'SPEC-1')).resolves.toBe(false);

    await expect(sampleService.getBarcodeIndustrialAssets('')).rejects.toThrow(/Código de barras inválido/);
    await expect(sampleService.getBarcodeIndustrialAssets('BR-IND-1', { includePayload: false })).resolves.toBeDefined();
  });

  it('covers update miss/matchedCount guards and default list pagination', async () => {
    let db = makeDb();
    db.collections.samples.findOne.mockResolvedValueOnce(null);
    await expect(sampleService.updateSample(db, 'SPEC-404', { notes: 'x' })).resolves.toBeNull();

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValueOnce({
      specimenId: 'SPEC-1',
      quantity: 10,
      currentQuantity: 10,
      specimenStatus: 'available',
    });
    db.collections.samples.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    await expect(sampleService.updateSample(db, 'SPEC-1', { notes: 'x' })).resolves.toBeNull();

    db = makeDb();
    const cursor = makeCursor([]);
    db.collections.samples.find.mockReturnValue(cursor);
    const listed = await sampleService.listSamples(db);
    expect(listed.limit).toBe(50);
    expect(listed.skip).toBe(0);
  });

  it('covers resolved and unresolved specimen identifiers for RCS/SPREC history helpers', async () => {
    const rcsAssessmentService = require('../../src/services/rcs-assessment.service');
    const specimenPreanalyticsService = require('../../src/services/specimen-preanalytics.service');
    const rcsSpy = vi.spyOn(rcsAssessmentService, 'getAssessmentsForSpecimen').mockResolvedValue([]);
    const sprecSpy = vi.spyOn(specimenPreanalyticsService, 'getProfilesForSpecimen').mockResolvedValue([]);

    let db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ specimenId: 'SPEC-RCS' });
    await sampleService.getRcsAssessments(db, 'lookup-key');
    expect(rcsSpy).toHaveBeenLastCalledWith(db, 'SPEC-RCS');

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue(null);
    await sampleService.getRcsAssessments(db, 12345);
    expect(rcsSpy).toHaveBeenLastCalledWith(db, '12345');

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({ specimenId: 'SPEC-SPREC' });
    await sampleService.getSprecProfiles(db, 'lookup-key');
    expect(sprecSpy).toHaveBeenLastCalledWith(db, 'SPEC-SPREC');

    db = makeDb();
    db.collections.samples.findOne.mockResolvedValue(null);
    const noString = Object.create(null);
    await sampleService.getSprecProfiles(db, noString);
    expect(sprecSpy).toHaveBeenLastCalledWith(db, noString);
  });

});


  describe('item 8 legitimate residual branches', () => {
    it('getSample resolves a direct Mongo ObjectId hit before falling back to specimenId', async () => {
      const db = makeDb();
      const objectId = new ObjectId();
      db.collections.samples.findOne.mockResolvedValueOnce({
        _id: objectId,
        specimenId: 'SPEC-OBJECTID',
        specimenStatus: 'available'
      });

      const result = await sampleService.getSample(db, objectId.toString());

      expect(result.specimenId).toBe('SPEC-OBJECTID');
      expect(db.collections.samples.findOne).toHaveBeenCalledTimes(1);
      expect(db.collections.samples.findOne.mock.calls[0][0]._id.toString()).toBe(objectId.toString());
    });

    it('createSample resolves a BOX -> DRAWER -> RACK -> SHELF -> FREEZER hierarchy', async () => {
      const db = makeDb();
      db.collections.patients.findOne.mockResolvedValue({ participantId: '12345678' });

      const drawerId = new ObjectId();
      const rackId = new ObjectId();
      const shelfId = new ObjectId();
      const freezerId = new ObjectId();

      const nodes = new Map([
        [String(drawerId), { _id: drawerId, containerType: 'DRAWER', parent_id: rackId }],
        [String(rackId), { _id: rackId, containerType: 'RACK', parent_id: shelfId }],
        [String(shelfId), { _id: shelfId, containerType: 'SHELF', parent_id: freezerId }],
        [String(freezerId), { _id: freezerId, containerType: 'FREEZER', containerID: 7001, parent_id: null }],
      ]);

      const storageBoxes = {
        findOne: vi.fn().mockResolvedValue({
          _id: BOX_ID,
          parent_id: drawerId,
          dimension: { rows: 8, cols: 12 },
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      };
      const storageContainers = {
        findOne: vi.fn((query) => Promise.resolve(nodes.get(String(query._id)) || null)),
      };
      const equipment = {
        findOne: vi.fn().mockResolvedValue({ equipmentID: 7001, maintenanceStatus: 'active' }),
      };
      const sensors = {
        findOne: vi.fn().mockResolvedValue({ maintenanceStatus: 'active' }),
      };

      db.collection.mockImplementation((name) => {
        if (name === 'storageBoxes') return storageBoxes;
        if (name === 'storageContainers') return storageContainers;
        if (name === 'equipment') return equipment;
        if (name === 'sensors') return sensors;
        return db.collections[name] || (db.collections[name] = makeCollection(name));
      });
      db.collections.samples.findOne.mockImplementation((query) => {
        if (query && query._id !== undefined) {
          return Promise.resolve({ _id: query._id, specimenId: String(query._id), barcode: null });
        }
        return Promise.resolve(null);
      });

      const result = await sampleService.createSample(db, validSampleData());

      expect(result._id).toBe('generated-id');
      expect(storageContainers.findOne).toHaveBeenCalledWith({ _id: drawerId });
      expect(storageContainers.findOne).toHaveBeenCalledWith({ _id: rackId });
      expect(storageContainers.findOne).toHaveBeenCalledWith({ _id: shelfId });
      expect(equipment.findOne).toHaveBeenCalledWith({
        equipmentID: { $in: expect.arrayContaining([7001, '7001']) },
      });
    });

    it('getSampleByBarcode preserves pseudonymization when identity is absent and when the participant record is absent', async () => {
      let db = makeDb();
      db.collections.samples.findOne.mockResolvedValueOnce({
        _id: 's1',
        barcode: 'BR-1',
        participantId: '12345678',
      });
      db.collections.patients.findOne.mockResolvedValue({
        participantId: '12345678',
        recordNumber: 'RN1',
      });
      db.collection('participantIdentities').findOne.mockResolvedValue(null);

      let result = await sampleService.getSampleByBarcode(db, 'BR-1');
      expect(result.participant).toEqual({
        participantId: '12345678',
        patientName: '***',
        recordNumber: 'RN1',
      });

      db = makeDb();
      db.collections.samples.findOne.mockResolvedValueOnce({
        _id: 's2',
        barcode: 'BR-2',
        participantId: '87654321',
      });
      db.collections.patients.findOne.mockResolvedValue(null);

      result = await sampleService.getSampleByBarcode(db, 'BR-2');
      expect(result.sample._id).toBe('s2');
      expect(result.participant).toBeNull();
    });
  });

});


describe('sample.service item 8 remaining precedence branches', () => {
  beforeEach(() => {
    currentCanonicalPlacement = null;
    currentAllocateExecute = vi.fn(async () => ({
      success: true,
      currentStoragePlacement: currentCanonicalPlacement,
      lineageQueued: true,
      lineageEventId: 'evt-item8-final',
    }));
    currentFindCurrentStoragePlacement = vi.fn(async () => currentCanonicalPlacement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers auditInfo.userName over actorName when recording the sample birth movement', async () => {
    const db = makeDb();
    mockOperationalStorage(db);

    await sampleService.createSample(
      db,
      validSampleData({
        specimenId: 600030,
        barcode: 'BR-ACTOR-PRIMARY',
      }),
      {
        auditInfo: {
          userName: 'Primary Actor',
          actorName: 'Fallback Actor',
        },
      }
    );

    const movement = db.collections.sample_movements.insertOne.mock.calls[0][0];
    expect(movement.responsible).toBe('Primary Actor');
    expect(currentAllocateExecute.mock.calls[0][0].actor.userName).toBe('Primary Actor');
  });

  it('prefers explicit sampleDestination and linkedProject overrides during a successful withdrawal', async () => {
    const db = makeDb();
    db.collections.samples.findOne.mockResolvedValue({
      specimenId: 'SPEC-WITHDRAW-PRECEDENCE',
      specimenStatus: 'available',
      quantity: 10,
      initialQuantity: 10,
      currentQuantity: 10,
      totalWithdrawn: 0,
      unit: 'mL',
      barcode: 'BR-WITHDRAW-PRECEDENCE',
      linkedProject: 'stored-project',
    });

    const result = await sampleService.withdrawSample(
      db,
      'SPEC-WITHDRAW-PRECEDENCE',
      {
        withdrawalType: 'Parcial',
        withdrawalQuantity: 2,
        withdrawalResponsible: 'Jane Doe',
        sampleDestination: 'Primary Lab',
        withdrawalDestination: 'Fallback Lab',
        purpose: 'Primary purpose',
        justification: 'Fallback purpose',
        linkedProject: 'override-project',
        observations: 'Primary observation',
        notes: 'Fallback observation',
      },
      {
        userId: 'user-1',
        userName: 'User One',
        userRole: 'Curator',
      }
    );

    expect(result.withdrawnQuantity).toBe(2);
    const movement = db.collections.sample_movements.insertOne.mock.calls[0][0];
    expect(movement.destination).toBe('Primary Lab');
    expect(movement.purpose).toBe('Primary purpose');
    expect(movement.linkedProject).toBe('override-project');
    expect(movement.observations).toBe('Primary observation');

    const update = db.collections.samples.updateOne.mock.calls[0][1].$set;
    expect(update.sampleDestination).toBe('Primary Lab');
    expect(update.linkedProject).toBe('override-project');
  });
});
