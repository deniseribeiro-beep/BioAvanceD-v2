import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


function makeToken(accessType = 4) {
  return makeAuthToken(accessType);
}

function dbWithRbac(collections, accessType = 4) {
  return createDbMock({
    ...collections,
    ...buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType }]),
  });
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

const FACILITY_ID = new ObjectId();
const ROOM_ID = new ObjectId();
const FREEZER_ID = new ObjectId();

const FAKE_FACILITY = { _id: FACILITY_ID, name: 'Campus Central', code: null, address: null, description: null, deletedAt: null };
const FAKE_ROOM = { _id: ROOM_ID, facilityId: FACILITY_ID, name: 'Sala 1', code: null, description: null, deletedAt: null };
const FAKE_FREEZER = { _id: FREEZER_ID, name: 'Ultra-Freezer 01', containerType: 'FREEZER', roomId: null };
const FAKE_SHELF = { _id: new ObjectId(), name: 'Shelf 1', containerType: 'SHELF', roomId: null };

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/facilities', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/facilities');
    expect(res.status).toBe(401);
  });

  it('returns facility list', async () => {
    const coll = createCollectionMock({ find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([FAKE_FACILITY]) }) }) });
    app.locals.db = dbWithRbac({ facilities: coll }, 2);

    const res = await request(app).get('/api/facilities').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/facilities/:id', () => {
  it('returns 404 when not found', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = dbWithRbac({ facilities: coll }, 2);

    const res = await request(app)
      .get(`/api/facilities/${new ObjectId()}`)
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(404);
  });

  it('returns 400 on malformed id', async () => {
    const coll = createCollectionMock();
    app.locals.db = dbWithRbac({ facilities: coll }, 2);

    const res = await request(app)
      .get('/api/facilities/not-an-object-id')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/facilities', () => {
  it('rejects missing name with 400', async () => {
    const coll = createCollectionMock();
    app.locals.db = dbWithRbac({ facilities: coll }, 4);

    const res = await request(app)
      .post('/api/facilities')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects Tecnico (accessType 2) with 403 — manageStorageTopology requires Coordenador/Administrador (#929)', async () => {
    const coll = createCollectionMock();
    app.locals.db = dbWithRbac({ facilities: coll }, 2);

    const res = await request(app)
      .post('/api/facilities')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ name: 'Campus Central' });
    expect(res.status).toBe(403);
  });

  it('creates a facility for Coordenador (accessType 3) and writes an audit log entry', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: FACILITY_ID });
    const coll = createCollectionMock({ insertOne });
    const logsInsertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const logsColl = createCollectionMock({ insertOne: logsInsertOne });
    app.locals.db = dbWithRbac({ facilities: coll, logs: logsColl }, 3);

    const res = await request(app)
      .post('/api/facilities')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'Campus Central', code: 'CC-01' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Campus Central');
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ name: 'Campus Central', code: 'CC-01', deletedAt: null }));
    expect(logsInsertOne).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'Facility' }));
  });
});

describe('PUT /api/facilities/:id', () => {
  it('returns 404 when facility does not exist', async () => {
    const coll = createCollectionMock({ findOneAndUpdate: vi.fn().mockResolvedValue(null) });
    app.locals.db = dbWithRbac({ facilities: coll }, 4);

    const res = await request(app)
      .put(`/api/facilities/${new ObjectId()}`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Renamed' });
    expect(res.status).toBe(404);
  });

  it('updates a facility', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({ ...FAKE_FACILITY, name: 'Renamed' });
    const coll = createCollectionMock({ findOneAndUpdate });
    app.locals.db = dbWithRbac({ facilities: coll }, 4);

    const res = await request(app)
      .put(`/api/facilities/${FACILITY_ID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
  });
});

describe('DELETE /api/facilities/:id', () => {
  it('soft-deletes a facility (sets deletedAt, does not remove it)', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({ ...FAKE_FACILITY, deletedAt: new Date() });
    const coll = createCollectionMock({ findOneAndUpdate });
    app.locals.db = dbWithRbac({ facilities: coll }, 4);

    const res = await request(app)
      .delete(`/api/facilities/${FACILITY_ID}`)
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: null }),
      expect.objectContaining({ $set: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      expect.anything()
    );
  });
});

describe('POST /api/rooms', () => {
  it('rejects a room whose facilityId does not resolve to a real Facility', async () => {
    const facilitiesColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    const roomsColl = createCollectionMock();
    app.locals.db = dbWithRbac({ facilities: facilitiesColl, rooms: roomsColl }, 4);

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ facilityId: FACILITY_ID.toString(), name: 'Sala 1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('FACILITY_NOT_FOUND');
  });

  it('creates a room when facilityId resolves', async () => {
    const facilitiesColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_FACILITY) });
    const insertOne = vi.fn().mockResolvedValue({ insertedId: ROOM_ID });
    const roomsColl = createCollectionMock({ insertOne });
    app.locals.db = dbWithRbac({ facilities: facilitiesColl, rooms: roomsColl }, 4);

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ facilityId: FACILITY_ID.toString(), name: 'Sala 1' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Sala 1');
  });
});

describe('GET /api/rooms?facilityId=', () => {
  it('filters rooms by facilityId', async () => {
    const find = vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([FAKE_ROOM]) }) });
    const roomsColl = createCollectionMock({ find });
    app.locals.db = dbWithRbac({ rooms: roomsColl }, 2);

    const res = await request(app)
      .get(`/api/rooms?facilityId=${FACILITY_ID}`)
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ facilityId: expect.any(ObjectId) }));
  });
});

describe('PATCH /api/storage/freezer/:freezerId/room', () => {
  it('returns 404 when freezer does not exist', async () => {
    const storageColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = dbWithRbac({ storageContainers: storageColl }, 4);

    const res = await request(app)
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ roomId: ROOM_ID.toString() });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('FREEZER_NOT_FOUND');
  });

  // #1022: the catch-all was the ONLY failure path in this router that did
  // not use 5xx -- it answered 400 with error INTERNAL_ERROR, which tells a
  // caller "you sent something wrong" and "the server broke" in the same
  // body. The route's own expected failures (FREEZER_NOT_FOUND 404,
  // NOT_A_FREEZER 400, ROOM_NOT_FOUND 404) are all handled above the catch,
  // so nothing legitimate reaches it -- only a genuine unhandled exception.
  // Same class #892 already fixed in this router for checkBoxIntegrity.
  it('#1022: an unhandled exception answers 500, not 400', async () => {
    const storageColl = createCollectionMock({
      findOne: vi.fn().mockRejectedValue(new Error('driver exploded')),
    });
    app.locals.db = dbWithRbac({ storageContainers: storageColl }, 4);

    const res = await request(app)
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ roomId: ROOM_ID.toString() });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL_ERROR');
    expect(res.body.success).toBe(false);
  });

  it('rejects a non-FREEZER container with 400', async () => {
    const storageColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_SHELF) });
    app.locals.db = dbWithRbac({ storageContainers: storageColl }, 4);

    const res = await request(app)
      .patch(`/api/storage/freezer/${FAKE_SHELF._id}/room`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ roomId: ROOM_ID.toString() });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NOT_A_FREEZER');
  });

  it('returns 404 when roomId does not resolve to a real Room', async () => {
    const storageColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_FREEZER) });
    const roomsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = dbWithRbac({ storageContainers: storageColl, rooms: roomsColl }, 4);

    const res = await request(app)
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ roomId: ROOM_ID.toString() });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ROOM_NOT_FOUND');
  });

  it('assigns roomId to a FREEZER when both resolve', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const storageColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_FREEZER), updateOne });
    const roomsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_ROOM) });
    app.locals.db = dbWithRbac({ storageContainers: storageColl, rooms: roomsColl }, 4);

    const res = await request(app)
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ roomId: ROOM_ID.toString() });

    expect(res.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.any(ObjectId) },
      { $set: expect.objectContaining({ roomId: expect.any(ObjectId) }) }
    );
  });

  it('clears roomId when body omits it (unassign)', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const storageColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ ...FAKE_FREEZER, roomId: ROOM_ID }), updateOne });
    app.locals.db = dbWithRbac({ storageContainers: storageColl }, 4);

    const res = await request(app)
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: expect.any(ObjectId) },
      { $set: expect.objectContaining({ roomId: null }) }
    );
  });
});
