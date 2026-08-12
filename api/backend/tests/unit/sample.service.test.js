import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const sampleService = require('../../src/services/sample.service');
const qualityDomain = require('../../src/services/quality-domain.service');
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
    findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 1 } }),
    createIndex: vi.fn().mockResolvedValue(true)
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
    counters: makeCollection('counters'),
    patients: makeCollection('patients'),
    storageBoxes: makeCollection('storageBoxes'),
    storageContainers: makeCollection('storageContainers'),
    storageAssignments: makeCollection('storageAssignments'),
    results: makeCollection('results'),
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
    // #474: AllocateSampleUseCase's openStorageAssignment resolves hierarchy
    // via storagePaths (not the parent_id walk resolveStorageHierarchyForBox
    // still uses for the pre-allocation equipment/sensor gate above).
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
  db.collections.samples.findOne.mockImplementation((query) => {
    if (query && query._id !== undefined) {
      return Promise.resolve({ _id: query._id, barcode: null, storageLocation: null });
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

    it('persists the resolved storageLocation (boxId/positionCode) on the created sample, per issue #462', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      await sampleService.createSample(db, validSampleData({ positionCode: 'B2' }));

      const [insertedSample] = db.collections.samples.insertOne.mock.calls[0];
      expect(insertedSample.storageLocation).toEqual({ boxId: BOX_ID, position: 'B2' });
      expect(insertedSample.locationID).toBeNull();
    });

    it('exposes the canonical storageAssignment on the response, resolved from the just-opened StorageAssignment record, per issue #510', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      const baseImplementation = db.collection.getMockImplementation();
      const opened = { specimenId: 'generated-id', boxId: BOX_ID, positionCode: 'B2', removedAt: null };
      const storageAssignmentsFindOne = vi.fn(({ specimenId, removedAt }) => {
        if (specimenId === opened.specimenId && removedAt === null) {
          return Promise.resolve(opened);
        }
        return Promise.resolve(null);
      });
      // Override just storageAssignments.findOne with real query-matching
      // semantics, keeping mockOperationalStorage's other storage-chain mocks.
      db.collection.mockImplementation((name) => {
        if (name === 'storageAssignments') {
          return { insertOne: vi.fn().mockResolvedValue({ insertedId: 'assignment-1' }), findOne: storageAssignmentsFindOne };
        }
        return baseImplementation(name);
      });

      const result = await sampleService.createSample(db, validSampleData({ positionCode: 'B2' }));

      expect(result.storageAssignment).toEqual(opened);
      expect(result.storageLocation).toEqual({ boxId: BOX_ID, position: 'B2' });
    });

    it('opens a StorageAssignment for the specimen at boxId/positionCode, per issue #462/#474', async () => {
      const db = makeDb();
      mockOperationalStorage(db);

      const result = await sampleService.createSample(db, validSampleData());

      const storageAssignments = db.collection('storageAssignments');
      expect(storageAssignments.insertOne).toHaveBeenCalledTimes(1);
      const [assignmentArg] = storageAssignments.insertOne.mock.calls[0];
      // #474: routed through AllocateSampleUseCase/MongoStorageRepository's
      // openStorageAssignment, which resolves the hierarchy via storagePaths
      // (mocked above) rather than sample.service.js's own parent_id walk —
      // fields come back as strings (StorageAssignmentModel.open casts them).
      expect(assignmentArg).toMatchObject({
        specimenId: 'generated-id',
        boxId: BOX_ID.toString(),
        positionCode: 'A1',
        equipmentId: String(FREEZER_ID),
        shelfId: String(SHELF_ID),
        rackId: String(RACK_ID),
        occupancyStatus: 'ocupada'
      });
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
    it('returns the sample and an anonymized participant on exact match', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockResolvedValueOnce({
        _id: 's1',
        barcode: 'BR-1',
        participantId: '12345678'
      });
      db.collections.patients.findOne.mockResolvedValue({
        participantId: '12345678',
        patientName: 'Maria Silva',
        recordNumber: 'RN1'
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
        patientName: 'Cher',
        recordNumber: 'RN1'
      });

      const { participant } = await sampleService.getSampleByBarcode(db, 'BR-1');
      expect(participant.patientName).toBe('C***');
    });

    it('propagates an error from the collection lookup', async () => {
      const db = makeDb();
      db.collections.samples.findOne.mockRejectedValue(new Error('mongo down'));

      await expect(sampleService.getSampleByBarcode(db, 'BR-1')).rejects.toThrow('mongo down');
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
});
