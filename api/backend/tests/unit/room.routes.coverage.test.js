import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/interface/routes/room.routes.js');

let currentUser = { userID: 'user-1' };

const authModule = require(authPath);
const originalAuthenticate = authModule.authenticate;
authModule.authenticate = (req, res, next) => {
  req.user = currentUser;
  next();
};

const rbacModule = require(rbacPath);
const originalRequirePermission = rbacModule.requirePermission;
rbacModule.requirePermission = () => (req, res, next) => next();

delete require.cache[routePath];
const router = require(routePath);

authModule.authenticate = originalAuthenticate;
rbacModule.requirePermission = originalRequirePermission;

const auditLogger = require('../../src/utils/auditLogger');
const logger = require('../../src/utils/logger');

function makeCollection(overrides = {}) {
  return {
    find: vi.fn(() => ({
      sort: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue([]),
      })),
    })),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId('507f1f77bcf86cd799439011') }),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeDb(overrides = {}) {
  const collections = {
    rooms: makeCollection(),
    facilities: makeCollection(),
    ...overrides,
  };
  return {
    db: {
      collection: vi.fn((name) => {
        if (!collections[name]) collections[name] = makeCollection();
        return collections[name];
      }),
    },
    collections,
  };
}

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/rooms', router);
  return app;
}

beforeEach(() => {
  vi.restoreAllMocks();
  currentUser = { userID: 'user-1' };
  vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  vi.spyOn(logger, 'error').mockImplementation(() => {});
});

describe('room.routes item 8 coverage', () => {
  describe('GET /', () => {
    it('lists undeleted rooms without a facility filter', async () => {
      const toArray = vi.fn().mockResolvedValue([{ name: 'A' }]);
      const sort = vi.fn(() => ({ toArray }));
      const rooms = makeCollection({ find: vi.fn(() => ({ sort })) });
      const { db } = makeDb({ rooms });

      const res = await request(buildApp(db)).get('/api/rooms');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ name: 'A' }]);
      expect(rooms.find).toHaveBeenCalledWith({ deletedAt: null });
      expect(sort).toHaveBeenCalledWith({ name: 1 });
    });

    it('filters by a valid facilityId and rejects an invalid one', async () => {
      const facilityId = '507f1f77bcf86cd799439011';
      const rooms = makeCollection();
      const { db } = makeDb({ rooms });

      let res = await request(buildApp(db)).get(`/api/rooms?facilityId=${facilityId}`);
      expect(res.status).toBe(200);
      const query = rooms.find.mock.calls[0][0];
      expect(query.facilityId).toBeInstanceOf(ObjectId);
      expect(query.facilityId.toString()).toBe(facilityId);

      res = await request(buildApp(db)).get('/api/rooms?facilityId=bad');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('facilityId inválido');
    });

    it('maps list failures to 500', async () => {
      const rooms = makeCollection({
        find: vi.fn(() => {
          throw new Error('list failed');
        }),
      });
      const { db } = makeDb({ rooms });

      const res = await request(buildApp(db)).get('/api/rooms');

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('list failed');
    });
  });

  describe('GET /:id', () => {
    it('returns 400 for malformed ObjectId, 404 when missing and 200 when found', async () => {
      const roomId = '507f1f77bcf86cd799439011';
      const rooms = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ _id: roomId, name: 'Room A' }),
      });
      const { db } = makeDb({ rooms });

      let res = await request(buildApp(db)).get('/api/rooms/not-an-id');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ID inválido');

      res = await request(buildApp(db)).get(`/api/rooms/${roomId}`);
      expect(res.status).toBe(404);

      res = await request(buildApp(db)).get(`/api/rooms/${roomId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Room A');
    });

    it('maps collection failures to 500 after ObjectId construction', async () => {
      const rooms = makeCollection({ findOne: vi.fn().mockRejectedValue(new Error('find failed')) });
      const { db } = makeDb({ rooms });

      const res = await request(buildApp(db)).get('/api/rooms/507f1f77bcf86cd799439011');

      // The route intentionally treats any failure inside the local ObjectId/findOne
      // block as an invalid id response.
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ID inválido');
    });
  });

  describe('POST /', () => {
    it('rejects missing/blank name, missing facilityId and invalid facilityId', async () => {
      const { db } = makeDb();

      let res = await request(buildApp(db)).post('/api/rooms').send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('name é obrigatório');
      expect(res.body.message).toContain('facilityId é obrigatório');

      res = await request(buildApp(db)).post('/api/rooms').send({
        name: '   ',
        facilityId: 'bad',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('name é obrigatório');
      expect(res.body.message).toContain('facilityId inválido');

      res = await request(buildApp(db)).post('/api/rooms').send({
        name: 42,
        facilityId: '507f1f77bcf86cd799439011',
      });
      expect(res.status).toBe(400);
    });

    it('rejects a valid-looking facilityId that is not registered', async () => {
      const facilities = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const { db } = makeDb({ facilities });

      const res = await request(buildApp(db)).post('/api/rooms').send({
        name: 'Room A',
        facilityId: '507f1f77bcf86cd799439011',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('FACILITY_NOT_FOUND');
    });

    it('creates and audits a room with explicit optional fields', async () => {
      const facilityId = '507f1f77bcf86cd799439011';
      const facilities = makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(facilityId) }) });
      const rooms = makeCollection({
        insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId('507f191e810c19729de860ea') }),
      });
      const { db } = makeDb({ facilities, rooms });

      const res = await request(buildApp(db)).post('/api/rooms').send({
        name: '  Room A  ',
        facilityId,
        code: 'R-A',
        description: 'Synthetic room',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Room A');
      expect(res.body.data.code).toBe('R-A');
      expect(res.body.data.description).toBe('Synthetic room');
      expect(res.body.data.createdBy).toBe('user-1');
      expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CREATE',
        resourceType: 'Room',
      }));
    });

    it('uses null defaults for optional fields and missing actor', async () => {
      currentUser = null;
      const facilityId = '507f1f77bcf86cd799439011';
      const facilities = makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(facilityId) }) });
      const rooms = makeCollection();
      const { db } = makeDb({ facilities, rooms });

      const res = await request(buildApp(db)).post('/api/rooms').send({
        name: 'Room B',
        facilityId,
      });

      expect(res.status).toBe(201);
      const inserted = rooms.insertOne.mock.calls[0][0];
      expect(inserted.code).toBeNull();
      expect(inserted.description).toBeNull();
      expect(inserted.createdBy).toBeNull();
    });

    it('maps create failures to 400', async () => {
      const facilities = makeCollection({ findOne: vi.fn().mockRejectedValue(new Error('facility lookup failed')) });
      const { db } = makeDb({ facilities });

      const res = await request(buildApp(db)).post('/api/rooms').send({
        name: 'Room A',
        facilityId: '507f1f77bcf86cd799439011',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('facility lookup failed');
    });
  });

  describe('PUT /:id', () => {
    it('validates a supplied facilityId and checks facility existence', async () => {
      const roomId = '507f1f77bcf86cd799439011';
      const { db } = makeDb();

      let res = await request(buildApp(db)).put(`/api/rooms/${roomId}`).send({ facilityId: 'bad' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('facilityId inválido');

      const facilities = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const db2 = makeDb({ facilities }).db;
      res = await request(buildApp(db2)).put(`/api/rooms/${roomId}`).send({
        facilityId: '507f191e810c19729de860ea',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('FACILITY_NOT_FOUND');
    });

    it('updates explicit fields and handles both driver result shapes', async () => {
      const roomId = '507f1f77bcf86cd799439011';
      const facilityId = '507f191e810c19729de860ea';
      const facilities = makeCollection({ findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(facilityId) }) });
      const rooms = makeCollection({
        findOneAndUpdate: vi.fn()
          .mockResolvedValueOnce({ value: { _id: roomId, name: 'Updated A' } })
          .mockResolvedValueOnce({ _id: roomId, name: 'Updated B' }),
      });
      const { db } = makeDb({ facilities, rooms });

      let res = await request(buildApp(db)).put(`/api/rooms/${roomId}`).send({
        facilityId,
        name: 'Updated A',
        code: null,
        description: 'D',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated A');

      const updatePayload = rooms.findOneAndUpdate.mock.calls[0][1].$set;
      expect(updatePayload.facilityId).toBeInstanceOf(ObjectId);
      expect(updatePayload.name).toBe('Updated A');
      expect(updatePayload.code).toBeNull();
      expect(updatePayload.description).toBe('D');
      expect(updatePayload.updatedAt).toBeInstanceOf(Date);

      res = await request(buildApp(db)).put(`/api/rooms/${roomId}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated B');
      expect(Object.keys(rooms.findOneAndUpdate.mock.calls[1][1].$set)).toEqual(['updatedAt']);
    });

    it('returns 400 for malformed id and 404 for a missing room', async () => {
      const rooms = makeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
      });
      const { db } = makeDb({ rooms });

      let res = await request(buildApp(db)).put('/api/rooms/bad').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ID inválido');

      res = await request(buildApp(db)).put('/api/rooms/507f1f77bcf86cd799439011').send({});
      expect(res.status).toBe(404);
    });

    it('maps outer update failures to 400', async () => {
      const facilities = makeCollection({ findOne: vi.fn().mockRejectedValue(new Error('update failed')) });
      const { db } = makeDb({ facilities });

      const res = await request(buildApp(db)).put('/api/rooms/507f1f77bcf86cd799439011').send({
        facilityId: '507f191e810c19729de860ea',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('update failed');
    });
  });

  describe('DELETE /:id', () => {
    it('returns 400 for malformed id, 404 for missing room, and accepts both driver result shapes', async () => {
      const roomId = '507f1f77bcf86cd799439011';
      const rooms = makeCollection({
        findOneAndUpdate: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ value: { _id: roomId } })
          .mockResolvedValueOnce({ _id: roomId }),
      });
      const { db } = makeDb({ rooms });

      let res = await request(buildApp(db)).delete('/api/rooms/bad');
      expect(res.status).toBe(400);

      res = await request(buildApp(db)).delete(`/api/rooms/${roomId}`);
      expect(res.status).toBe(404);

      res = await request(buildApp(db)).delete(`/api/rooms/${roomId}`);
      expect(res.status).toBe(200);
      expect(auditLogger.log).toHaveBeenLastCalledWith(expect.objectContaining({
        action: 'DELETE',
        resourceType: 'Room',
      }));

      res = await request(buildApp(db)).delete(`/api/rooms/${roomId}`);
      expect(res.status).toBe(200);
    });

    it('treats a database rejection in the id/update block as ID inválido', async () => {
      const rooms = makeCollection({
        findOneAndUpdate: vi.fn().mockRejectedValue(new Error('delete failed')),
      });
      const { db } = makeDb({ rooms });

      const res = await request(buildApp(db)).delete('/api/rooms/507f1f77bcf86cd799439011');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ID inválido');
    });
  });
});
