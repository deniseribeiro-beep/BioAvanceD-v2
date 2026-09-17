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

  describe('branch-complete canonical storage behavior', () => {
    it('walks live ancestors fail-closed for cycles and stops at missing parents', async () => {
      const a = new ObjectId();
      const b = new ObjectId();
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: a, parent_id: b })
          .mockResolvedValueOnce({ _id: b, parent_id: a })
      });
      const { repo } = makeRepo({ collections: { storageContainers } });

      await expect(repo.resolveAncestorContainersLive(null, {})).resolves.toEqual([]);
      await expect(repo.resolveAncestorContainersLive(a, {})).rejects.toThrow('Ciclo detectado');

      storageContainers.findOne = vi.fn().mockResolvedValue(null);
      await expect(repo.resolveAncestorContainersLive(a, {})).resolves.toEqual([]);
    });

    it('resolves nullable facility/room and complete live paths without making them custody authority', async () => {
      const freezerId = new ObjectId();
      const roomId = new ObjectId();
      const facilityId = new ObjectId();
      const boxId = new ObjectId();
      const rackId = new ObjectId();
      const shelfId = new ObjectId();
      const storageBoxes = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ _id: boxId, name: 'Box', parent_id: rackId })
          .mockResolvedValueOnce({ _id: boxId, name: 'Box', parent_id: rackId })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: freezerId, roomId: null })
          .mockResolvedValueOnce({ _id: freezerId, roomId })
          .mockResolvedValueOnce({ _id: rackId, name: 'Rack', containerType: 'RACK', parent_id: shelfId })
          .mockResolvedValueOnce({ _id: shelfId, name: 'Shelf', containerType: 'SHELF', parent_id: freezerId })
          .mockResolvedValueOnce({ _id: freezerId, name: 'Freezer', containerType: 'FREEZER', parent_id: null })
          .mockResolvedValueOnce({ _id: rackId, name: 'Rack', containerType: 'RACK', parent_id: null })
      });
      const rooms = makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: roomId, facilityId }) });
      const { repo } = makeRepo({ collections: { storageBoxes, storageContainers, rooms } });

      await expect(repo.findFacilityAndRoomForFreezer(null, {})).resolves.toEqual({ roomId: null, facilityId: null });
      await expect(repo.findFacilityAndRoomForFreezer(freezerId, {})).resolves.toEqual({ roomId: null, facilityId: null });
      await expect(repo.findFacilityAndRoomForFreezer(freezerId, {})).resolves.toEqual({
        roomId: String(roomId), facilityId: String(facilityId)
      });
      await expect(repo.resolveLiveStoragePath(new ObjectId(), {})).resolves.toBeNull();
      await expect(repo.resolveLiveStoragePath(boxId, {})).resolves.toEqual({
        path: 'Freezer/Shelf/Rack/Box',
        fullHierarchy: { freezerId, shelfId, rackId, boxId }
      });
      await expect(repo.resolveLiveStoragePath(boxId, {})).resolves.toBeNull();
    });

    it('blocks retired boxes and non-operational cached/live ancestors', async () => {
      const boxId = new ObjectId();
      const rackId = new ObjectId();
      const storagePaths = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ rackId, shelfId: null, freezerId: null })
          .mockResolvedValueOnce(null)
      });
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: rackId, containerType: 'RACK', name: 'Rack', status: 'MAINTENANCE' })
          .mockResolvedValueOnce({ _id: rackId, containerType: 'RACK', name: 'Rack', status: 'MAINTENANCE', parent_id: null })
          .mockResolvedValueOnce({ _id: rackId, containerType: 'RACK', name: 'Rack', status: 'MAINTENANCE' })
      });
      const { repo } = makeRepo({ collections: { storagePaths, storageContainers } });

      await expect(repo.checkLocationBlocked({ _id: boxId, status: 'RETIRED' }, {}))
        .resolves.toMatchObject({ blocked: true, error: 'BOX_UNAVAILABLE' });
      await expect(repo.checkLocationBlocked({ _id: boxId, status: 'OPERATIONAL' }, {}))
        .resolves.toMatchObject({ blocked: true, error: 'LOCATION_UNAVAILABLE' });
      await expect(repo.checkLocationBlocked({ _id: boxId, parent_id: rackId }, {}))
        .resolves.toMatchObject({ blocked: true, error: 'LOCATION_UNAVAILABLE' });
    });

    it('classifies every position-availability outcome and computes box statistics', async () => {
      const boxId = new ObjectId();
      const occupied = new ObjectId();
      const box = {
        _id: boxId, name: 'Box', status: 'OPERATIONAL',
        dimension: { rows: 2, cols: 2 },
        occupancyGrid: { A1: occupied },
        currentOccupancy: 1
      };
      const { repo } = makeRepo();
      vi.spyOn(repo, 'findBoxById')
        .mockResolvedValueOnce(null)
        .mockResolvedValue(box);
      vi.spyOn(repo, 'checkLocationBlocked').mockResolvedValue({ blocked: false });

      await expect(repo.validatePositionAvailability({ boxId, position: 'A1' }))
        .resolves.toMatchObject({ available: false, error: 'BOX_NOT_FOUND' });
      await expect(repo.validatePositionAvailability({ boxId, position: 'invalid' }))
        .resolves.toMatchObject({ available: false, error: 'INVALID_POSITION_FORMAT' });
      await expect(repo.validatePositionAvailability({ boxId, position: 'C1' }))
        .resolves.toMatchObject({ available: false, error: 'POSITION_OUT_OF_BOUNDS_ROW' });
      await expect(repo.validatePositionAvailability({ boxId, position: 'A3' }))
        .resolves.toMatchObject({ available: false, error: 'POSITION_OUT_OF_BOUNDS_COL' });
      await expect(repo.validatePositionAvailability({ boxId, position: 'A1' }))
        .resolves.toMatchObject({ available: false, error: 'STORAGE_COLLISION', occupiedBySampleId: String(occupied) });
      await expect(repo.validatePositionAvailability({ boxId, position: 'b2' }))
        .resolves.toMatchObject({ available: true, boxData: { capacity: 4, currentOccupancy: 1, availablePositions: 3 } });

      repo.findBoxById.mockResolvedValueOnce(null).mockResolvedValueOnce(box);
      await expect(repo.getBoxAvailablePositions({ boxId })).resolves.toBeNull();
      await expect(repo.getBoxAvailablePositions({ boxId })).resolves.toMatchObject({
        stats: { capacity: 4, occupied: 1, available: 3, occupancyPercent: 25 },
        availablePositions: ['A2', 'B1', 'B2'],
        occupiedPositions: ['A1']
      });
    });

    it('rejects assignment without a box and skips empty canonical projection chains', async () => {
      const projectionService = makeProjectionService();
      const { repo } = makeRepo({ projectionService });
      vi.spyOn(repo, 'findBoxById').mockResolvedValue(null);

      await expect(repo.assignCanonicalPhysicalPlacement({
        specimenId: 'SPEC-X', boxId: 'missing', positionCode: 'A1'
      }, {})).rejects.toThrow('Caixa de armazenamento não encontrada');
      await expect(repo.enqueueCanonicalPhysicalStorageProjection({}, {})).resolves.toBeNull();
      expect(projectionService.appendSpecimenContainerAssignmentEvent).not.toHaveBeenCalled();
    });

    it('does not project an absent release and supplies canonical release fallbacks', async () => {
      const projectionService = makeProjectionService();
      const physicalStore = makePhysicalStore({
        releaseSpecimenPosition: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            specimenContainerAssignmentId: 'sca-2',
            specimenId: 'SPEC-2',
            containerId: 'container-2',
            assignedAt: null,
            releasedAt: 'released',
            containerPositionAssignmentId: 'cpa-2',
            storagePositionId: 'position-2',
            placedAt: null,
            removedAt: null,
            rackLocationAssignmentId: null,
            storageRackId: 'rack-2',
            storageLocationId: null,
          })
      });
      const { repo } = makeRepo({ physicalStore, projectionService });

      await expect(repo.releaseCanonicalPhysicalPlacement({ specimenId: 'SPEC-1' }, {})).resolves.toBeNull();
      expect(projectionService.appendSpecimenContainerAssignmentEvent).not.toHaveBeenCalled();
      await repo.releaseCanonicalPhysicalPlacement({ specimenId: 'SPEC-2' }, {});
      expect(projectionService.appendSpecimenContainerAssignmentEvent).toHaveBeenCalledWith(
        repo.db,
        expect.objectContaining({
          specimenId: 'SPEC-2',
          removedAt: expect.any(Date),
          storageRackId: 'rack-2',
          sourceService: 'mongo-storage-repository-v2'
        }),
        { session: {} }
      );
    });

    it('fails allocation on every guarded precondition before canonical persistence', async () => {
      const sampleId = new ObjectId();
      const boxId = new ObjectId();
      const samples = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ _id: sampleId, specimenId: 'SPEC-1' })
      });
      const boxes = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ _id: boxId, dimension: { rows: 1, cols: 1 } })
      });
      const { repo } = makeRepo({ collections: { samples, storageBoxes: boxes } });
      vi.spyOn(repo, 'findCurrentStoragePlacement')
        .mockResolvedValueOnce({ specimenId: 'SPEC-1' })
        .mockResolvedValue(null);
      vi.spyOn(repo, 'checkLocationBlocked')
        .mockResolvedValueOnce({ blocked: true, message: 'blocked' })
        .mockResolvedValue({ blocked: false });

      await expect(repo.allocateSamplePosition({ specimenId: sampleId, boxId, position: 'A1' }, {}))
        .rejects.toThrow('Amostra não encontrada');
      await expect(repo.allocateSamplePosition({ specimenId: sampleId, boxId, position: 'A1' }, {}))
        .rejects.toThrow('já está alocada');
      await expect(repo.allocateSamplePosition({ specimenId: sampleId, boxId, position: 'A1' }, {}))
        .rejects.toThrow('Caixa de armazenamento não encontrada');
      await expect(repo.allocateSamplePosition({ specimenId: sampleId, boxId, position: 'A1' }, {}))
        .rejects.toThrow('blocked');
      await expect(repo.allocateSamplePosition({ specimenId: sampleId, boxId, position: 'bad' }, {}))
        .rejects.toThrow('Posição inválida');
      await expect(repo.allocateSamplePosition({ specimenId: sampleId, boxId, position: 'B1' }, {}))
        .rejects.toThrow('fora dos limites');
    });

    it('fails automatic allocation on every guarded precondition', async () => {
      const sampleId = new ObjectId();
      const boxId = new ObjectId();
      const fullBox = { _id: boxId, dimension: { rows: 1, cols: 1 }, occupancyGrid: { A1: sampleId } };
      const boxes = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue(fullBox)
      });
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const { repo } = makeRepo({ collections: { samples, storageBoxes: boxes } });
      vi.spyOn(repo, 'checkLocationBlocked')
        .mockResolvedValueOnce({ blocked: true, error: 'LOCATION_UNAVAILABLE' })
        .mockResolvedValue({ blocked: false });

      await expect(repo.autoAssignSamplePosition({ specimenId: sampleId, boxId }, {})).rejects.toThrow('BOX_NOT_FOUND');
      await expect(repo.autoAssignSamplePosition({ specimenId: sampleId, boxId }, {})).rejects.toThrow('LOCATION_UNAVAILABLE');

      boxes.findOne.mockResolvedValue(fullBox);
      await expect(repo.autoAssignSamplePosition({ specimenId: sampleId, boxId }, {})).rejects.toThrow('SAMPLE_NOT_FOUND');

      samples.findOne.mockResolvedValue({ _id: sampleId, specimenId: 'SPEC-1' });
      vi.spyOn(repo, 'findCurrentStoragePlacement')
        .mockResolvedValueOnce({ specimenId: 'SPEC-1' })
        .mockResolvedValue(null);
      await expect(repo.autoAssignSamplePosition({ specimenId: sampleId, boxId }, {})).rejects.toThrow('ALREADY_ALLOCATED');
      await expect(repo.autoAssignSamplePosition({ specimenId: sampleId, boxId }, {})).rejects.toThrow('BOX_FULL');
    });

    it('guards move and release consistency before mutating canonical custody', async () => {
      const sampleId = new ObjectId();
      const fromBoxId = new ObjectId();
      const toBoxId = new ObjectId();
      const samples = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ _id: sampleId, specimenId: 'SPEC-1' })
      });
      const boxes = makeCollection({
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
        findOne: vi.fn().mockResolvedValue(null)
      });
      const { repo } = makeRepo({ collections: { samples, storageBoxes: boxes } });
      vi.spyOn(repo, 'findCurrentStoragePlacement')
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ boxId: fromBoxId, positionCode: 'A1' });
      vi.spyOn(repo, 'checkLocationBlocked').mockResolvedValue({ blocked: false });

      const move = { specimenId: sampleId, fromBoxId, fromPosition: 'A1', toBoxId, toPosition: 'B1' };
      await expect(repo.moveSamplePosition(move, {})).rejects.toThrow('Amostra não encontrada');
      await expect(repo.moveSamplePosition(move, {})).rejects.toThrow('Origem inconsistente');
      await expect(repo.moveSamplePosition(move, {})).rejects.toThrow('posição de origem');

      boxes.updateOne.mockResolvedValue({ matchedCount: 1 });
      await expect(repo.moveSamplePosition(move, {})).rejects.toThrow('Caixa de destino não encontrada');
    });

    it('returns release evidence defaults and resolves physical-placement fallbacks', async () => {
      const sampleId = new ObjectId();
      const boxId = new ObjectId();
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValue({
          _id: sampleId, specimenId: 'SPEC-1', barcode: null, quantity: null, unit: null
        }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const boxes = makeCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
      const { repo } = makeRepo({ collections: { samples, storageBoxes: boxes } });
      vi.spyOn(repo, 'findCurrentStoragePlacement').mockResolvedValue({
        specimenId: 'SPEC-1', boxId, positionCode: 'A1'
      });
      vi.spyOn(repo, 'releaseCanonicalPhysicalPlacement').mockResolvedValue(null);

      await expect(repo.releaseSamplePosition({ specimenId: sampleId }, {})).resolves.toEqual({
        from: { boxId: String(boxId), position: 'A1' },
        barcode: null,
        quantity: null,
        unit: 'µL'
      });

      vi.spyOn(repo, 'findSampleById')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: sampleId, specimenId: 'SPEC-1', currentStoragePlacement: null });
      await expect(repo.getSamplePhysicalPlacement({ specimenId: 'missing' }))
        .resolves.toEqual({ found: false, error: 'SAMPLE_NOT_FOUND' });
      await expect(repo.getSamplePhysicalPlacement({ specimenId: 'SPEC-1' }))
        .resolves.toEqual({ found: false, message: 'Amostra sem posicionamento físico ativo' });
    });

    it('covers canonical identifier and nullable hierarchy fallbacks', async () => {
      const sampleId = new ObjectId();
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: sampleId }) });
      const physicalStore = makePhysicalStore({ findCurrentBySpecimen: vi.fn().mockResolvedValue(null) });
      const roomId = new ObjectId();
      const freezerId = new ObjectId();
      const storageContainers = makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: freezerId, roomId })
      });
      const rooms = makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: roomId }) });
      const { repo } = makeRepo({ collections: { samples, storageContainers, rooms }, physicalStore });

      await repo.findSampleById(sampleId, {});
      expect(physicalStore.findCurrentBySpecimen).toHaveBeenCalledWith(sampleId, {});
      await expect(repo.findFacilityAndRoomForFreezer(freezerId, {})).resolves.toEqual({
        roomId: String(roomId), facilityId: null
      });

      repo.db = makeDb({
        storagePaths: makeCollection({ findOne: vi.fn().mockResolvedValue({ rackId: null, shelfId: null, freezerId: null }) })
      });
      await expect(repo.findStorageHierarchyForBox(new ObjectId(), {})).resolves.toEqual({
        rackId: null, shelfId: null, equipmentId: null, roomId: null, facilityId: null
      });
    });

    it('requires every live-path ancestor type independently', async () => {
      const boxId = new ObjectId();
      const rack = { _id: new ObjectId(), name: 'Rack', containerType: 'RACK' };
      const shelf = { _id: new ObjectId(), name: 'Shelf', containerType: 'SHELF' };
      const freezer = { _id: new ObjectId(), name: 'Freezer', containerType: 'FREEZER' };
      const { repo } = makeRepo();
      vi.spyOn(repo, 'findBoxById').mockResolvedValue({ _id: boxId, name: 'Box', parent_id: rack._id });
      vi.spyOn(repo, 'resolveAncestorContainersLive')
        .mockResolvedValueOnce([shelf, freezer])
        .mockResolvedValueOnce([rack, freezer])
        .mockResolvedValueOnce([rack, shelf]);

      await expect(repo.resolveLiveStoragePath(boxId, {})).resolves.toBeNull();
      await expect(repo.resolveLiveStoragePath(boxId, {})).resolves.toBeNull();
      await expect(repo.resolveLiveStoragePath(boxId, {})).resolves.toBeNull();
    });

    it('propagates blocked-location validation and zero-capacity statistics', async () => {
      const boxId = new ObjectId();
      const box = {
        _id: boxId, name: 'Empty', status: 'OPERATIONAL',
        dimension: { rows: 0, cols: 0 }, occupancyGrid: {}, currentOccupancy: 0
      };
      const { repo } = makeRepo();
      vi.spyOn(repo, 'findBoxById').mockResolvedValue(box);
      vi.spyOn(repo, 'checkLocationBlocked')
        .mockResolvedValueOnce({ blocked: true, error: 'LOCATION_UNAVAILABLE', message: 'maintenance' })
        .mockResolvedValue({ blocked: false });

      await expect(repo.validatePositionAvailability({ boxId, position: 'A1' })).resolves.toEqual({
        available: false, error: 'LOCATION_UNAVAILABLE', message: 'maintenance'
      });
      await expect(repo.getBoxAvailablePositions({ boxId })).resolves.toMatchObject({
        stats: { capacity: 0, occupied: 0, available: 0, occupancyPercent: 0 },
        availablePositions: [],
        occupiedPositions: []
      });
    });

    it('projects every normalized-chain fallback without deriving operational authority from Neo4j', async () => {
      const projectionService = makeProjectionService();
      const { repo } = makeRepo({ projectionService });
      const session = { id: 'projection-fallbacks' };
      await repo.enqueueCanonicalPhysicalStorageProjection({
        specimenContainerAssignment: {
          specimenId: 'SPEC-F', specimenContainerAssignmentId: 'sca-f',
          containerId: 'container-f'
        },
        containerPositionAssignment: {},
        storageRack: { storageRackId: 'rack-f' }
      }, session);

      expect(projectionService.appendSpecimenContainerAssignmentEvent).toHaveBeenCalledWith(
        repo.db,
        {
          specimenContainerAssignmentId: 'sca-f',
          specimenId: 'SPEC-F',
          containerId: 'container-f',
          containerPositionAssignmentId: undefined,
          storagePositionId: undefined,
          rackLocationAssignmentId: null,
          storageRackId: 'rack-f',
          storageLocationId: null,
          assignedAt: null,
          releasedAt: null,
          placedAt: null,
          removedAt: null,
          sourceService: 'mongo-storage-repository-v2'
        },
        { session }
      );
    });

    it('moves canonical custody successfully and rejects target block/collision', async () => {
      const sampleId = new ObjectId();
      const fromBoxId = new ObjectId();
      const toBoxId = new ObjectId();
      const sample = { _id: sampleId, specimenId: 'SPEC-MOVE' };
      const targetBox = { _id: toBoxId, status: 'OPERATIONAL' };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValue(sample),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const boxes = makeCollection({
        findOne: vi.fn().mockResolvedValue(targetBox),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const { repo } = makeRepo({ collections: { samples, storageBoxes: boxes } });
      vi.spyOn(repo, 'findCurrentStoragePlacement').mockResolvedValue({
        specimenId: 'SPEC-MOVE', boxId: fromBoxId, positionCode: 'A1'
      });
      vi.spyOn(repo, 'checkLocationBlocked')
        .mockResolvedValueOnce({ blocked: true, message: 'target blocked' })
        .mockResolvedValue({ blocked: false });
      vi.spyOn(repo, 'releaseCanonicalPhysicalPlacement').mockResolvedValue({});
      vi.spyOn(repo, 'assignCanonicalPhysicalPlacement').mockResolvedValue({
        specimenId: 'SPEC-MOVE', boxId: toBoxId, positionCode: 'B1'
      });
      const input = { specimenId: sampleId, fromBoxId, fromPosition: 'A1', toBoxId, toPosition: 'b1' };

      await expect(repo.moveSamplePosition(input, {})).rejects.toThrow('target blocked');

      boxes.updateOne = vi.fn()
        .mockResolvedValueOnce({ matchedCount: 1 })
        .mockResolvedValueOnce({ matchedCount: 0 });
      await expect(repo.moveSamplePosition(input, {})).rejects.toThrow('STORAGE_COLLISION');

      boxes.updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      await expect(repo.moveSamplePosition(input, {})).resolves.toMatchObject({
        specimenId: 'SPEC-MOVE', positionCode: 'B1'
      });
      expect(repo.releaseCanonicalPhysicalPlacement).toHaveBeenCalledWith({ specimenId: 'SPEC-MOVE' }, {});
    });

    it('rejects every release inconsistency and resolves cached/live/N-A paths', async () => {
      const sampleId = new ObjectId();
      const boxId = new ObjectId();
      const samples = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue({ _id: sampleId, specimenId: 'SPEC-R', barcode: 'BC-R' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const boxes = makeCollection({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) });
      const { repo } = makeRepo({ collections: { samples, storageBoxes: boxes } });
      vi.spyOn(repo, 'findCurrentStoragePlacement')
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ specimenId: 'SPEC-R', boxId, positionCode: 'A1' });

      await expect(repo.releaseSamplePosition({ specimenId: sampleId }, {})).rejects.toThrow('Amostra não encontrada');
      await expect(repo.releaseSamplePosition({ specimenId: sampleId }, {})).rejects.toThrow('não possui posicionamento');
      await expect(repo.releaseSamplePosition({ specimenId: sampleId }, {})).rejects.toThrow('Origem inconsistente');

      const placement = { boxId, positionCode: 'A1' };
      vi.spyOn(repo, 'findSampleById').mockResolvedValue({
        _id: sampleId, specimenId: 'SPEC-R', barcode: 'BC-R', currentStoragePlacement: placement
      });
      vi.spyOn(repo, 'findBoxById').mockResolvedValue(null);
      vi.spyOn(repo, 'resolveLiveStoragePath')
        .mockResolvedValueOnce({ path: 'live/path', fullHierarchy: { boxId } })
        .mockResolvedValueOnce(null);
      const storagePaths = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ path: 'cached/path', freezerId: 'f', shelfId: 's', rackId: 'r', boxId })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
      });
      repo.db = makeDb({ storagePaths });

      await expect(repo.getSamplePhysicalPlacement({ specimenId: 'SPEC-R' }))
        .resolves.toMatchObject({ found: true, placement: { path: 'cached/path', fullHierarchy: { freezerId: 'f' } } });
      await expect(repo.getSamplePhysicalPlacement({ specimenId: 'SPEC-R' }))
        .resolves.toMatchObject({ found: true, placement: { path: 'live/path' } });
      await expect(repo.getSamplePhysicalPlacement({ specimenId: 'SPEC-R' }))
        .resolves.toMatchObject({ found: true, placement: { path: 'N/A', fullHierarchy: null, box: { boxName: null } } });
    });

    it('maps resolved and unresolved sample placements and excludes already allocated candidates', async () => {
      const first = { _id: new ObjectId(), specimenId: 'SPEC-1' };
      const second = { _id: new ObjectId() };
      const { repo } = makeRepo();
      vi.spyOn(repo, 'getSamplePhysicalPlacement')
        .mockResolvedValueOnce({ found: true, placement: { specimenId: 'SPEC-1' } })
        .mockResolvedValueOnce({ found: false });
      const mapped = await repo.resolvePhysicalPlacementsForSamples([first, second]);
      expect(mapped.get(String(first._id))).toEqual({ specimenId: 'SPEC-1' });
      expect(mapped.get(String(second._id))).toBeNull();

      const cursor = {
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([first, second])
      };
      repo.db = makeDb({ samples: makeCollection({ find: vi.fn().mockReturnValue(cursor) }) });
      vi.spyOn(repo, 'findCurrentStoragePlacement')
        .mockResolvedValueOnce({ specimenId: 'SPEC-1' })
        .mockResolvedValueOnce(null);
      await expect(repo.searchAllocatableSampleCandidates({ query: 'SP' })).resolves.toEqual([second]);
    });

    it('resolves batches and limits allocatable candidates to twenty', async () => {
      const { repo } = makeRepo();
      await expect(repo.resolvePhysicalPlacementsForSamples()).resolves.toEqual(new Map());
      await expect(repo.searchAllocatableSampleCandidates({ query: 'x' })).resolves.toEqual([]);

      const candidates = Array.from({ length: 25 }, (_, index) => ({
        _id: new ObjectId(),
        specimenId: 'SPEC-' + index,
        barcode: 'BC-' + index
      }));
      const cursor = {
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(candidates)
      };
      const samples = makeCollection({ find: vi.fn().mockReturnValue(cursor) });
      repo.db = makeDb({ samples });
      vi.spyOn(repo, 'findCurrentStoragePlacement').mockResolvedValue(null);

      const result = await repo.searchAllocatableSampleCandidates({ query: 'SPEC' });
      expect(result).toHaveLength(20);
      expect(cursor.limit).toHaveBeenCalledWith(100);
    });
  });


  describe('item 8 residual normalized-storage branch matrix', () => {
    it('commits a supported Mongo transaction and always closes its session', async () => {
      const session = {
        withTransaction: vi.fn(async (callback) => callback()),
        endSession: vi.fn().mockResolvedValue(undefined)
      };
      const client = { startSession: vi.fn(() => session) };
      const { repo } = makeRepo({ client });

      await expect(repo.withTransaction(async (activeSession) => {
        expect(activeSession).toBe(session);
        return 'committed';
      })).resolves.toBe('committed');
      expect(session.withTransaction).toHaveBeenCalledOnce();
      expect(session.endSession).toHaveBeenCalledOnce();
    });

    it('covers nullable and unknown layout nodes without inventing physical authority', async () => {
      const boxId = new ObjectId();
      const unknown = { _id: new ObjectId(), containerType: 'DRAWER', parent_id: null };
      const storagePaths = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const storageBoxes = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ _id: boxId, name: 'Box', parent_id: unknown._id })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(unknown)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(unknown)
          .mockResolvedValueOnce(null)
      });
      const { repo } = makeRepo({ collections: { storagePaths, storageBoxes, storageContainers } });

      await expect(repo.findStorageHierarchyForBox(boxId, {})).resolves.toMatchObject({
        rackId: null, shelfId: null, equipmentId: null, roomId: null, facilityId: null
      });
      await expect(repo.resolveLiveStoragePath(boxId, {})).resolves.toBeNull();
    });

    it('uses fail-closed blocked-container diagnostics when optional labels are absent', async () => {
      const boxId = new ObjectId();
      const blockedId = new ObjectId();
      const storagePaths = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ rackId: blockedId })
          .mockResolvedValueOnce({ rackId: blockedId })
      });
      const storageContainers = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce({ _id: blockedId, name: 'Rack sem tipo', status: 'MAINTENANCE' })
          .mockResolvedValueOnce({ _id: blockedId, containerType: 'RACK', status: 'MAINTENANCE' })
      });
      const { repo } = makeRepo({ collections: { storagePaths, storageContainers } });
      const box = { _id: boxId, status: 'OPERATIONAL' };

      await expect(repo.checkLocationBlocked(box, {})).resolves.toMatchObject({
        blocked: true,
        message: expect.stringContaining('container "Rack sem tipo"')
      });
      await expect(repo.checkLocationBlocked(box, {})).resolves.toMatchObject({
        blocked: true,
        message: expect.stringContaining(String(blockedId))
      });
    });

    it('guards missing canonical box and covers allocation fallbacks plus collision', async () => {
      const sampleId = new ObjectId();
      const boxId = new ObjectId();
      const sample = { _id: sampleId };
      const box = { _id: boxId, status: 'OPERATIONAL', dimension: { rows: 1, cols: 1 } };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValue(sample),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const boxes = makeCollection({
        findOne: vi.fn().mockResolvedValue(box),
        updateOne: vi.fn()
          .mockResolvedValueOnce({ matchedCount: 0 })
          .mockResolvedValue({ matchedCount: 1 })
      });
      const physicalStore = makePhysicalStore({
        findCurrentBySpecimen: vi.fn().mockResolvedValue(null)
      });
      const { repo } = makeRepo({ collections: { samples, storageBoxes: boxes }, physicalStore });
      vi.spyOn(repo, 'checkLocationBlocked').mockResolvedValue({ blocked: false });

      vi.spyOn(repo, 'findBoxById').mockResolvedValueOnce(null);
      await expect(repo.assignCanonicalPhysicalPlacement({
        specimenId: sampleId, boxId, positionCode: 'A1'
      }, {})).rejects.toThrow('Caixa de armazenamento não encontrada');

      await expect(repo.allocateSamplePosition({
        specimenId: sampleId, boxId, position: 'A1'
      }, {})).rejects.toThrow('STORAGE_COLLISION');

      vi.spyOn(repo, 'findStorageHierarchyForBox').mockResolvedValue({});
      vi.spyOn(repo, 'enqueueCanonicalPhysicalStorageProjection').mockResolvedValue({});
      vi.spyOn(repo, 'findBoxById').mockResolvedValue(box);
      await expect(repo.allocateSamplePosition({
        specimenId: sampleId, boxId, position: 'A1'
      }, {})).resolves.toBeNull();
      expect(physicalStore.assignSpecimenPosition).toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: sampleId }), {}
      );
    });

    it('covers automatic-allocation message fallback and optimistic collision', async () => {
      const sampleId = new ObjectId();
      const boxId = new ObjectId();
      const sample = { _id: sampleId };
      const box = { _id: boxId, dimension: { rows: 1, cols: 1 }, occupancyGrid: {} };
      const samples = makeCollection({ findOne: vi.fn().mockResolvedValue(sample) });
      const boxes = makeCollection({
        findOne: vi.fn().mockResolvedValue(box),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 })
      });
      const { repo } = makeRepo({ collections: { samples, storageBoxes: boxes } });
      vi.spyOn(repo, 'checkLocationBlocked')
        .mockResolvedValueOnce({ blocked: true, message: 'layout blocked' })
        .mockResolvedValue({ blocked: false });
      vi.spyOn(repo, 'findCurrentStoragePlacement').mockResolvedValue(null);

      await expect(repo.autoAssignSamplePosition({ specimenId: sampleId, boxId }, {}))
        .rejects.toThrow('layout blocked');
      await expect(repo.autoAssignSamplePosition({ specimenId: sampleId, boxId }, {}))
        .rejects.toThrow('STORAGE_COLLISION');
    });

    it('covers each move-origin predicate and successful release evidence fallbacks', async () => {
      const sampleId = new ObjectId();
      const fromBoxId = new ObjectId();
      const toBoxId = new ObjectId();
      const sample = { _id: sampleId, barcode: 'BC', quantity: 10, unit: 'mL' };
      const samples = makeCollection({
        findOne: vi.fn().mockResolvedValue(sample),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const boxes = makeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: toBoxId, status: 'OPERATIONAL' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 })
      });
      const { repo } = makeRepo({ collections: { samples, storageBoxes: boxes } });
      vi.spyOn(repo, 'findCurrentStoragePlacement')
        .mockResolvedValueOnce({ boxId: new ObjectId(), positionCode: 'A1' })
        .mockResolvedValueOnce({ boxId: fromBoxId, positionCode: 'B1' })
        .mockResolvedValue({ boxId: fromBoxId, positionCode: 'A1' });
      vi.spyOn(repo, 'checkLocationBlocked').mockResolvedValue({ blocked: false });
      vi.spyOn(repo, 'releaseCanonicalPhysicalPlacement').mockResolvedValue({});
      vi.spyOn(repo, 'assignCanonicalPhysicalPlacement').mockResolvedValue({ positionCode: 'B1' });
      const move = {
        specimenId: sampleId, fromBoxId, fromPosition: 'A1',
        toBoxId, toPosition: 'B1'
      };

      await expect(repo.moveSamplePosition(move, {})).rejects.toThrow('Origem inconsistente');
      await expect(repo.moveSamplePosition(move, {})).rejects.toThrow('Origem inconsistente');
      await expect(repo.moveSamplePosition(move, {})).resolves.toEqual({ positionCode: 'B1' });

      await expect(repo.releaseSamplePosition({ specimenId: sampleId }, {})).resolves.toEqual({
        from: { boxId: String(fromBoxId), position: 'A1' },
        barcode: 'BC',
        quantity: 10,
        unit: 'mL'
      });
      expect(repo.releaseCanonicalPhysicalPlacement).toHaveBeenLastCalledWith(
        { specimenId: sampleId }, {}
      );
    });

    it('returns a fully named live placement while retaining the canonical specimen id fallback', async () => {
      const sampleId = new ObjectId();
      const boxId = new ObjectId();
      const placement = { boxId, positionCode: 'C3' };
      const box = { _id: boxId, name: 'Box C' };
      const { repo } = makeRepo({
        collections: {
          storagePaths: makeCollection({ findOne: vi.fn().mockResolvedValue(null) }),
          storageBoxes: makeCollection({ findOne: vi.fn().mockResolvedValue(box) })
        }
      });
      vi.spyOn(repo, 'findSampleById').mockResolvedValue({
        _id: sampleId, barcode: 'BC-C', currentStoragePlacement: placement
      });
      vi.spyOn(repo, 'resolveLiveStoragePath').mockResolvedValue({
        path: 'Freezer/Shelf/Rack/Box C',
        fullHierarchy: { boxId }
      });

      await expect(repo.getSamplePhysicalPlacement({ specimenId: sampleId })).resolves.toMatchObject({
        found: true,
        placement: {
          specimenId: sampleId,
          barcode: 'BC-C',
          box: { boxName: 'Box C', position: 'C3' },
          path: 'Freezer/Shelf/Rack/Box C'
        }
      });
    });
  });


});
