import { describe, it, expect, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MongoStorageRepository = require('../../src/infrastructure/persistence/mongo/MongoStorageRepository.js');

function makeCollection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    find: vi.fn(),
    ...overrides
  };
}

function makePhysicalStore(overrides = {}) {
  return {
    findCurrentBySpecimen: vi.fn().mockResolvedValue(null),
    assignSpecimenPosition: vi.fn().mockResolvedValue({
      specimenContainerAssignment: {
        specimenContainerAssignmentId: 'sca-1',
        specimenId: 'SPEC-1',
        containerId: 'container-1',
        assignedAt: new Date('2026-09-15T12:00:00Z'),
        releasedAt: null
      },
      containerPositionAssignment: {
        containerPositionAssignmentId: 'cpa-1',
        storagePositionId: 'position-1',
        placedAt: new Date('2026-09-15T12:00:00Z'),
        removedAt: null
      },
      storageRack: { storageRackId: 'rack-1' },
      rackLocationAssignment: {
        rackLocationAssignmentId: 'rla-1',
        storageRackId: 'rack-1',
        storageLocationId: 'location-1'
      }
    }),
    releaseSpecimenPosition: vi.fn().mockResolvedValue(null),
    ...overrides
  };
}

function makeProjectionService(overrides = {}) {
  return {
    appendSpecimenContainerAssignmentEvent: vi.fn().mockResolvedValue({ eventId: 'projection-1', queued: true }),
    ...overrides
  };
}

function makeDb(collections = {}, client = null) {
  const defaults = {
    samples: makeCollection(),
    storagePaths: makeCollection(),
    storageBoxes: makeCollection(),
    storageContainers: makeCollection(),
    rooms: makeCollection()
  };
  return {
    collection: (name) => collections[name] || defaults[name] || makeCollection(),
    ...(client ? { client } : {})
  };
}

function makeRepo({ collections = {}, physicalStore, projectionService, client } = {}) {
  const db = makeDb(collections, client);
  const store = physicalStore || makePhysicalStore();
  const graphProjectionService = projectionService || makeProjectionService();
  return {
    db,
    store,
    graphProjectionService,
    repo: new MongoStorageRepository(db, { physicalStore: store, graphProjectionService })
  };
}

describe('MongoStorageRepository canonical v2', () => {
  describe('identity and canonical reads', () => {
    it('normalizes valid ObjectId strings and preserves external identifiers', () => {
      const { repo } = makeRepo();
      const oid = new ObjectId();
      expect(repo.toObjectId(oid)).toBe(oid);
      expect(repo.toObjectId(String(oid))).toBeInstanceOf(ObjectId);
      expect(repo.toObjectId('external-specimen-id')).toBe('external-specimen-id');
    });

    it('returns the sample enriched only with currentStoragePlacement from the normalized store', async () => {
      const sampleId = new ObjectId();
      const session = { id: 's1' };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: sampleId, specimenId: 'SPEC-1', barcode: 'BC-1' })
      });
      const placement = { specimenId: 'SPEC-1', boxId: 'box-1', positionCode: 'A1' };
      const physicalStore = makePhysicalStore({ findCurrentBySpecimen: vi.fn().mockResolvedValue(placement) });
      const { repo } = makeRepo({ collections: { samples }, physicalStore });

      const result = await repo.findSampleById(String(sampleId), session);

      expect(result).toEqual({ _id: sampleId, specimenId: 'SPEC-1', barcode: 'BC-1', currentStoragePlacement: placement });
      expect(samples.findOne).toHaveBeenCalledWith(
        { $or: [{ _id: expect.any(ObjectId) }, { specimenId: String(sampleId) }] },
        { session }
      );
      expect(physicalStore.findCurrentBySpecimen).toHaveBeenCalledWith('SPEC-1', session);
    });

    it('returns null without querying normalized placement when the sample does not exist', async () => {
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const physicalStore = makePhysicalStore();
      const { repo } = makeRepo({ collections: { samples }, physicalStore });
      expect(await repo.findSampleById('missing')).toBeNull();
      expect(physicalStore.findCurrentBySpecimen).not.toHaveBeenCalled();
    });

    it('delegates current placement resolution to the normalized physical store', async () => {
      const placement = { specimenId: 'SPEC-2', boxId: 'box-2', positionCode: 'B2' };
      const physicalStore = makePhysicalStore({ findCurrentBySpecimen: vi.fn().mockResolvedValue(placement) });
      const { repo } = makeRepo({ physicalStore });
      const session = { id: 's2' };
      await expect(repo.findCurrentStoragePlacement('SPEC-2', session)).resolves.toEqual(placement);
      expect(physicalStore.findCurrentBySpecimen).toHaveBeenCalledWith('SPEC-2', session);
    });
  });

  describe('layout hierarchy', () => {
    it('resolves facility and room through the freezer path without making the path authoritative for custody', async () => {
      const boxId = new ObjectId();
      const freezerId = new ObjectId();
      const roomId = new ObjectId();
      const facilityId = new ObjectId();
      const storagePaths = makeCollection({
        findOne: vi.fn().mockResolvedValue({ rackId: new ObjectId(), shelfId: new ObjectId(), freezerId })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: freezerId, roomId })
      });
      const rooms = makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: roomId, facilityId }) });
      const { repo } = makeRepo({ collections: { storagePaths, storageContainers, rooms } });

      const result = await repo.findStorageHierarchyForBox(boxId, {});
      expect(result.equipmentId).toBe(String(freezerId));
      expect(result.roomId).toBe(String(roomId));
      expect(result.facilityId).toBe(String(facilityId));
    });

    it('falls back to a live ancestor walk when no cached StoragePath exists', async () => {
      const boxId = new ObjectId();
      const rackId = new ObjectId();
      const shelfId = new ObjectId();
      const freezerId = new ObjectId();
      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: boxId, parent_id: rackId }) });
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: rackId, containerType: 'RACK', parent_id: shelfId })
          .mockResolvedValueOnce({ _id: shelfId, containerType: 'SHELF', parent_id: freezerId })
          .mockResolvedValueOnce({ _id: freezerId, containerType: 'FREEZER', parent_id: null, roomId: null })
          .mockResolvedValueOnce({ _id: freezerId, roomId: null })
      });
      const { repo } = makeRepo({ collections: { storagePaths, storageBoxes, storageContainers } });

      const result = await repo.findStorageHierarchyForBox(boxId, {});
      expect(result).toMatchObject({
        rackId: String(rackId),
        shelfId: String(shelfId),
        equipmentId: String(freezerId),
        roomId: null,
        facilityId: null
      });
    });
  });

  describe('canonical persistence and projection outbox', () => {
    it('assigns the normalized physical chain, queues the projection and returns the resolved placement', async () => {
      const boxId = new ObjectId();
      const session = { id: 'tx-1' };
      const box = { _id: boxId, name: 'Box 1' };
      const storageBoxes = makeCollection({ findOne: vi.fn().mockResolvedValue(box) });
      const physicalStore = makePhysicalStore();
      const current = { specimenId: 'SPEC-1', boxId: String(boxId), positionCode: 'A1' };
      physicalStore.findCurrentBySpecimen.mockResolvedValue(current);
      const projectionService = makeProjectionService();
      const { repo } = makeRepo({ collections: { storageBoxes }, physicalStore, projectionService });
      vi.spyOn(repo, 'findStorageHierarchyForBox').mockResolvedValue({ rackId: 'rack-1' });

      const result = await repo.assignCanonicalPhysicalPlacement({ specimenId: 'SPEC-1', boxId, positionCode: 'A1' }, session);

      expect(physicalStore.assignSpecimenPosition).toHaveBeenCalledWith({
        specimenId: 'SPEC-1', box, positionCode: 'A1', hierarchy: { rackId: 'rack-1' }
      }, session);
      expect(projectionService.appendSpecimenContainerAssignmentEvent).toHaveBeenCalledWith(
        repo.db,
        expect.objectContaining({ specimenId: 'SPEC-1', sourceService: 'mongo-storage-repository-v2' }),
        { session }
      );
      expect(result).toEqual(current);
    });

    it('releases normalized custody and queues a release projection in the same session', async () => {
      const released = {
        specimenContainerAssignmentId: 'sca-1', specimenId: 'SPEC-1', containerId: 'container-1',
        containerPositionAssignmentId: 'cpa-1', storagePositionId: 'position-1',
        rackLocationAssignmentId: 'rla-1', storageRackId: 'rack-1', storageLocationId: 'location-1',
        assignedAt: new Date(), releasedAt: new Date(), placedAt: new Date(), removedAt: new Date()
      };
      const physicalStore = makePhysicalStore({ releaseSpecimenPosition: vi.fn().mockResolvedValue(released) });
      const projectionService = makeProjectionService();
      const { repo } = makeRepo({ physicalStore, projectionService });
      const session = { id: 'tx-2' };

      await expect(repo.releaseCanonicalPhysicalPlacement({ specimenId: 'SPEC-1' }, session)).resolves.toEqual(released);
      expect(physicalStore.releaseSpecimenPosition).toHaveBeenCalledWith('SPEC-1', session);
      expect(projectionService.appendSpecimenContainerAssignmentEvent).toHaveBeenCalledWith(
        repo.db,
        expect.objectContaining({ specimenId: 'SPEC-1', releasedAt: released.releasedAt }),
        { session }
      );
    });
  });

  describe('allocation acceleration grid + canonical authority', () => {
    it('allocates the occupancy acceleration slot and then persists the canonical chain', async () => {
      const sampleId = new ObjectId();
      const boxId = new ObjectId();
      const session = { id: 'tx-3' };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: sampleId, specimenId: 'SPEC-3' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: boxId, dimension: { rows: 2, cols: 2 }, occupancyGrid: {}, currentOccupancy: 0 }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const { repo } = makeRepo({ collections: { samples, storageBoxes } });
      vi.spyOn(repo, 'findCurrentStoragePlacement').mockResolvedValue(null);
      vi.spyOn(repo, 'checkLocationBlocked').mockResolvedValue({ blocked: false });
      const placement = { specimenId: 'SPEC-3', boxId: String(boxId), positionCode: 'B2' };
      vi.spyOn(repo, 'assignCanonicalPhysicalPlacement').mockResolvedValue(placement);

      const result = await repo.allocateSamplePosition({ specimenId: String(sampleId), boxId: String(boxId), position: 'b2' }, session);

      expect(storageBoxes.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(ObjectId), 'occupancyGrid.B2': { $exists: false } },
        expect.objectContaining({ $set: expect.objectContaining({ 'occupancyGrid.B2': expect.any(ObjectId) }), $inc: { currentOccupancy: 1 } }),
        { session }
      );
      expect(repo.assignCanonicalPhysicalPlacement).toHaveBeenCalledWith({
        specimenId: 'SPEC-3', boxId: expect.any(ObjectId), positionCode: 'B2'
      }, session);
      expect(result).toEqual(placement);
    });

    it('auto-allocation returns the canonical placement rather than a raw grid position', async () => {
      const sampleId = new ObjectId();
      const boxId = new ObjectId();
      const session = { id: 'tx-4' };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: sampleId, specimenId: 'SPEC-4' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: boxId, dimension: { rows: 1, cols: 2 }, occupancyGrid: { A1: new ObjectId() }, currentOccupancy: 1 }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const { repo } = makeRepo({ collections: { samples, storageBoxes } });
      vi.spyOn(repo, 'findCurrentStoragePlacement').mockResolvedValue(null);
      vi.spyOn(repo, 'checkLocationBlocked').mockResolvedValue({ blocked: false });
      const placement = { specimenId: 'SPEC-4', boxId: String(boxId), positionCode: 'A2' };
      vi.spyOn(repo, 'assignCanonicalPhysicalPlacement').mockResolvedValue(placement);

      const result = await repo.autoAssignSamplePosition({ specimenId: String(sampleId), boxId: String(boxId) }, session);

      expect(repo.assignCanonicalPhysicalPlacement).toHaveBeenCalledWith({
        specimenId: 'SPEC-4', boxId: expect.any(ObjectId), positionCode: 'A2'
      }, session);
      expect(result).toEqual(placement);
    });

    it('does not create canonical custody when the acceleration-grid compare-and-set detects a collision', async () => {
      const sampleId = new ObjectId();
      const boxId = new ObjectId();
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: sampleId, specimenId: 'SPEC-5' }) });
      const storageBoxes = makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: boxId, dimension: { rows: 1, cols: 1 }, occupancyGrid: {}, currentOccupancy: 0 }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 })
      });
      const { repo } = makeRepo({ collections: { samples, storageBoxes } });
      vi.spyOn(repo, 'findCurrentStoragePlacement').mockResolvedValue(null);
      vi.spyOn(repo, 'checkLocationBlocked').mockResolvedValue({ blocked: false });
      const assign = vi.spyOn(repo, 'assignCanonicalPhysicalPlacement');

      await expect(repo.allocateSamplePosition({ specimenId: String(sampleId), boxId: String(boxId), position: 'A1' }, {}))
        .rejects.toThrow('STORAGE_COLLISION');
      expect(assign).not.toHaveBeenCalled();
    });
  });

  describe('Mongo transaction boundary', () => {
    it('runs the handler through one session and always ends the session', async () => {
      const endSession = vi.fn().mockResolvedValue(undefined);
      const session = { withTransaction: vi.fn(async (fn) => fn()), endSession };
      const client = {
        db: vi.fn(() => ({ command: vi.fn().mockResolvedValue({ setName: 'rs0' }) })),
        startSession: vi.fn(() => session)
      };
      const { repo } = makeRepo({ client });
      const handler = vi.fn(async () => 'ok');

      await expect(repo.withTransaction(handler)).resolves.toBe('ok');
      expect(handler).toHaveBeenCalledWith(session);
      expect(endSession).toHaveBeenCalledTimes(1);
    });

    it('rejects persistence when no transaction-capable Mongo client exists', async () => {
      const { repo } = makeRepo();
      await expect(repo.withTransaction(async () => undefined)).rejects.toThrow('não suporta transação');
    });
  });
});
