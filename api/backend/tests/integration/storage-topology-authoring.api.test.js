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
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


function makeToken(accessType = 3) {
  return makeAuthToken(accessType);
}

function dbWithRbac(collections, accessType = 3) {
  return createDbMock({
    ...collections,
    ...buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[accessType] || TEST_USER_ACCOUNT_IDS[4], accessType }]),
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
    app.locals.db = dbWithRbac({}, 2);

    const res = await request(app)
      .post('/api/storage/topology/containers')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ name: 'UF-01', containerType: 'FREEZER', equipmentId: 'EQ-01' });

    expect(res.status).toBe(403);
  });

  it('creates a FREEZER from an existing Equipment and preserves the RF004 equipment identifier join', async () => {
    const freezerId = new ObjectId();
    const roomId = new ObjectId();
    const storageInsert = vi.fn().mockResolvedValue({ insertedId: freezerId });
    const storageContainers = createCollectionMock({ insertOne: storageInsert });
    const equipment = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), equipmentID: 'EQ-UF-01', deletedAt: null }),
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
        equipmentId: 'EQ-UF-01',
        roomId: roomId.toString(),
        temperature: -80,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.containerID).toBe('EQ-UF-01');
    expect(storageContainers.createIndex).toHaveBeenCalledWith(
      { containerID: 1 },
      expect.objectContaining({ unique: true, partialFilterExpression: { containerID: { $type: 'string' } } })
    );
    expect(storageInsert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ultra-Freezer 01',
      containerType: 'FREEZER',
      parent_id: null,
      containerID: 'EQ-UF-01',
      roomId,
      temperature: -80,
      status: 'OPERATIONAL',
    }));
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', resourceType: 'StorageContainerLayout' }));
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
