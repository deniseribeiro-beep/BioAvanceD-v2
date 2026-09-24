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

    // #1178: this used to assert TWO lookups for '507f...', and the first was
    // the defect -- parseInt('507f...') is 507, so a numeric policyId lookup ran
    // before the _id one and could return an unrelated legacy policy. The
    // frontend now keys every policy call on _id, which made that reachable.
    it('#1178: an ObjectId-shaped id goes straight to the _id lookup, never a numeric policyId one', async () => {
      const objectId = '507f1f77bcf86cd799439011';
      const findOne = vi.fn().mockResolvedValueOnce({ _id: objectId });
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get(`/api/policies/${objectId}`);

      expect(res.status).toBe(200);
      expect(findOne).toHaveBeenCalledTimes(1);
      expect(findOne.mock.calls[0][0]).not.toHaveProperty('policyId');
      expect(findOne.mock.calls[0][0]._id.toString()).toBe(objectId);
    });

    it('#1178: /:id/active-limit also skips the numeric lookup for an ObjectId-shaped id', async () => {
      const objectId = '507f1f77bcf86cd799439011';
      const findOne = vi.fn().mockResolvedValueOnce({ _id: objectId, maxTemp: 8, minTemp: 2 });
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get(`/api/policies/${objectId}/active-limit`);

      expect(res.status).toBe(200);
      expect(findOne).toHaveBeenCalledTimes(1);
      expect(findOne.mock.calls[0][0]).not.toHaveProperty('policyId');
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
      const findOne = vi.fn().mockResolvedValue({ policyId: 1, maxTemp: 8, minTemp: 2, temperatureUnit: 'C' });
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies/1/active-limit').query({ type: 'max' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ limit: 8, type: 'max', unit: 'C' });
    });

    it('returns the min threshold by default and defaults unit to C', async () => {
      const findOne = vi.fn().mockResolvedValue({ policyId: 1, maxTemp: 8, minTemp: 2 });
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

    it('returns 422 when validation fails', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).post('/api/policies').send({});

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Dados inválidos');
    });

    it('returns 201 with the created policy on success', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).post('/api/policies').send({
        policyName: 'Freezer -20',
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
        policyName: 'Freezer -20',
        minThreshold: -20,
        maxThreshold: -10,
        targetTemperature: -15,
        temperatureUnit: '°C',
      });

      expect(res.status).toBe(400);
    });
  });

  // #1089: POST /api/policies wrote db.collection('policies'), while the
  // telemetry ingestion path (iot.controller#resolveTemperaturePolicy ->
  // TelemetryMonitor.js:233) resolves a sensor's thresholds out of
  // 'temperaturePolicies'. No code path joined the two, so a policy
  // created through this API was invisible to the sensors it was meant to
  // govern, and checkPolicyAndAlert's `if (!policy) return` made that
  // silent rather than an error.
  //
  // Direction 1 (the issue's own): temperaturePolicies survives, because
  // contracts/canonical/v1/index.js:232 maps it to dict-02 ThresholdProfile
  // and models/Policy.js is a temperature policy by its own docblock.
  // Dennis's calls 2026-09-22 -- Q4: the stored document takes the
  // canonical shape while the HTTP contract keeps its existing field
  // names, translated at the route boundary. Q1: the mandatory
  // profileName/name is sourced from a new caller-supplied policyName.
  describe("#1089: temperaturePolicies is the single store", () => {
    const validBody = {
      policyName: 'Freezer -80',
      minThreshold: -85,
      maxThreshold: -75,
      targetTemperature: -80,
      temperatureUnit: '\u00b0C',
      alertDelayMin: 5,
    };

    it('POST writes to temperaturePolicies, not policies', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).post('/api/policies').send(validBody);

      expect(res.status).toBe(201);
      expect(db.collection).toHaveBeenCalledWith('temperaturePolicies');
      expect(db.collection).not.toHaveBeenCalledWith('policies');
    });

    it('POST stores the canonical TemperaturePolicy shape', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      await request(app).post('/api/policies').send(validBody);

      const stored = insertOne.mock.calls[0][0];
      expect(stored.name).toBe('Freezer -80');
      expect(stored.minTemp).toBe(-85);
      expect(stored.maxTemp).toBe(-75);
      expect(stored.targetTemp).toBe(-80);
      expect(stored.metricType).toBe('temperature');
      expect(stored.ruleVersion).toBe('1.0.0');
      expect(stored.effectivePeriod.start).toBeInstanceOf(Date);
      // The legacy names must NOT survive into the canonical store --
      // that is what made the two collections diverge in the first place.
      expect(stored.minThreshold).toBeUndefined();
      expect(stored.maxThreshold).toBeUndefined();
      expect(stored.targetTemperature).toBeUndefined();
    });

    it('POST retains the non-canonical fields the HTTP contract still exposes', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      await request(app).post('/api/policies').send(validBody);

      // Q2/Q3 follow from Q4 rather than being separate calls: a GET still
      // returns these, so they have to round-trip through storage.
      // #1195: alertDelayMin is not one of them any more -- it is dict-02's
      // minimumDuration under its HTTP name (see the #1195 block below).
      const stored = insertOne.mock.calls[0][0];
      expect(stored.temperatureUnit).toBe('\u00b0C');
    });

    it('POST answers the caller in the legacy HTTP shape', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).post('/api/policies').send(validBody);

      expect(res.body.data.minThreshold).toBe(-85);
      expect(res.body.data.maxThreshold).toBe(-75);
      expect(res.body.data.targetTemperature).toBe(-80);
      expect(res.body.data.policyName).toBe('Freezer -80');
    });

    it('POST 422s without policyName, which the canonical shape requires', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const { policyName, ...withoutName } = validBody;
      const res = await request(app).post('/api/policies').send(withoutName);

      expect(res.status).toBe(422);
    });

    it('GET / reads temperaturePolicies and answers in the legacy shape', async () => {
      const toArray = vi.fn().mockResolvedValue([
        { _id: 'p1', name: 'Freezer -80', minTemp: -85, maxTemp: -75, targetTemp: -80 },
      ]);
      const find = vi.fn().mockReturnValue({ toArray });
      const db = { collection: vi.fn().mockReturnValue({ find }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies');

      expect(res.status).toBe(200);
      expect(db.collection).toHaveBeenCalledWith('temperaturePolicies');
      expect(res.body.data[0].minThreshold).toBe(-85);
      expect(res.body.data[0].maxThreshold).toBe(-75);
      expect(res.body.data[0].policyName).toBe('Freezer -80');
    });
  });

  // #1195: the form's "Atraso de Alerta" was stored as alertDelayMin, which
  // nothing reads, while TelemetryMonitor reads minimumDuration (dict-02
  // P1X-0110, minutes), which POST hard-coded to null. The operator's value
  // was never enforced. The HTTP name now lands on the canonical field.
  describe('#1195: alertDelayMin is minimumDuration at the boundary', () => {
    const body = {
      policyName: 'Freezer -80',
      minThreshold: -85,
      maxThreshold: -75,
      targetTemperature: -80,
    };

    it('POST stores alertDelayMin as minimumDuration, not as an extension', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      await request(app).post('/api/policies').send({ ...body, alertDelayMin: 30 });

      const stored = insertOne.mock.calls[0][0];
      expect(stored.minimumDuration).toBe(30);
      expect(stored).not.toHaveProperty('alertDelayMin');
    });

    it('POST without alertDelayMin keeps minimumDuration null, the global fallback', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      await request(app).post('/api/policies').send(body);

      const stored = insertOne.mock.calls[0][0];
      expect(stored.minimumDuration).toBeNull();
      expect(stored).not.toHaveProperty('alertDelayMin');
    });

    it('PUT sets alertDelayMin on minimumDuration', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app)
        .put('/api/policies/507f1f77bcf86cd799439011')
        .send({ alertDelayMin: 45 });

      expect(res.status).toBe(200);
      const setArg = updateOne.mock.calls[0][1].$set;
      expect(Object.keys(setArg).sort()).toEqual(['minimumDuration', 'updatedAt']);
      expect(setArg.minimumDuration).toBe(45);
    });

    it('GET reports alertDelayMin from minimumDuration, the value actually enforced', async () => {
      const toArray = vi.fn().mockResolvedValue([
        { _id: 'p1', name: 'A', minTemp: -85, maxTemp: -75, targetTemp: -80, minimumDuration: 30 },
        // Written before #1195: the stored extension was never enforced.
        { _id: 'p2', name: 'B', minTemp: -85, maxTemp: -75, targetTemp: -80, minimumDuration: null, alertDelayMin: 5 },
      ]);
      const find = vi.fn().mockReturnValue({ toArray });
      const db = { collection: vi.fn().mockReturnValue({ find }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies');

      expect(res.status).toBe(200);
      expect(res.body.data[0].alertDelayMin).toBe(30);
      expect(res.body.data[1].alertDelayMin).toBeNull();
      expect(res.body.data[0]).not.toHaveProperty('minimumDuration');
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
    // fields. Only the request's allowlisted fields (minus policyId/policyID,
    // which are business identity) may reach $set.
    //
    // #1089: the allowlist became a map, so the KEY a caller sends and the
    // PATH it lands on differ. #875's invariant is unchanged and is what
    // the last three assertions still check -- only the landing names move.
    it('#875: filters $set to the allowlist, dropping injected/identity keys', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app)
        .put('/api/policies/507f1f77bcf86cd799439011')
        .send({ minThreshold: 1, injected: 'x', policyId: 999 });

      expect(res.status).toBe(200);
      const setArg = updateOne.mock.calls[0][1].$set;
      expect(setArg).toHaveProperty('minTemp', 1);
      expect(setArg).toHaveProperty('updatedAt');
      expect(setArg).not.toHaveProperty('injected');
      expect(setArg).not.toHaveProperty('policyId');
      // Still absent under its own name, not merely renamed past the check.
      expect(setArg).not.toHaveProperty('minThreshold');
      expect(Object.keys(setArg).sort()).toEqual(['minTemp', 'updatedAt']);
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
