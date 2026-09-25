import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1124: before this, no request on a running stack could create a
// StorageContainer or a StorageBox -- location-storage-backfill.service.js
// held the only insertOne calls, and it reads legacy `locations`. Ported
// from Denise's stabilize/v2.0.0-prototype (12b2f889, dd75ae70, 4dad2186,
// 23e17a1c); adapted to this branch's factories and to #1164's
// `$gt: ''` containerID partial filter.

function makeToken(accessType = 3) {
  return jwt.sign(
    { userID: 'qa-user-1', accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function dbWithRbac(collections, accessType = 3) {
  return createDbMock({
    ...collections,
    ...buildRbacCollections([{ userAccountId: 'qa-user-1', accessType }]),
  });
}

beforeEach(() => {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-topology' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-topology' });
  vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('governed storage topology authoring (#1124)', () => {
  it('rejects Técnico: layout authoring is manageStorageTopology, not manageStorageAllocation', async () => {
    const storageContainers = createCollectionMock();
    app.locals.db = dbWithRbac({ storageContainers }, 2);

    const res = await request(app)
      .post('/api/storage/topology/containers')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ name: 'UF-01', containerType: 'FREEZER', equipmentId: 'EQ-01' });

    expect(res.status).toBe(403);
    expect(storageContainers.insertOne).not.toHaveBeenCalled();
  });

  it('creates a FREEZER from an existing Equipment and preserves the RF004 equipment identifier join', async () => {
    const freezerId = new ObjectId();
    const roomId = new ObjectId();
    const storageInsert = vi.fn().mockResolvedValue({ insertedId: freezerId });
    const storageContainers = createCollectionMock({ insertOne: storageInsert });
    const equipment = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), equipmentID: 4201, deletedAt: null }),
    });
    const rooms = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: roomId, name: 'Sala fria', deletedAt: null }),
    });
    app.locals.db = dbWithRbac({ storageContainers, equipment, rooms }, 3);

    const res = await request(app)
      .post('/api/storage/topology/containers')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({
        name: 'Ultra-Freezer 01',
        containerType: 'FREEZER',
        equipmentId: '4201',
        roomId: roomId.toString(),
        temperature: -80,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.containerID).toBe(4201);
    expect(storageContainers.createIndex).toHaveBeenCalledWith(
      { containerID: 1 },
      expect.objectContaining({ unique: true, partialFilterExpression: { containerID: { $gt: '' } } })
    );
    expect(storageInsert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ultra-Freezer 01',
      containerType: 'FREEZER',
      parent_id: null,
      containerID: 4201,
      roomId,
      temperature: -80,
      status: 'OPERATIONAL',
    }));
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', resourceType: 'StorageContainerLayout' }));
  });

  it('answers 404 EQUIPMENT_NOT_FOUND for a FREEZER naming no Equipment, and writes nothing', async () => {
    const storageContainers = createCollectionMock();
    const equipment = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = dbWithRbac({ storageContainers, equipment }, 3);

    const res = await request(app)
      .post('/api/storage/topology/containers')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'UF-ghost', containerType: 'FREEZER', equipmentId: 'EQ-NOPE' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('EQUIPMENT_NOT_FOUND');
    expect(storageContainers.insertOne).not.toHaveBeenCalled();
  });

  it('maps a duplicate containerID (E11000) to 409 STORAGE_CONTAINER_CONFLICT', async () => {
    const dup = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const storageContainers = createCollectionMock({ insertOne: vi.fn().mockRejectedValue(dup) });
    const equipment = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), equipmentID: 4201, deletedAt: null }),
    });
    app.locals.db = dbWithRbac({ storageContainers, equipment }, 3);

    const res = await request(app)
      .post('/api/storage/topology/containers')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'UF-dup', containerType: 'FREEZER', equipmentId: '4201' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STORAGE_CONTAINER_CONFLICT');
  });

  // The E11000 path above cannot fire for the canonical numeric containerID
  // (#757): the unique index's `$gt: ''` filter admits strings only. This is
  // the check that actually stops a second FREEZER claiming one Equipment,
  // including across number/string variants.
  it('answers 409 when a FREEZER already holds that equipment under the other id type, without inserting', async () => {
    const storageContainers = createCollectionMock({
      findOne: vi.fn().mockImplementation(async (filter) => (
        filter?.containerID?.$in?.includes('4201')
          ? { _id: new ObjectId(), containerType: 'FREEZER', containerID: '4201' }
          : null
      )),
    });
    const equipment = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), equipmentID: 4201, deletedAt: null }),
    });
    app.locals.db = dbWithRbac({ storageContainers, equipment }, 3);

    const res = await request(app)
      .post('/api/storage/topology/containers')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'UF-second', containerType: 'FREEZER', equipmentId: '4201' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('STORAGE_CONTAINER_CONFLICT');
    expect(storageContainers.insertOne).not.toHaveBeenCalled();
  });

  it('rejects a RACK whose parent is not a SHELF', async () => {
    const storageContainers = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), containerType: 'FREEZER', deletedAt: null }),
    });
    app.locals.db = dbWithRbac({ storageContainers }, 3);

    const res = await request(app)
      .post('/api/storage/topology/containers')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'Rack A', containerType: 'RACK', parentId: new ObjectId().toString() });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_HIERARCHY');
    expect(storageContainers.insertOne).not.toHaveBeenCalled();
  });

  it('creates a StorageBox under RACK as layout configuration with deterministic capacity and empty occupancy', async () => {
    const rackId = new ObjectId();
    const boxId = new ObjectId();
    const storageContainers = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: rackId, containerType: 'RACK', deletedAt: null }),
    });
    const boxInsert = vi.fn().mockResolvedValue({ insertedId: boxId });
    const storageBoxes = createCollectionMock({ insertOne: boxInsert });
    app.locals.db = dbWithRbac({ storageContainers, storageBoxes }, 3);

    const res = await request(app)
      .post('/api/storage/topology/boxes')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'Box A1', parentId: rackId.toString(), dimension: { rows: 9, cols: 9 } });

    expect(res.status).toBe(201);
    expect(res.body.data.capacity).toBe(81);
    expect(boxInsert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Box A1',
      parent_id: rackId,
      dimension: { rows: 9, cols: 9 },
      occupancyGrid: {},
      capacity: 81,
      currentOccupancy: 0,
      status: 'ACTIVE',
    }));
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', resourceType: 'StorageBoxLayout' }));
  });

  it('rejects a box whose parent is a FREEZER, keeping FREEZER -> SHELF -> RACK -> BOX invariants explicit', async () => {
    const freezerId = new ObjectId();
    const storageContainers = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: freezerId, containerType: 'FREEZER', deletedAt: null }),
    });
    const storageBoxes = createCollectionMock();
    app.locals.db = dbWithRbac({ storageContainers, storageBoxes }, 3);

    const res = await request(app)
      .post('/api/storage/topology/boxes')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'Box inválida', parentId: freezerId.toString(), dimension: { rows: 9, cols: 9 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_HIERARCHY');
    expect(storageBoxes.insertOne).not.toHaveBeenCalled();
  });
});
