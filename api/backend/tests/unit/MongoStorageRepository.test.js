import { describe, it, expect, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MongoStorageRepository = require('../../src/infrastructure/persistence/mongo/MongoStorageRepository.js');
const { createContendedCollectionMock } = require('../factories/db.factory.js');

function makeCollection(overrides = {}) {
  return {
    findOne: vi.fn(),
    updateOne: vi.fn(),
    find: vi.fn(),
    ...overrides
  };
}

function makeDb(collections) {
  const defaults = {
    storagePaths: makeCollection({ findOne: vi.fn().mockResolvedValue(null) }),
    storageBoxes: makeCollection({ findOne: vi.fn().mockResolvedValue(null) }),
    storageContainers: makeCollection({ findOne: vi.fn().mockResolvedValue(null) }),
    rooms: makeCollection({ findOne: vi.fn().mockResolvedValue(null) }),
    storageAssignments: makeCollection({
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'stub' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn().mockResolvedValue(null)
    })
  };
  return {
    collection: (name) => collections[name] ?? defaults[name]
  };
}

describe('MongoStorageRepository', () => {
  describe('findStorageHierarchyForBox', () => {
    // Issue #418: dict-02 StorageAssignment.facilityId/roomId (ELM-0168/0169)
    // must resolve via the FREEZER's roomId -> Room.facilityId chain, not
    // stay hardcoded null like #402 left them.
    it('resolves facilityId/roomId via the freezer storageContainer and room (#418)', async () => {
      const boxObjId = new ObjectId();
      const freezerId = new ObjectId();
      const roomId = new ObjectId();
      const facilityId = new ObjectId();

      const storagePaths = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          rackId: new ObjectId(),
          shelfId: new ObjectId(),
          freezerId
        })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: freezerId, roomId })
      });
      const rooms = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: roomId, facilityId })
      });
      const db = makeDb({ storagePaths, storageContainers, rooms });
      const repo = new MongoStorageRepository(db);

      const result = await repo.findStorageHierarchyForBox(boxObjId, {});

      expect(result.facilityId).toBe(String(facilityId));
      expect(result.roomId).toBe(String(roomId));
    });

    it('leaves facilityId/roomId null when the freezer has no roomId', async () => {
      const boxObjId = new ObjectId();
      const freezerId = new ObjectId();

      const storagePaths = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          rackId: new ObjectId(),
          shelfId: new ObjectId(),
          freezerId
        })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: freezerId, roomId: null })
      });
      const db = makeDb({ storagePaths, storageContainers });
      const repo = new MongoStorageRepository(db);

      const result = await repo.findStorageHierarchyForBox(boxObjId, {});

      expect(result.facilityId).toBeNull();
      expect(result.roomId).toBeNull();
    });

    it('leaves everything null when there is no StoragePath and the box itself cannot be found either', async () => {
      const boxObjId = new ObjectId();
      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ storagePaths, storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.findStorageHierarchyForBox(boxObjId, {});

      expect(result).toEqual({
        rackId: null,
        shelfId: null,
        equipmentId: null,
        roomId: null,
        facilityId: null
      });
    });

    // #654: storagePaths is never written anywhere in api/backend/src, so
    // every real box hits this branch -- without the live fallback, dict-02's
    // hierarchy-enrichment fields (facilityId/roomId/equipmentId on
    // StorageAssignment) silently never populate for any real box.
    it('#654: falls back to a live parent_id walk when there is no StoragePath document', async () => {
      const boxObjId = new ObjectId();
      const rackId = new ObjectId();
      const shelfId = new ObjectId();
      const freezerId = new ObjectId();
      const roomId = new ObjectId();
      const facilityId = new ObjectId();

      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: boxObjId, parent_id: rackId })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: rackId, containerType: 'RACK', parent_id: shelfId })
          .mockResolvedValueOnce({ _id: shelfId, containerType: 'SHELF', parent_id: freezerId })
          .mockResolvedValueOnce({ _id: freezerId, containerType: 'FREEZER', parent_id: null, roomId })
          // findFacilityAndRoomForFreezer's own lookup, called with the
          // resolved freezerId once the walk above completes.
          .mockResolvedValueOnce({ _id: freezerId, roomId })
      });
      const rooms = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: roomId, facilityId })
      });
      const db = makeDb({ storagePaths, storageBoxes, storageContainers, rooms });
      const repo = new MongoStorageRepository(db);

      const result = await repo.findStorageHierarchyForBox(boxObjId, {});

      expect(result).toEqual({
        rackId: String(rackId),
        shelfId: String(shelfId),
        equipmentId: String(freezerId),
        roomId: String(roomId),
        facilityId: String(facilityId)
      });
    });

    // A box's immediate parent can be a DRAWER instead of a RACK (#458) --
    // StoragePath's own schema/createFromBox has no drawerId field and would
    // throw walking through one; the live fallback must walk past it
    // transparently since it doesn't hardcode chain depth.
    it('#654: walks through an optional DRAWER level transparently', async () => {
      const boxObjId = new ObjectId();
      const drawerId = new ObjectId();
      const rackId = new ObjectId();
      const shelfId = new ObjectId();
      const freezerId = new ObjectId();

      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: boxObjId, parent_id: drawerId })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: drawerId, containerType: 'DRAWER', parent_id: rackId })
          .mockResolvedValueOnce({ _id: rackId, containerType: 'RACK', parent_id: shelfId })
          .mockResolvedValueOnce({ _id: shelfId, containerType: 'SHELF', parent_id: freezerId })
          .mockResolvedValueOnce({ _id: freezerId, containerType: 'FREEZER', parent_id: null, roomId: null })
          .mockResolvedValueOnce({ _id: freezerId, roomId: null })
      });
      const db = makeDb({ storagePaths, storageBoxes, storageContainers });
      const repo = new MongoStorageRepository(db);

      const result = await repo.findStorageHierarchyForBox(boxObjId, {});

      expect(result.rackId).toBe(String(rackId));
      expect(result.shelfId).toBe(String(shelfId));
      expect(result.equipmentId).toBe(String(freezerId));
    });
  });


  describe('toObjectId', () => {
    it('converts a valid ObjectId string', () => {
      const repo = new MongoStorageRepository(makeDb({}));
      const idStr = new ObjectId().toString();
      const result = repo.toObjectId(idStr);
      expect(result).toBeInstanceOf(ObjectId);
      expect(result.toString()).toBe(idStr);
    });

    it('passes through an already-an-ObjectId value', () => {
      const repo = new MongoStorageRepository(makeDb({}));
      const oid = new ObjectId();
      const result = repo.toObjectId(oid);
      expect(result).toBe(oid);
    });

    it('passes through an invalid string unchanged', () => {
      const repo = new MongoStorageRepository(makeDb({}));
      const result = repo.toObjectId('not-a-valid-id');
      expect(result).toBe('not-a-valid-id');
    });
  });

  describe('findSampleById', () => {
    it('converts the id and queries the samples collection with the session', async () => {
      const findOne = vi.fn().mockResolvedValueOnce({ _id: 'sample-doc' });
      const samples = makeCollection({ findOne });
      const db = makeDb({ samples });
      const repo = new MongoStorageRepository(db);
      const idStr = new ObjectId().toString();
      const session = { id: 'sess-1' };

      const result = await repo.findSampleById(idStr, session);

      expect(result).toEqual({ _id: 'sample-doc', storageAssignment: null });
      expect(findOne).toHaveBeenCalledWith(
        { _id: expect.any(ObjectId) },
        { session }
      );
    });

    it('returns null without querying storageAssignments when the sample is not found', async () => {
      const findOne = vi.fn().mockResolvedValueOnce(null);
      const samples = makeCollection({ findOne });
      const storageAssignmentsFindOne = vi.fn();
      const storageAssignments = makeCollection({ findOne: storageAssignmentsFindOne });
      const db = makeDb({ samples, storageAssignments });
      const repo = new MongoStorageRepository(db);

      const result = await repo.findSampleById(new ObjectId().toString());

      expect(result).toBeNull();
      expect(storageAssignmentsFindOne).not.toHaveBeenCalled();
    });

    // Issue #507: findSampleById's return shape must expose the canonical
    // StorageAssignment (dict-02 ELM-0167-0178) instead of leaving callers
    // to read the raw embedded storageLocation.boxId/position snapshot.
    it('attaches the open StorageAssignment as the canonical storageAssignment field (#507)', async () => {
      const sampleId = new ObjectId().toString();
      const boxId = new ObjectId().toString();
      const openAssignment = {
        storageAssignmentId: 'sa-1',
        specimenId: sampleId,
        boxId,
        positionCode: 'A1',
        placedAt: new Date('2026-08-01'),
        removedAt: null,
        occupancyStatus: 'ocupada'
      };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: sampleId,
          storageLocation: { boxId, position: 'A1' }
        })
      });
      const storageAssignmentsFindOne = vi.fn().mockResolvedValueOnce(openAssignment);
      const storageAssignments = makeCollection({ findOne: storageAssignmentsFindOne });
      const db = makeDb({ samples, storageAssignments });
      const repo = new MongoStorageRepository(db);

      const result = await repo.findSampleById(sampleId);

      expect(result.storageAssignment).toEqual(openAssignment);
      expect(storageAssignmentsFindOne).toHaveBeenCalledWith(
        { specimenId: sampleId, removedAt: null },
        { session: undefined }
      );
    });

    it('sets storageAssignment to null when the sample has no open placement', async () => {
      const sampleId = new ObjectId().toString();
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId, storageLocation: null })
      });
      const storageAssignments = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ samples, storageAssignments });
      const repo = new MongoStorageRepository(db);

      const result = await repo.findSampleById(sampleId);

      expect(result.storageAssignment).toBeNull();
    });
  });

  describe('findBoxById', () => {
    it('converts the id and queries the storageBoxes collection with the session', async () => {
      const findOne = vi.fn().mockResolvedValueOnce({ _id: 'box-doc' });
      const storageBoxes = makeCollection({ findOne });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);
      const idStr = new ObjectId().toString();
      const session = { id: 'sess-2' };

      const result = await repo.findBoxById(idStr, session);

      expect(result).toEqual({ _id: 'box-doc' });
      expect(findOne).toHaveBeenCalledWith(
        { _id: expect.any(ObjectId) },
        { session }
      );
    });
  });

  describe('withTransaction', () => {
    it('happy path calls handler and returns its result, ends session', async () => {
      const endSession = vi.fn();
      const session = {
        withTransaction: vi.fn(async (fn) => fn()),
        endSession
      };
      const startSession = vi.fn(() => session);
      const db = { client: { startSession } };
      const repo = new MongoStorageRepository(db);

      const handler = vi.fn(async () => 'handler-result');
      const result = await repo.withTransaction(handler);

      expect(result).toBe('handler-result');
      expect(handler).toHaveBeenCalledWith(session);
      expect(endSession).toHaveBeenCalledTimes(1);
    });

    it('uses db.s.client when db.client is absent', async () => {
      const endSession = vi.fn();
      const session = {
        withTransaction: vi.fn(async (fn) => fn()),
        endSession
      };
      const startSession = vi.fn(() => session);
      const db = { s: { client: { startSession } } };
      const repo = new MongoStorageRepository(db);

      const result = await repo.withTransaction(async () => 42);
      expect(result).toBe(42);
      expect(endSession).toHaveBeenCalledTimes(1);
    });

    it('throws when client has no startSession function', async () => {
      const repo = new MongoStorageRepository({});
      await expect(repo.withTransaction(async () => {})).rejects.toThrow(
        'não suporta transação'
      );
    });

    it('ends session even when handler throws', async () => {
      const endSession = vi.fn();
      const session = {
        withTransaction: vi.fn(async (fn) => fn()),
        endSession
      };
      const startSession = vi.fn(() => session);
      const db = { client: { startSession } };
      const repo = new MongoStorageRepository(db);

      await expect(
        repo.withTransaction(async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      expect(endSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('moveSamplePosition', () => {
    const sampleId = new ObjectId().toString();
    const fromBoxId = new ObjectId().toString();
    const toBoxId = new ObjectId().toString();
    const input = {
      sampleId,
      specimenId: sampleId,
      fromBoxId,
      fromPosition: 'A1',
      toBoxId,
      toPosition: 'B2'
    };

    it('happy path performs all 3 updates', async () => {
      const storageBoxes = makeCollection({
        // #646 Wave 3 (RF017 AC#7): moveSamplePosition now fetches the
        // destination box first to check checkLocationBlocked.
        findOne: vi.fn().mockResolvedValueOnce({ _id: toBoxId, status: 'ACTIVE' }),
        updateOne: vi
          .fn()
          .mockResolvedValueOnce({ matchedCount: 1 }) // source
          .mockResolvedValueOnce({ matchedCount: 1 }) // target
      });
      const samples = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const db = makeDb({ storageBoxes, samples });
      const repo = new MongoStorageRepository(db);

      await expect(repo.moveSamplePosition(input, {})).resolves.toBeUndefined();
      expect(storageBoxes.updateOne).toHaveBeenCalledTimes(2);
      expect(samples.updateOne).toHaveBeenCalledTimes(1);
    });

    // Issue #402: dict-02 StorageAssignment — a move must close the
    // placement-history record at the source position and open a new one
    // at the target, not just overwrite Sample.storageLocation.
    it('closes the source StorageAssignment and opens one for the target (#402)', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: toBoxId, status: 'ACTIVE' }),
        updateOne: vi
          .fn()
          .mockResolvedValueOnce({ matchedCount: 1 })
          .mockResolvedValueOnce({ matchedCount: 1 })
      });
      const samples = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const storageAssignmentsUpdateOne = vi.fn().mockResolvedValueOnce({ matchedCount: 1 });
      const storageAssignmentsInsertOne = vi.fn().mockResolvedValueOnce({ insertedId: 'x' });
      const storageAssignments = makeCollection({
        updateOne: storageAssignmentsUpdateOne,
        insertOne: storageAssignmentsInsertOne
      });
      const db = makeDb({ storageBoxes, samples, storagePaths, storageAssignments });
      const repo = new MongoStorageRepository(db);

      await repo.moveSamplePosition(input, {});

      expect(storageAssignmentsUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          specimenId: sampleId,
          boxId: fromBoxId,
          positionCode: 'A1',
          removedAt: null
        }),
        expect.objectContaining({ $set: expect.objectContaining({ removedAt: expect.any(Date), occupancyStatus: 'livre' }) }),
        { session: {} }
      );
      expect(storageAssignmentsInsertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          specimenId: sampleId,
          boxId: toBoxId,
          positionCode: 'B2',
          placedAt: expect.any(Date),
          removedAt: null,
          occupancyStatus: 'ocupada'
        }),
        { session: {} }
      );
    });

    it('throws "Origem inconsistente" when source update matchedCount is 0', async () => {
      const storageBoxes = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 0 })
      });
      const samples = makeCollection();
      const db = makeDb({ storageBoxes, samples });
      const repo = new MongoStorageRepository(db);

      await expect(repo.moveSamplePosition(input, {})).rejects.toThrow(
        'Origem inconsistente'
      );
      expect(samples.updateOne).not.toHaveBeenCalled();
    });

    it('throws "STORAGE_COLLISION" when target update matchedCount is 0', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: toBoxId, status: 'ACTIVE' }),
        updateOne: vi
          .fn()
          .mockResolvedValueOnce({ matchedCount: 1 })
          .mockResolvedValueOnce({ matchedCount: 0 })
      });
      const samples = makeCollection();
      const db = makeDb({ storageBoxes, samples });
      const repo = new MongoStorageRepository(db);

      await expect(repo.moveSamplePosition(input, {})).rejects.toThrow(
        'STORAGE_COLLISION'
      );
      expect(samples.updateOne).not.toHaveBeenCalled();
    });

    it('throws "Falha ao atualizar localização" when sample update matchedCount is 0', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: toBoxId, status: 'ACTIVE' }),
        updateOne: vi
          .fn()
          .mockResolvedValueOnce({ matchedCount: 1 })
          .mockResolvedValueOnce({ matchedCount: 1 })
      });
      const samples = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 0 })
      });
      const db = makeDb({ storageBoxes, samples });
      const repo = new MongoStorageRepository(db);

      await expect(repo.moveSamplePosition(input, {})).rejects.toThrow(
        'Falha ao atualizar localização'
      );
    });

    // #646 Wave 3 (RF017 AC#7): the source position is already freed by
    // this point (sourceUpdate above), but the move itself must still be
    // refused into a blocked destination.
    it('refuses to move into a RETIRED destination box, after the source position is already freed (criterion 7)', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: toBoxId, status: 'RETIRED' }),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 }) // source only
      });
      const samples = makeCollection();
      const db = makeDb({ storageBoxes, samples });
      const repo = new MongoStorageRepository(db);

      await expect(repo.moveSamplePosition(input, {})).rejects.toThrow('RETIRED');
      expect(storageBoxes.updateOne).toHaveBeenCalledTimes(1); // source freed, target update never attempted
      expect(samples.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('allocateSamplePosition', () => {
    const sampleId = new ObjectId().toString();
    const boxId = new ObjectId().toString();
    const baseInput = { sampleId, specimenId: sampleId, boxId, position: 'A1' };
    const boxDoc = { _id: new ObjectId(boxId), dimension: { rows: 4, cols: 4 } };

    it('happy path allocates the position', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(boxDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).resolves.toBeUndefined();
      expect(storageBoxes.updateOne).toHaveBeenCalledTimes(1);
      expect(samples.updateOne).toHaveBeenCalledTimes(1);
      const setPayload = samples.updateOne.mock.calls[0][1].$set;
      // #544: status is a retired legacy field (specimenStatus is the sole
      // source of truth since #408) — allocation must not write it.
      expect(setPayload.status).toBeUndefined();
      // storageLocation defaults to a literal `null` on create (Sample.js) —
      // a dotted-path $set into it is rejected by real MongoDB, so the first
      // allocation must replace the whole object, not set nested paths.
      expect(setPayload.storageLocation).toEqual({ boxId: expect.anything(), position: 'A1' });
    });

    // #646 Wave 3 (RF017 AC#7): the real specimen-registration write path
    // (unlike validatePositionAvailability, a separate pre-flight check
    // endpoint) must itself refuse a RETIRED box, not just report it.
    it('refuses to allocate into a RETIRED box (criterion 7)', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId })
      });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ ...boxDoc, status: 'RETIRED' })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).rejects.toThrow('RETIRED');
      expect(storageBoxes.updateOne).not.toHaveBeenCalled();
      expect(samples.updateOne).not.toHaveBeenCalled();
    });

    // Issue #402: opening a position must also open a StorageAssignment
    // placement-history record for it.
    it('opens a StorageAssignment for the newly allocated position (#402)', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(boxDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageAssignmentsInsertOne = vi.fn().mockResolvedValueOnce({ insertedId: 'x' });
      const storageAssignments = makeCollection({ insertOne: storageAssignmentsInsertOne });
      const db = makeDb({ samples, storageBoxes, storageAssignments });
      const repo = new MongoStorageRepository(db);

      await repo.allocateSamplePosition(baseInput, {});

      expect(storageAssignmentsInsertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          specimenId: sampleId,
          boxId,
          positionCode: 'A1',
          placedAt: expect.any(Date),
          removedAt: null,
          occupancyStatus: 'ocupada'
        }),
        { session: {} }
      );
    });

    it('throws when sample not found', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const storageBoxes = makeCollection();
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).rejects.toThrow(
        'Amostra não encontrada'
      );
    });

    it('throws when sample already allocated', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: sampleId,
          storageLocation: { boxId: new ObjectId(), position: 'C3' }
        })
      });
      const storageBoxes = makeCollection();
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).rejects.toThrow(
        'já está alocada'
      );
    });

    it('throws when box not found', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }) });
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).rejects.toThrow(
        'Caixa de armazenamento não encontrada'
      );
    });

    it('throws when position format is invalid', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }) });
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(boxDoc) });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(
        repo.allocateSamplePosition({ ...baseInput, position: '11A' }, {})
      ).rejects.toThrow('Posição inválida');
    });

    it('throws when position is out of bounds', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }) });
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(boxDoc) });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(
        repo.allocateSamplePosition({ ...baseInput, position: 'Z9' }, {})
      ).rejects.toThrow('fora dos limites');
    });

    it('throws "STORAGE_COLLISION" when box update matchedCount is 0', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }) });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(boxDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 0 })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).rejects.toThrow(
        'STORAGE_COLLISION'
      );
    });

    // #1043: pins the STORAGE_COLLISION guard (matchedCount === 0 at
    // MongoStorageRepository.js:460) actually firing, via
    // createContendedCollectionMock rather than a hand-rolled
    // `{ matchedCount: 0 }` override -- see db.factory.js's warning on
    // createCollectionMock's own `updateOne` default (matchedCount: 1) for
    // why the two are not interchangeable: a test built on that default
    // alone can never reach this branch.
    it('#1043: throws STORAGE_COLLISION when the box updateOne is contended via createContendedCollectionMock', async () => {
      // `samples.updateOne` resolves a real matched result on purpose: with a
      // bare vi.fn() the post-guard `updateSample.modifiedCount` read throws a
      // TypeError, so deleting the guard would red this test for the wrong
      // reason. Given a real result, deleting it makes the call RESOLVE, and
      // the failure reads "promise resolved instead of rejecting".
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
      });
      const storageBoxes = createContendedCollectionMock({
        findOne: vi.fn().mockResolvedValueOnce(boxDoc)
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.allocateSamplePosition(baseInput, {})).rejects.toThrow(
        'STORAGE_COLLISION'
      );
    });
  });

  describe('autoAssignSamplePosition', () => {
    const specimenId = new ObjectId();
    const boxId = new ObjectId();
    const boxDoc = {
      _id: boxId,
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: { A1: new ObjectId() }, // A1 occupied, A2 free
      currentOccupancy: 1
    };

    it('scans for the first free position and allocates it atomically', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: specimenId, storageLocation: null }),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(boxDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      const position = await repo.autoAssignSamplePosition({ specimenId, boxId }, {});

      expect(position).toBe('A2');
      expect(storageBoxes.updateOne.mock.calls[0][0][`occupancyGrid.A2`]).toEqual({ $exists: false });
      const sampleSet = samples.updateOne.mock.calls[0][1].$set;
      // storageLocation defaults to a literal `null` on create (Sample.js) —
      // a dotted-path $set into it is rejected by real MongoDB, so the first
      // allocation must replace the whole object, not set nested paths.
      expect(sampleSet.storageLocation).toEqual({ boxId: expect.anything(), position: 'A2' });
      // #544: status is a retired legacy field (specimenStatus is the sole
      // source of truth since #408) — auto-assign must not write it.
      expect(sampleSet.status).toBeUndefined();
    });

    it('throws BOX_NOT_FOUND when the box is missing', async () => {
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ samples: makeCollection(), storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.autoAssignSamplePosition({ specimenId, boxId }, {})).rejects.toThrow(
        'BOX_NOT_FOUND'
      );
    });

    // #646 Wave 3 (RF017 AC#7): auto-assign must also refuse a RETIRED box,
    // checked before it even looks up the sample.
    it('refuses to auto-assign into a RETIRED box (criterion 7)', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ ...boxDoc, status: 'RETIRED' })
      });
      const samples = makeCollection();
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.autoAssignSamplePosition({ specimenId, boxId }, {})).rejects.toThrow(
        'BOX_UNAVAILABLE'
      );
      expect(samples.findOne).not.toHaveBeenCalled();
    });

    it('throws SAMPLE_NOT_FOUND when the sample is missing', async () => {
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(boxDoc) });
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.autoAssignSamplePosition({ specimenId, boxId }, {})).rejects.toThrow(
        'SAMPLE_NOT_FOUND'
      );
    });

    it('throws ALREADY_ALLOCATED when the sample already has a storageLocation', async () => {
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(boxDoc) });
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: specimenId,
          storageLocation: { boxId, position: 'A1' }
        })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.autoAssignSamplePosition({ specimenId, boxId }, {})).rejects.toThrow(
        'ALREADY_ALLOCATED'
      );
    });

    it('throws BOX_FULL when there is no free position', async () => {
      const fullBox = { ...boxDoc, dimension: { rows: 1, cols: 1 }, occupancyGrid: { A1: new ObjectId() } };
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(fullBox) });
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: specimenId, storageLocation: null })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.autoAssignSamplePosition({ specimenId, boxId }, {})).rejects.toThrow(
        'BOX_FULL'
      );
    });

    it('throws STORAGE_COLLISION when the atomic box update matches nothing', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: specimenId, storageLocation: null })
      });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(boxDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 0 })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.autoAssignSamplePosition({ specimenId, boxId }, {})).rejects.toThrow(
        'STORAGE_COLLISION'
      );
    });

    it('throws when the sample update fails to match', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: specimenId, storageLocation: null }),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 0 })
      });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(boxDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.autoAssignSamplePosition({ specimenId, boxId }, {})).rejects.toThrow(
        'Falha ao atualizar'
      );
    });

    // #1003: auto-assign is the only one of the four storage-placement
    // writers that never opened a StorageAssignment row -- direct analogue
    // of allocateSamplePosition's own "#402" case above.
    it('opens a StorageAssignment for the newly auto-assigned position (#1003)', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: specimenId, storageLocation: null }),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(boxDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageAssignmentsInsertOne = vi.fn().mockResolvedValueOnce({ insertedId: 'x' });
      const storageAssignments = makeCollection({ insertOne: storageAssignmentsInsertOne });
      const db = makeDb({ samples, storageBoxes, storageAssignments });
      const repo = new MongoStorageRepository(db);

      const position = await repo.autoAssignSamplePosition({ specimenId, boxId }, {});

      expect(position).toBe('A2');
      expect(storageAssignmentsInsertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          specimenId: String(specimenId),
          boxId: String(boxId),
          positionCode: 'A2',
          placedAt: expect.any(Date),
          removedAt: null,
          occupancyStatus: 'ocupada'
        }),
        { session: {} }
      );
    });
  });

  describe('releaseSamplePosition', () => {
    const sampleId = new ObjectId().toString();
    const boxId = new ObjectId();

    it('happy path returns from/barcode/quantity/unit, defaulting unit to µL', async () => {
      const sampleDoc = {
        _id: sampleId,
        barcode: 'BC-1',
        quantity: 10,
        unit: null,
        storageLocation: { boxId, position: 'a1' }
      };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(sampleDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.releaseSamplePosition({ sampleId }, {});
      expect(result).toEqual({
        from: { boxId: String(boxId), position: 'A1' },
        barcode: 'BC-1',
        quantity: 10,
        unit: 'µL'
      });
    });

    // Issue #402: release must close the placement-history StorageAssignment
    // record instead of just unsetting Sample.storageLocation.
    it('closes the StorageAssignment for the released position (#402)', async () => {
      const sampleDoc = {
        _id: sampleId,
        barcode: 'BC-1',
        quantity: 10,
        unit: null,
        storageLocation: { boxId, position: 'a1' }
      };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(sampleDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageAssignmentsUpdateOne = vi.fn().mockResolvedValueOnce({ matchedCount: 1 });
      const storageAssignments = makeCollection({ updateOne: storageAssignmentsUpdateOne });
      const db = makeDb({ samples, storageBoxes, storageAssignments });
      const repo = new MongoStorageRepository(db);

      await repo.releaseSamplePosition({ sampleId, specimenId: sampleId }, {});

      expect(storageAssignmentsUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          specimenId: sampleId,
          boxId: String(boxId),
          positionCode: 'A1',
          removedAt: null
        }),
        expect.objectContaining({ $set: expect.objectContaining({ removedAt: expect.any(Date), occupancyStatus: 'livre' }) }),
        { session: {} }
      );
    });

    it('preserves an explicit non-falsy unit', async () => {
      const sampleDoc = {
        _id: sampleId,
        barcode: 'BC-2',
        quantity: 5,
        unit: 'mL',
        storageLocation: { boxId, position: 'B2' }
      };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(sampleDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.releaseSamplePosition({ sampleId }, {});
      expect(result.unit).toBe('mL');
    });

    it('throws when sample not found', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const storageBoxes = makeCollection();
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.releaseSamplePosition({ sampleId }, {})).rejects.toThrow(
        'Amostra não encontrada'
      );
    });

    it('throws when sample has no storageLocation', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId })
      });
      const storageBoxes = makeCollection();
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.releaseSamplePosition({ sampleId }, {})).rejects.toThrow(
        'não possui localização'
      );
    });

    // Issue #23: releaseSamplePosition never checked matchedCount on the box
    // update, unlike moveSamplePosition's equivalent 'Origem inconsistente' check.
    it('throws when box update matchedCount is 0 (stale/inconsistent occupancy)', async () => {
      const sampleDoc = {
        _id: sampleId,
        barcode: 'BC-3',
        quantity: 1,
        unit: 'mL',
        storageLocation: { boxId, position: 'A1' }
      };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(sampleDoc),
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        updateOne: vi.fn().mockResolvedValueOnce({ matchedCount: 0 })
      });
      const db = makeDb({ samples, storageBoxes });
      const repo = new MongoStorageRepository(db);

      await expect(repo.releaseSamplePosition({ sampleId }, {})).rejects.toThrow(
        'Origem inconsistente'
      );
      expect(samples.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('validatePositionAvailability', () => {
    const boxId = new ObjectId().toString();

    // #646 Wave 3 (RF017 AC#7): "Bloquear local indisponível, interditado
    // ou fora de condição" -- box.status/StorageContainer.status existed
    // (StorageBox.js: ACTIVE/FULL/RETIRED; StorageContainer.js:
    // OPERATIONAL/MAINTENANCE/RETIRED) but neither was ever checked here,
    // so a RETIRED box (or one under a RETIRED/MAINTENANCE rack/shelf/
    // freezer) still accepted new allocations as long as the specific
    // position was unoccupied.
    it('returns BOX_UNAVAILABLE for a RETIRED box, before even checking the position (criterion 7)', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          status: 'RETIRED',
          dimension: { rows: 4, cols: 4 },
          occupancyGrid: {}
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'BOX_UNAVAILABLE' })
      );
    });

    it('returns LOCATION_UNAVAILABLE when the box\'s freezer is RETIRED (criterion 7)', async () => {
      const freezerId = new ObjectId();
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          status: 'ACTIVE',
          dimension: { rows: 4, cols: 4 },
          occupancyGrid: {}
        })
      });
      const storagePaths = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ boxId, rackId: null, shelfId: null, freezerId })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: freezerId, containerType: 'FREEZER', name: 'Freezer 1', status: 'RETIRED' })
      });
      const db = makeDb({ storageBoxes, storagePaths, storageContainers });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'LOCATION_UNAVAILABLE' })
      );
    });

    it('returns LOCATION_UNAVAILABLE when the box\'s rack is under MAINTENANCE (criterion 7)', async () => {
      const rackId = new ObjectId();
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          status: 'ACTIVE',
          dimension: { rows: 4, cols: 4 },
          occupancyGrid: {}
        })
      });
      const storagePaths = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ boxId, rackId, shelfId: null, freezerId: null })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: rackId, containerType: 'RACK', name: 'Rack 1', status: 'MAINTENANCE' })
      });
      const db = makeDb({ storageBoxes, storagePaths, storageContainers });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'LOCATION_UNAVAILABLE' })
      );
    });

    it('stays available when the box and every ancestor container are OPERATIONAL/ACTIVE (criterion 7, negative case)', async () => {
      const freezerId = new ObjectId();
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          status: 'ACTIVE',
          dimension: { rows: 4, cols: 4 },
          currentOccupancy: 0,
          occupancyGrid: {}
        })
      });
      const storagePaths = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ boxId, rackId: null, shelfId: null, freezerId })
      });
      // The production query filters status: { $ne: 'OPERATIONAL' } --
      // this mock (unlike a real Mongo query) doesn't evaluate the filter
      // itself, so "every ancestor is OPERATIONAL" is simulated the way
      // that filter would actually resolve against it: no matching
      // (non-operational) document, i.e. null, not the operational
      // container echoed back regardless of query.
      const storageContainers = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(null)
      });
      const db = makeDb({ storageBoxes, storagePaths, storageContainers });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result.available).toBe(true);
    });

    it('stays available when the box has no StoragePath and no parent_id either (no ancestor to check)', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          status: 'ACTIVE',
          dimension: { rows: 4, cols: 4 },
          currentOccupancy: 0,
          occupancyGrid: {}
        })
      });
      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ storageBoxes, storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result.available).toBe(true);
    });

    // #654: storagePaths is never written anywhere in api/backend/src, so
    // every real box hit the (storagePath ? ... : []) branch and skipped the
    // ancestor check entirely -- a RETIRED/MAINTENANCE rack/shelf/freezer
    // could never block allocation for any real box, only the mocked-path
    // unit tests above. The live parent_id walk fixes this for real boxes.
    it('#654: blocks via a live parent_id walk when there is no StoragePath document', async () => {
      const rackId = new ObjectId();
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          status: 'ACTIVE',
          parent_id: rackId,
          dimension: { rows: 4, cols: 4 },
          currentOccupancy: 0,
          occupancyGrid: {}
        })
      });
      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const rackDoc = { _id: rackId, containerType: 'RACK', name: 'Rack 1', status: 'MAINTENANCE', parent_id: null };
      const storageContainers = makeCollection({
        // First call is resolveAncestorContainersLive's own walk (fetches
        // the rack to learn its containerType/parent_id); second is the
        // actual $in + status:{$ne:'OPERATIONAL'} blocking-check query.
        findOne: vi.fn()
          .mockResolvedValueOnce(rackDoc)
          .mockResolvedValueOnce(rackDoc)
      });
      const db = makeDb({ storageBoxes, storagePaths, storageContainers });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'LOCATION_UNAVAILABLE' })
      );
    });

    // #655 (found verifying the live-backend e2e spec): a raw-driver insert
    // (every e2e seed helper, per #598's own precedent for the FREEZER
    // level -- and potentially real legacy data too) can produce a
    // StorageContainer with no status field at all, not just an explicit
    // non-OPERATIONAL one. { $ne: 'OPERATIONAL' } matches a *missing* field
    // just as readily as an explicit 'MAINTENANCE'/'RETIRED', which made
    // #654's live-walk fallback block every real allocation attempt whose
    // ancestor chain includes an unstatused container -- confirmed live via
    // seedStorageBoxLocation()'s SHELF/RACK containers (only the FREEZER
    // gets an explicit status), status undefined in the resulting 422.
    // The mock's own findOne can't evaluate a real Mongo filter's semantics
    // (same limitation the "every ancestor OPERATIONAL" test above notes),
    // so this asserts on the filter shape itself rather than trusting a
    // hand-picked resolved value -- that's what actually distinguishes the
    // buggy { $ne: 'OPERATIONAL' } from the fixed { $exists: true, $ne:
    // 'OPERATIONAL' }, and fails against the pre-fix query.
    it('#654 regression: the ancestor-block query requires status to exist, not just differ from OPERATIONAL', async () => {
      const rackId = new ObjectId();
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          status: 'ACTIVE',
          parent_id: rackId,
          dimension: { rows: 4, cols: 4 },
          currentOccupancy: 0,
          occupancyGrid: {}
        })
      });
      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const rackDoc = { _id: rackId, containerType: 'RACK', name: 'Rack 1', parent_id: null };
      const blockCheckFindOne = vi.fn().mockResolvedValueOnce(null);
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(rackDoc)
          .mockImplementationOnce(blockCheckFindOne)
      });
      const db = makeDb({ storageBoxes, storagePaths, storageContainers });
      const repo = new MongoStorageRepository(db);

      await repo.validatePositionAvailability({ boxId, position: 'A1' });

      expect(blockCheckFindOne).toHaveBeenCalledWith(
        expect.objectContaining({ status: { $exists: true, $ne: 'OPERATIONAL' } }),
        expect.anything()
      );
    });

    it('returns BOX_NOT_FOUND when box does not exist', async () => {
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'BOX_NOT_FOUND' })
      );
    });

    it('returns INVALID_POSITION_FORMAT for a malformed position', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          dimension: { rows: 4, cols: 4 },
          occupancyGrid: {}
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: '1A' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'INVALID_POSITION_FORMAT' })
      );
    });

    it('returns POSITION_OUT_OF_BOUNDS_ROW when row exceeds dimension', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          dimension: { rows: 2, cols: 4 },
          occupancyGrid: {}
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'C1' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'POSITION_OUT_OF_BOUNDS_ROW' })
      );
    });

    it('returns POSITION_OUT_OF_BOUNDS_COL when column exceeds dimension', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          dimension: { rows: 4, cols: 2 },
          occupancyGrid: {}
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A5' });
      expect(result).toEqual(
        expect.objectContaining({ available: false, error: 'POSITION_OUT_OF_BOUNDS_COL' })
      );
    });

    it('returns STORAGE_COLLISION with occupiedBySampleId when position occupied', async () => {
      const occupantId = new ObjectId();
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          dimension: { rows: 4, cols: 4 },
          occupancyGrid: { A1: occupantId }
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result).toEqual(
        expect.objectContaining({
          available: false,
          error: 'STORAGE_COLLISION',
          occupiedBySampleId: String(occupantId)
        })
      );
    });

    it('happy path returns available:true with computed capacity/availablePositions', async () => {
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          name: 'Box 1',
          dimension: { rows: 4, cols: 4 },
          currentOccupancy: 3,
          occupancyGrid: {}
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.validatePositionAvailability({ boxId, position: 'A1' });
      expect(result.available).toBe(true);
      expect(result.boxData.capacity).toBe(16);
      expect(result.boxData.availablePositions).toBe(13);
      expect(result.boxData.currentOccupancy).toBe(3);
    });
  });

  describe('getBoxAvailablePositions', () => {
    const boxId = new ObjectId().toString();

    it('returns null when box not found', async () => {
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getBoxAvailablePositions({ boxId });
      expect(result).toBeNull();
    });

    it('happy path computes positions/available/occupied/stats for a 2x2 grid with 1 occupied', async () => {
      const occupantId = new ObjectId();
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          name: 'Box 2x2',
          dimension: { rows: 2, cols: 2 },
          currentOccupancy: 1,
          occupancyGrid: { A1: occupantId }
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getBoxAvailablePositions({ boxId });
      expect(result.availablePositions.sort()).toEqual(['A2', 'B1', 'B2'].sort());
      expect(result.occupiedPositions).toEqual(['A1']);
      expect(result.stats).toEqual({
        capacity: 4,
        occupied: 1,
        available: 3,
        occupancyPercent: 25
      });
    });

    it('slices occupiedPositions to 10 entries', async () => {
      const occupancyGrid = {};
      // 3 rows x 5 cols = 15 positions, occupy all of them
      for (let row = 0; row < 3; row += 1) {
        const letter = String.fromCharCode(65 + row);
        for (let col = 1; col <= 5; col += 1) {
          occupancyGrid[`${letter}${col}`] = new ObjectId();
        }
      }
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: boxId,
          name: 'Big box',
          dimension: { rows: 3, cols: 5 },
          currentOccupancy: 15,
          occupancyGrid
        })
      });
      const db = makeDb({ storageBoxes });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getBoxAvailablePositions({ boxId });
      expect(result.availablePositions).toEqual([]);
      expect(result.occupiedPositions).toHaveLength(10);
      expect(result.stats.occupancyPercent).toBe(100);
    });
  });

  describe('getSampleStorageLocation', () => {
    const sampleId = new ObjectId().toString();

    it('returns found:false SAMPLE_NOT_FOUND when sample missing', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const storagePaths = makeCollection();
      const db = makeDb({ samples, storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getSampleStorageLocation({ sampleId });
      expect(result).toEqual({ found: false, error: 'SAMPLE_NOT_FOUND' });
    });

    it('returns found:false with message when sample has no storageLocation.boxId', async () => {
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: sampleId })
      });
      const storagePaths = makeCollection();
      const db = makeDb({ samples, storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getSampleStorageLocation({ sampleId });
      expect(result.found).toBe(false);
      expect(result.message).toMatch(/sem localização/);
    });

    it('happy path with matching storagePath populates fullHierarchy', async () => {
      const boxId = new ObjectId();
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: sampleId,
          barcode: 'BC-3',
          storageLocation: { boxId, position: 'A1' }
        })
      });
      const storagePaths = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          path: 'Freezer1/Shelf1/Rack1/Box1',
          freezerId: 'F1',
          shelfId: 'S1',
          rackId: 'R1',
          boxId
        })
      });
      const db = makeDb({ samples, storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getSampleStorageLocation({ sampleId });
      expect(result.found).toBe(true);
      expect(result.location.path).toBe('Freezer1/Shelf1/Rack1/Box1');
      expect(result.location.fullHierarchy).toEqual({
        freezerId: 'F1',
        shelfId: 'S1',
        rackId: 'R1',
        boxId
      });
    });

    it('returns path N/A and null fullHierarchy when there is no StoragePath and no resolvable box', async () => {
      const boxId = new ObjectId();
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: sampleId,
          barcode: 'BC-4',
          storageLocation: { boxId, position: 'B2' }
        })
      });
      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const db = makeDb({ samples, storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getSampleStorageLocation({ sampleId });
      expect(result.found).toBe(true);
      expect(result.location.path).toBe('N/A');
      expect(result.location.fullHierarchy).toBeNull();
    });

    // #657: storagePaths is never written anywhere in api/backend/src (#654),
    // so every real sample hit this branch and always showed path:'N/A' --
    // reuse #654's live parent_id-walk fallback here too.
    it('#657: falls back to a live parent_id walk when there is no StoragePath document', async () => {
      const boxId = new ObjectId();
      const rackId = new ObjectId();
      const shelfId = new ObjectId();
      const freezerId = new ObjectId();
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({
          _id: sampleId,
          barcode: 'BC-5',
          storageLocation: { boxId, position: 'C1' }
        })
      });
      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValueOnce(null) });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: boxId, name: 'Box1', parent_id: rackId })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: rackId, name: 'Rack1', containerType: 'RACK', parent_id: shelfId })
          .mockResolvedValueOnce({ _id: shelfId, name: 'Shelf1', containerType: 'SHELF', parent_id: freezerId })
          .mockResolvedValueOnce({ _id: freezerId, name: 'Freezer1', containerType: 'FREEZER', parent_id: null })
      });
      const db = makeDb({ samples, storagePaths, storageBoxes, storageContainers });
      const repo = new MongoStorageRepository(db);

      const result = await repo.getSampleStorageLocation({ sampleId });
      expect(result.found).toBe(true);
      expect(result.location.path).toBe('Freezer1/Shelf1/Rack1/Box1');
      expect(result.location.fullHierarchy).toEqual({
        freezerId,
        shelfId,
        rackId,
        boxId
      });
    });
  });

  describe('resolveStorageLocationsForSamples', () => {
    // #517: batched form of getSampleStorageLocation for SamplesPageView's
    // list view — one storagePaths $in query across the page instead of
    // one getSampleStorageLocation call per row.
    it('resolves each sample with a boxId via a single $in query, keyed by sample _id', async () => {
      const boxIdA = new ObjectId();
      const boxIdB = new ObjectId();
      const toArray = vi.fn().mockResolvedValue([
        { boxId: boxIdA, path: 'Freezer1/Shelf1/Rack1/BoxA', freezerId: 'F1', shelfId: 'S1', rackId: 'R1' },
        { boxId: boxIdB, path: 'Freezer1/Shelf1/Rack1/BoxB', freezerId: 'F1', shelfId: 'S1', rackId: 'R1' }
      ]);
      const findSpy = vi.fn().mockReturnValue({ toArray });
      const storagePaths = makeCollection({ find: findSpy });
      const db = makeDb({ storagePaths });
      const repo = new MongoStorageRepository(db);

      const sampleA = { _id: 'sample-a', barcode: 'BC-A', storageLocation: { boxId: boxIdA, position: 'A1' } };
      const sampleB = { _id: 'sample-b', barcode: 'BC-B', storageLocation: { boxId: boxIdB, position: 'B2' } };

      const result = await repo.resolveStorageLocationsForSamples([sampleA, sampleB]);

      expect(findSpy).toHaveBeenCalledTimes(1);
      expect(findSpy).toHaveBeenCalledWith({ boxId: { $in: [boxIdA, boxIdB] } });
      expect(result.get('sample-a').path).toBe('Freezer1/Shelf1/Rack1/BoxA');
      expect(result.get('sample-b').path).toBe('Freezer1/Shelf1/Rack1/BoxB');
    });

    it('maps a sample with no storageLocation.boxId to null without matching a boxId to it', async () => {
      const toArray = vi.fn().mockResolvedValue([]);
      const storagePaths = makeCollection({ find: vi.fn().mockReturnValue({ toArray }) });
      const db = makeDb({ storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.resolveStorageLocationsForSamples([{ _id: 'sample-c' }]);

      expect(result.get('sample-c')).toBeNull();
    });

    it('returns path N/A and null fullHierarchy for a boxId with no matching storagePath', async () => {
      const boxId = new ObjectId();
      const toArray = vi.fn().mockResolvedValue([]);
      const storagePaths = makeCollection({ find: vi.fn().mockReturnValue({ toArray }) });
      const db = makeDb({ storagePaths });
      const repo = new MongoStorageRepository(db);

      const result = await repo.resolveStorageLocationsForSamples([
        { _id: 'sample-d', storageLocation: { boxId, position: 'C3' } }
      ]);

      expect(result.get('sample-d').path).toBe('N/A');
      expect(result.get('sample-d').fullHierarchy).toBeNull();
    });

    it('skips the storagePaths query entirely when no sample has a boxId', async () => {
      const findSpy = vi.fn();
      const storagePaths = makeCollection({ find: findSpy });
      const db = makeDb({ storagePaths });
      const repo = new MongoStorageRepository(db);

      await repo.resolveStorageLocationsForSamples([{ _id: 'sample-e' }]);

      expect(findSpy).not.toHaveBeenCalled();
    });

    // #657: same live parent_id-walk fallback #654/#657's getSampleStorageLocation
    // fix introduced, reused here so a page of samples with no StoragePath
    // documents (every real box, per #654) still resolves a real path instead
    // of 'N/A' across the whole list view.
    it('#657: falls back to a live parent_id walk for boxes with no StoragePath document', async () => {
      const boxId = new ObjectId();
      const rackId = new ObjectId();
      const shelfId = new ObjectId();
      const freezerId = new ObjectId();
      const toArray = vi.fn().mockResolvedValue([]);
      const storagePaths = makeCollection({ find: vi.fn().mockReturnValue({ toArray }) });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce({ _id: boxId, name: 'Box1', parent_id: rackId })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: rackId, name: 'Rack1', containerType: 'RACK', parent_id: shelfId })
          .mockResolvedValueOnce({ _id: shelfId, name: 'Shelf1', containerType: 'SHELF', parent_id: freezerId })
          .mockResolvedValueOnce({ _id: freezerId, name: 'Freezer1', containerType: 'FREEZER', parent_id: null })
      });
      const db = makeDb({ storagePaths, storageBoxes, storageContainers });
      const repo = new MongoStorageRepository(db);

      const result = await repo.resolveStorageLocationsForSamples([
        { _id: 'sample-f', storageLocation: { boxId, position: 'D4' } }
      ]);

      expect(result.get('sample-f').path).toBe('Freezer1/Shelf1/Rack1/Box1');
      expect(result.get('sample-f').fullHierarchy).toEqual({
        freezerId,
        shelfId,
        rackId,
        boxId
      });
    });

    it('#657: resolves a shared boxId with only one live storageBoxes lookup', async () => {
      const boxId = new ObjectId();
      const rackId = new ObjectId();
      const shelfId = new ObjectId();
      const freezerId = new ObjectId();
      const toArray = vi.fn().mockResolvedValue([]);
      const storagePaths = makeCollection({ find: vi.fn().mockReturnValue({ toArray }) });
      const storageBoxesFindOne = vi.fn().mockResolvedValueOnce({ _id: boxId, name: 'Box1', parent_id: rackId });
      const storageBoxes = makeCollection({ findOne: storageBoxesFindOne });
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: rackId, name: 'Rack1', containerType: 'RACK', parent_id: shelfId })
          .mockResolvedValueOnce({ _id: shelfId, name: 'Shelf1', containerType: 'SHELF', parent_id: freezerId })
          .mockResolvedValueOnce({ _id: freezerId, name: 'Freezer1', containerType: 'FREEZER', parent_id: null })
      });
      const db = makeDb({ storagePaths, storageBoxes, storageContainers });
      const repo = new MongoStorageRepository(db);

      const result = await repo.resolveStorageLocationsForSamples([
        { _id: 'sample-g', storageLocation: { boxId, position: 'D4' } },
        { _id: 'sample-h', storageLocation: { boxId, position: 'D5' } }
      ]);

      expect(storageBoxesFindOne).toHaveBeenCalledTimes(1);
      expect(result.get('sample-g').path).toBe('Freezer1/Shelf1/Rack1/Box1');
      expect(result.get('sample-h').path).toBe('Freezer1/Shelf1/Rack1/Box1');
    });
  });

  describe('searchAllocatableSampleCandidates', () => {
    it('returns [] without hitting the db when query is shorter than 2 chars', async () => {
      const samples = makeCollection();
      const db = makeDb({ samples });
      const repo = new MongoStorageRepository(db);

      const result = await repo.searchAllocatableSampleCandidates({ query: 'a' });
      expect(result).toEqual([]);
      expect(samples.find).not.toHaveBeenCalled();
    });

    it('returns [] for an empty/missing query', async () => {
      const samples = makeCollection();
      const db = makeDb({ samples });
      const repo = new MongoStorageRepository(db);

      const result = await repo.searchAllocatableSampleCandidates({ query: '' });
      expect(result).toEqual([]);
      expect(samples.find).not.toHaveBeenCalled();
    });

    it('happy path builds the expected filter shape and chains limit(20)', async () => {
      const toArray = vi.fn().mockResolvedValueOnce([{ barcode: 'BC-9' }]);
      const limit = vi.fn(() => ({ toArray }));
      const find = vi.fn(() => ({ limit }));
      const samples = makeCollection({ find });
      const db = makeDb({ samples });
      const repo = new MongoStorageRepository(db);

      const result = await repo.searchAllocatableSampleCandidates({ query: 'BC-9' });

      expect(result).toEqual([{ barcode: 'BC-9' }]);
      expect(find).toHaveBeenCalledTimes(1);
      const filter = find.mock.calls[0][0];
      expect(filter.$and).toHaveLength(4);
      expect(filter.$and[0].$or).toEqual([
        { barcode: expect.any(RegExp) },
        { participantId: expect.any(RegExp) },
        { specimenId: expect.any(RegExp) }
      ]);
      expect(filter.$and[1]).toEqual({
        specimenStatus: { $in: ['available', 'reserved'] }
      });
      // RF006 AC3: a depleted specimen has no material to place.
      expect(filter.$and[2]).toEqual({ quantityStatus: { $ne: 'depleted' } });
      expect(filter.$and[3].$or).toEqual([
        { 'storageLocation.boxId': { $exists: false } },
        { 'storageLocation.boxId': null }
      ]);
      expect(limit).toHaveBeenCalledWith(20);
    });

    // #1212: the query is a search term, not a pattern. Unescaped, '(' threw a
    // SyntaxError (a 500 for the caller) and '.' matched any character.
    it('matches regex metacharacters in the query literally', async () => {
      const toArray = vi.fn().mockResolvedValue([]);
      const limit = vi.fn(() => ({ toArray }));
      const find = vi.fn(() => ({ limit }));
      const samples = makeCollection({ find });
      const db = makeDb({ samples });
      const repo = new MongoStorageRepository(db);

      await expect(repo.searchAllocatableSampleCandidates({ query: 'BC-9(' })).resolves.toEqual([]);
      await repo.searchAllocatableSampleCandidates({ query: 'BC.9' });

      const regex = find.mock.calls[1][0].$and[0].$or[0].barcode;
      expect(regex.test('BC.9')).toBe(true);
      expect(regex.test('BCX9')).toBe(false);
    });
  });
});
