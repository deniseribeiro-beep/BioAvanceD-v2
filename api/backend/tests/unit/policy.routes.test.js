import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/interface/routes/policy.routes.js');

const allPaths = [authPath, rbacPath, routePath];

function clearCache() {
  for (const p of allPaths) delete require.cache[p];
}

function loadRoute() {
  clearCache();

  const authModule = require(authPath);
  authModule.authenticate = (req, res, next) => {
    req.user = { id: 'user-1', roleName: 'Administrador' };
    next();
  };

  const rbacModule = require(rbacPath);
  rbacModule.requirePermission = () => (req, res, next) => next();

  const router = require(routePath);
  return { router };
}

function buildApp(router, db = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/policies', router);
  return app;
}

describe('policy.routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCache();
  });

  describe('GET /', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/policies');

      expect(res.status).toBe(503);
    });

    it('returns 200 with all policies', async () => {
      const toArray = vi.fn().mockResolvedValue([{ policyId: 1 }]);
      const find = vi.fn().mockReturnValue({ toArray });
      const db = { collection: vi.fn().mockReturnValue({ find }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ policyId: 1 }]);
    });

    it('returns 500 when the query throws', async () => {
      const toArray = vi.fn().mockRejectedValue(new Error('db down'));
      const find = vi.fn().mockReturnValue({ toArray });
      const db = { collection: vi.fn().mockReturnValue({ find }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /:id', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/policies/1');

      expect(res.status).toBe(503);
    });

    it('finds by numeric policyId', async () => {
      const findOne = vi.fn().mockResolvedValue({ policyId: 5 });
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies/5');

      expect(res.status).toBe(200);
      expect(findOne).toHaveBeenCalledWith({ policyId: 5 });
      expect(res.body.data).toEqual({ policyId: 5 });
    });

    it('falls back to ObjectId lookup when not a numeric match', async () => {
      const objectId = '507f1f77bcf86cd799439011';
      const findOne = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: objectId });
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get(`/api/policies/${objectId}`);

      expect(res.status).toBe(200);
      expect(findOne).toHaveBeenCalledTimes(2);
    });

    it('returns 404 when no policy matches by id or objectId', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies/not-an-id');

      expect(res.status).toBe(404);
    });

    it('returns 500 when the query throws', async () => {
      const findOne = vi.fn().mockRejectedValue(new Error('db down'));
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies/5');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /:id/active-limit', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).get('/api/policies/1/active-limit');

      expect(res.status).toBe(503);
    });

    it('returns 404 when the policy is not found', async () => {
      const findOne = vi.fn().mockResolvedValue(null);
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies/not-an-id/active-limit');

      expect(res.status).toBe(404);
    });

    it('returns the max threshold when type=max', async () => {
      const findOne = vi.fn().mockResolvedValue({ policyId: 1, maxThreshold: 8, minThreshold: 2, temperatureUnit: 'C' });
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies/1/active-limit').query({ type: 'max' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ limit: 8, type: 'max', unit: 'C' });
    });

    it('returns the min threshold by default and defaults unit to C', async () => {
      const findOne = vi.fn().mockResolvedValue({ policyId: 1, maxThreshold: 8, minThreshold: 2 });
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies/1/active-limit');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ limit: 2, type: 'min', unit: 'C' });
    });

    it('returns 500 when the query throws', async () => {
      const findOne = vi.fn().mockRejectedValue(new Error('db down'));
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies/1/active-limit');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).post('/api/policies').send({});

      expect(res.status).toBe(503);
    });

    it('returns 400 when validation fails', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).post('/api/policies').send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Dados inválidos');
    });

    it('returns 201 with the created policy on success', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).post('/api/policies').send({
        minThreshold: -20,
        maxThreshold: -10,
        targetTemperature: -15,
        temperatureUnit: '°C',
      });

      expect(res.status).toBe(201);
      expect(res.body.data._id).toBe('new-id');
      expect(insertOne).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when the insert throws', async () => {
      const insertOne = vi.fn().mockRejectedValue(new Error('insert failed'));
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).post('/api/policies').send({
        minThreshold: -20,
        maxThreshold: -10,
        targetTemperature: -15,
        temperatureUnit: '°C',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /:id', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).put('/api/policies/507f1f77bcf86cd799439011').send({});

      expect(res.status).toBe(503);
    });

    it('returns 404 when the policy does not exist', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).put('/api/policies/507f1f77bcf86cd799439011').send({ minThreshold: 1 });

      expect(res.status).toBe(404);
    });

    it('returns 200 on success', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).put('/api/policies/507f1f77bcf86cd799439011').send({ minThreshold: 1 });

      expect(res.status).toBe(200);
    });

    it('returns 400 when the update throws (e.g. invalid ObjectId)', async () => {
      const db = { collection: vi.fn().mockReturnValue({ updateOne: vi.fn() }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).put('/api/policies/not-an-id').send({ minThreshold: 1 });

      expect(res.status).toBe(400);
    });

    // #875: PUT /:id used to $set req.body verbatim -- an unfiltered or
    // under-filtered body could inject arbitrary keys or overwrite identity
    // fields. Only PolicyModel.create()'s own fields (minus policyId/policyID,
    // which are business identity) may reach $set.
    it('#875: filters $set to the PolicyModel allowlist, dropping injected/identity keys', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app)
        .put('/api/policies/507f1f77bcf86cd799439011')
        .send({ minThreshold: 1, injected: 'x', policyId: 999 });

      expect(res.status).toBe(200);
      const setArg = updateOne.mock.calls[0][1].$set;
      expect(setArg).toHaveProperty('minThreshold', 1);
      expect(setArg).toHaveProperty('updatedAt');
      expect(setArg).not.toHaveProperty('injected');
      expect(setArg).not.toHaveProperty('policyId');
      expect(Object.keys(setArg).sort()).toEqual(['minThreshold', 'updatedAt']);
    });
  });

  describe('DELETE /:id', () => {
    it('returns 503 when db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, null);

      const res = await request(app).delete('/api/policies/507f1f77bcf86cd799439011');

      expect(res.status).toBe(503);
    });

    it('returns 404 when nothing was deleted', async () => {
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 0 });
      const db = { collection: vi.fn().mockReturnValue({ deleteOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).delete('/api/policies/507f1f77bcf86cd799439011');

      expect(res.status).toBe(404);
    });

    it('returns 200 on success', async () => {
      const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ deleteOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).delete('/api/policies/507f1f77bcf86cd799439011');

      expect(res.status).toBe(200);
    });

    it('returns 400 when the delete throws (e.g. invalid ObjectId)', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).delete('/api/policies/not-an-id');

      expect(res.status).toBe(400);
    });
  });
});
