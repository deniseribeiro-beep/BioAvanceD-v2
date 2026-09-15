import { describe, it, expect, vi, afterEach } from 'vitest';
const { ObjectId } = require('mongodb');
const StorageService = require('../../src/services/storageService');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');

function transactionalDb(collections = {}) {
  return createDbMock(collections);
}

function canonicalPlacement(specimenId, boxId, positionCode = 'A2') {
  return {
    specimenId: String(specimenId),
    containerId: `container-${specimenId}`,
    storageRackId: `rack-${boxId}`,
    storagePositionId: `position-${positionCode}`,
    boxId,
    positionCode,
    storageLocationId: 'location-1'
  };
}

function buildAutoService({ occupied = { A1: 'other' } } = {}) {
  const specimenId = new ObjectId();
  const boxId = new ObjectId();
  const db = transactionalDb();
  const service = new StorageService(db);
  const placement = canonicalPlacement(specimenId, boxId, 'A2');

  service.storageRepository = {
    findBoxById: vi.fn().mockResolvedValue({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: occupied,
      currentOccupancy: Object.values(occupied).filter(Boolean).length
    }),
    findSampleById: vi.fn().mockResolvedValue({
      _id: specimenId,
      specimenId: String(specimenId),
      barcode: 'BC-1',
      participantId: 'P-1',
      currentStoragePlacement: null
    }),
    autoAssignSamplePosition: vi.fn().mockResolvedValue(placement),
    withTransaction: vi.fn(async (handler) => handler(db.session))
  };
  service.auditRepository = { appendImmutableAudit: vi.fn().mockResolvedValue({ movementID: 1 }) };
  service.lineageRepository = {
    validateBeforePersistence: vi.fn().mockResolvedValue(true),
    recordCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'evt-auto', queued: true })
  };
  return { service, db, specimenId, boxId, placement };
}

afterEach(() => vi.restoreAllMocks());

describe('StorageService canonical v2 helpers', () => {
  it('normalizes ObjectId strings and preserves invalid identifiers', () => {
    const service = new StorageService(transactionalDb());
    const id = new ObjectId();
    expect(service._normalizeObjectId(id)).toBe(id);
    expect(service._normalizeObjectId(id.toString()).toString()).toBe(id.toString());
    expect(service._normalizeObjectId('external-specimen-id')).toBe('external-specimen-id');
  });

  it('finds the first available grid position without making the grid authoritative', () => {
    const service = new StorageService(transactionalDb());
    expect(service._findFirstAvailablePosition({
      dimension: { rows: 2, cols: 2 },
      occupancyGrid: { A1: 'x', A2: 'y' }
    })).toBe('B1');
    expect(service._findFirstAvailablePosition({ dimension: { rows: 1, cols: 1 }, occupancyGrid: { A1: 'x' } })).toBeNull();
  });
});

describe('StorageService.autoAssignSampleToBox canonical v2', () => {
  it('returns CurrentStoragePlacement and keeps audit/outbox in the same Mongo transaction', async () => {
    const { service, db, specimenId, boxId, placement } = buildAutoService();
    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result).toEqual({
      success: true,
      projectionQueued: true,
      projectionEventId: 'evt-auto',
      currentStoragePlacement: placement
    });
    expect(service.storageRepository.autoAssignSamplePosition).toHaveBeenCalledWith(
      { specimenId: expect.any(ObjectId), boxId: expect.any(ObjectId) },
      db.session
    );
    expect(service.lineageRepository.validateBeforePersistence).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'auto_allocate', requireEthicalConsent: true
    }), db.session);
    expect(service.lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(expect.objectContaining({
      to: { boxId: String(boxId), position: 'A2' }
    }), db.session);
    expect(service.auditRepository.appendImmutableAudit).toHaveBeenCalledWith(expect.objectContaining({
      after: { physicalStorage: { boxId: String(boxId), position: 'A2' } }
    }), db.session);
  });

  it('returns BOX_FULL without opening a transaction when no layout slot is available', async () => {
    const { service, specimenId, boxId } = buildAutoService({ occupied: { A1: 'x', A2: 'y' } });
    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.error).toBe('BOX_FULL');
    expect(service.storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('refuses a known standalone deployment instead of degrading custody writes', async () => {
    const { service, db, specimenId, boxId } = buildAutoService();
    db.client.db = vi.fn((name) => name === 'admin' ? { command: vi.fn().mockResolvedValue({ isWritablePrimary: true }) } : undefined);
    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('AUTO_ASSIGNMENT_ERROR');
    expect(result.message).toMatch(/replica set|mongos/i);
    expect(service.storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('does not report success when the transactional canonical placement write fails', async () => {
    const { service, specimenId, boxId } = buildAutoService();
    service.storageRepository.autoAssignSamplePosition.mockRejectedValueOnce(new Error('normalized write failed'));
    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result).toMatchObject({ success: false, error: 'AUTO_ASSIGNMENT_ERROR' });
    expect(result.message).toBe('normalized write failed');
  });
});

describe('StorageService.verifyBoxIntegrity canonical v2', () => {
  it('checks occupancy acceleration against the normalized placement chain', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();
    const storageBoxes = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({
        _id: boxId,
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: { A1: specimenId },
        currentOccupancy: 1
      })
    });
    const samples = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: specimenId, specimenId: String(specimenId) })
    });
    const service = new StorageService(transactionalDb({ storageBoxes, samples }));
    service.storageRepository.findCurrentStoragePlacement = vi.fn().mockResolvedValue({
      boxId,
      positionCode: 'A1'
    });

    const result = await service.verifyBoxIntegrity(boxId.toString());
    expect(result.valid).toBe(true);
    expect(service.storageRepository.findCurrentStoragePlacement).toHaveBeenCalledWith(String(specimenId));
  });

  it('flags an occupancy-grid entry that disagrees with the normalized chain', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();
    const storageBoxes = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({
        _id: boxId,
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: { A1: specimenId },
        currentOccupancy: 1
      })
    });
    const samples = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: specimenId }) });
    const service = new StorageService(transactionalDb({ storageBoxes, samples }));
    service.storageRepository.findCurrentStoragePlacement = vi.fn().mockResolvedValue({ boxId: new ObjectId(), positionCode: 'B2' });

    const result = await service.verifyBoxIntegrity(boxId.toString());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/cadeia física canônica/);
  });
});

describe('StorageService.releaseSampleFromPosition canonical v2', () => {
  it('releases the canonical placement with audit and projection queued in the transaction', async () => {
    const specimenId = new ObjectId();
    const boxId = new ObjectId();
    const db = transactionalDb();
    const service = new StorageService(db);
    const sample = { _id: specimenId, barcode: 'BC-2', currentStoragePlacement: { boxId, positionCode: 'C3' } };
    service.storageRepository = {
      findSampleById: vi.fn().mockResolvedValue(sample),
      releaseSamplePosition: vi.fn().mockResolvedValue({ from: { boxId: String(boxId), position: 'C3' } }),
      withTransaction: vi.fn(async (handler) => handler(db.session))
    };
    service.auditRepository = { appendImmutableAudit: vi.fn().mockResolvedValue({ movementID: 2 }) };
    service.lineageRepository = {
      validateBeforePersistence: vi.fn().mockResolvedValue(true),
      recordCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'evt-release', queued: true })
    };

    const result = await service.releaseSampleFromPosition(specimenId.toString());
    expect(result).toMatchObject({ success: true, projectionQueued: true, projectionEventId: 'evt-release' });
    expect(service.storageRepository.releaseSamplePosition).toHaveBeenCalledWith({ specimenId: expect.any(ObjectId) }, db.session);
    expect(service.auditRepository.appendImmutableAudit).toHaveBeenCalledWith(expect.objectContaining({ after: { physicalStorage: null } }), db.session);
    expect(service.lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(expect.anything(), db.session);
  });
});
