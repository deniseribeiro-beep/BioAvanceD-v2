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
        name: 'Freezer -20',
        minTemp: -20,
        maxTemp: -10,
        targetTemp: -15,
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
        name: 'Freezer -20',
        minTemp: -20,
        maxTemp: -10,
        targetTemp: -15,
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
  // silent rather than an error. temperaturePolicies survives, because
  // contracts/canonical/v1/index.js:232 maps it to dict-02 ThresholdProfile.
  describe("#1089: temperaturePolicies is the single store", () => {
    const validBody = {
      name: 'Freezer -80',
      minTemp: -85,
      maxTemp: -75,
      targetTemp: -80,
      temperatureUnit: '°C',
      minimumDuration: 5,
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
      expect(stored.temperatureUnit).toBe('°C');
      expect(stored.metricType).toBe('temperature');
      expect(stored.ruleVersion).toBe('1.0.0');
      expect(stored.effectivePeriod.start).toBeInstanceOf(Date);
      expect(stored.effectivePeriod.end).toBeNull();
    });

    it('POST 422s without name, which the canonical shape requires', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const { name, ...withoutName } = validBody;
      const res = await request(app).post('/api/policies').send(withoutName);

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('name é obrigatório e deve ser string não vazia');
    });

    it('GET / reads temperaturePolicies', async () => {
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
    });
  });

  // #1139: #1089 kept the HTTP contract on legacy names (minThreshold,
  // policyName, validFrom, alertDelayMin, ...) behind a request mapper, a
  // response mapper and a key->path allowlist map. That layer is gone: the
  // request and the response ARE the stored document.
  describe('#1139: the HTTP contract is the stored shape, untranslated', () => {
    const body = {
      name: 'Freezer -80',
      minTemp: -85,
      maxTemp: -75,
      targetTemp: -80,
      hysteresis: 1,
      minimumDuration: 30,
      temperatureUnit: '°C',
      effectivePeriod: { start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z' },
    };

    it('POST stores every request field under its own name', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      await request(app).post('/api/policies').send(body);

      const stored = insertOne.mock.calls[0][0];
      for (const field of ['name', 'minTemp', 'maxTemp', 'targetTemp', 'hysteresis', 'minimumDuration', 'temperatureUnit']) {
        expect(stored[field]).toBe(body[field]);
      }
      expect(stored.effectivePeriod.start.toISOString()).toBe(body.effectivePeriod.start);
      expect(stored.effectivePeriod.end.toISOString()).toBe(body.effectivePeriod.end);
    });

    it('POST answers with the stored document', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).post('/api/policies').send(body);

      const stored = insertOne.mock.calls[0][0];
      expect(res.body.data).toEqual(JSON.parse(JSON.stringify({ _id: 'new-id', ...stored })));
    });

    it('GET returns stored documents as they are', async () => {
      const doc = { _id: 'p1', name: 'A', minTemp: -85, maxTemp: -75, targetTemp: -80, minimumDuration: 30 };
      const toArray = vi.fn().mockResolvedValue([doc]);
      const find = vi.fn().mockReturnValue({ toArray });
      const db = { collection: vi.fn().mockReturnValue({ find }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).get('/api/policies');

      expect(res.body.data).toEqual([doc]);
    });

    it('POST ignores the retired legacy names rather than translating them', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).post('/api/policies').send({
        policyName: 'Freezer -80',
        minThreshold: -85,
        maxThreshold: -75,
        targetTemperature: -80,
      });

      expect(res.status).toBe(422);
    });

    // Ported from the deleted models/Policy.js test block: the checks it
    // made on the request shape now live in the route's own validator.
    it('POST 422s on inverted limits, a non-number target and an unknown unit', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, {});

      const res = await request(app).post('/api/policies').send({
        name: 'Geladeira 2-8',
        minTemp: 8,
        maxTemp: 2,
        targetTemp: '5',
        temperatureUnit: 'K',
      });

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('minTemp deve ser menor que maxTemp');
      expect(res.body.message).toContain('targetTemp é obrigatório e deve ser number');
      expect(res.body.message).toContain('temperatureUnit deve ser °C');
    });

    // #1195: omitted stays null, which TelemetryMonitor reads as "fall back
    // to the global threshold".
    it('POST without minimumDuration stores null, the global fallback', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const { minimumDuration, ...withoutDuration } = body;
      await request(app).post('/api/policies').send(withoutDuration);

      expect(insertOne.mock.calls[0][0].minimumDuration).toBeNull();
    });

    it('PUT sets each allowlisted field on its own path', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).put('/api/policies/507f1f77bcf86cd799439011').send(body);

      expect(res.status).toBe(200);
      const setArg = updateOne.mock.calls[0][1].$set;
      expect(Object.keys(setArg).sort()).toEqual([
        'effectivePeriod.end',
        'effectivePeriod.start',
        'hysteresis',
        'maxTemp',
        'minTemp',
        'minimumDuration',
        'name',
        'targetTemp',
        'temperatureUnit',
        'updatedAt',
      ]);
      expect(setArg['effectivePeriod.start']).toBeInstanceOf(Date);
    });

    it('PUT with only effectivePeriod.end leaves the stored start alone', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      await request(app)
        .put('/api/policies/507f1f77bcf86cd799439011')
        .send({ effectivePeriod: { end: null } });

      const setArg = updateOne.mock.calls[0][1].$set;
      expect(Object.keys(setArg).sort()).toEqual(['effectivePeriod.end', 'updatedAt']);
      expect(setArg['effectivePeriod.end']).toBeNull();
    });
  });

  // #1198: the form offered degF and K, and nothing that enforces a policy
  // reads its unit -- iot.controller compares the reading's bare number with
  // minTemp/maxTemp. A degF policy was stored and enforced as if it were degC.
  describe('#1198: a policy is Celsius, the unit its enforcement assumes', () => {
    const body = {
      name: 'Geladeira 2-8',
      minTemp: 35.6,
      maxTemp: 46.4,
      targetTemp: 41,
    };

    it('POST 422s on °F rather than storing limits enforcement would misread', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).post('/api/policies').send({ ...body, temperatureUnit: '°F' });

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('temperatureUnit deve ser °C');
      expect(insertOne).not.toHaveBeenCalled();
    });

    it('PUT 422s on °F and writes nothing', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app)
        .put('/api/policies/507f1f77bcf86cd799439011')
        .send({ temperatureUnit: '°F' });

      expect(res.status).toBe(422);
      expect(updateOne).not.toHaveBeenCalled();
    });

    // CONTROLS: Celsius is accepted before and after the fix.
    it('CONTROL: POST accepts °C', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: 'new-id' });
      const db = { collection: vi.fn().mockReturnValue({ insertOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).post('/api/policies').send({ ...body, temperatureUnit: '°C' });

      expect(res.status).toBe(201);
    });

    it('CONTROL: PUT accepts °C', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app)
        .put('/api/policies/507f1f77bcf86cd799439011')
        .send({ temperatureUnit: '°C' });

      expect(res.status).toBe(200);
      expect(updateOne.mock.calls[0][1].$set.temperatureUnit).toBe('°C');
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

      const res = await request(app).put('/api/policies/507f1f77bcf86cd799439011').send({ minTemp: 1 });

      expect(res.status).toBe(404);
    });

    it('returns 200 on success', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).put('/api/policies/507f1f77bcf86cd799439011').send({ minTemp: 1 });

      expect(res.status).toBe(200);
    });

    it('returns 400 when the update throws (e.g. invalid ObjectId)', async () => {
      const db = { collection: vi.fn().mockReturnValue({ updateOne: vi.fn() }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app).put('/api/policies/not-an-id').send({ minTemp: 1 });

      expect(res.status).toBe(400);
    });

    // #875: PUT /:id used to $set req.body verbatim -- an unfiltered or
    // under-filtered body could inject arbitrary keys or overwrite identity
    // fields. Only the allowlisted fields may reach $set; policyId/policyID
    // are business identity and never do.
    it('#875: filters $set to the allowlist, dropping injected/identity keys', async () => {
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const { router } = loadRoute();
      const app = buildApp(router, db);

      const res = await request(app)
        .put('/api/policies/507f1f77bcf86cd799439011')
        .send({ minTemp: 1, minThreshold: 2, injected: 'x', policyId: 999 });

      expect(res.status).toBe(200);
      const setArg = updateOne.mock.calls[0][1].$set;
      expect(setArg).toHaveProperty('minTemp', 1);
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
