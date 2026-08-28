import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const { createMatchingCollection, createFilterCaptureStore } = require('../factories/filter.factory');

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/interface/routes/storage.routes.js');

// Same one-time-require pattern as sample.routes.test.js: storage.routes.js
// destructures `{ authenticate }`/`{ requirePermission }` at require-time,
// so re-requiring the route file fresh per test would freeze whatever
// implementation was current at first require and undercount branch
// coverage on reruns. Instead: require every dependency and the route
// itself exactly ONCE, and give each mockable seam a stable proxy that
// reads a mutable `current*` closure variable.
let currentAuth = defaultAuth;
let currentRequirePermission = () => (req, res, next) => next();

function defaultAuth(req, res, next) {
  req.user = { id: 'user-1', name: 'Tester', roleName: 'Administrador' };
  req.t = (key) => key;
  next();
}

function unauthenticated(req, res) {
  // Mirrors the real authenticate middleware's no-token branch (401,
  // no req.user, next() never called) without requiring a real JWT.
  return res.status(401).json({
    success: false,
    error: 'Token não fornecido',
    message: 'É necessário fazer login para acessar este recurso'
  });
}

const authModule = require(authPath);
authModule.authenticate = (req, res, next) => currentAuth(req, res, next);

const rbacModule = require(rbacPath);
rbacModule.requirePermission = (...args) => currentRequirePermission(...args);

// Required exactly once - see comment above.
const router = require(routePath);

function loadRoute({ authImpl, requirePermissionImpl } = {}) {
  currentAuth = authImpl || defaultAuth;
  currentRequirePermission = requirePermissionImpl || (() => (req, res, next) => next());
  return { router };
}

function buildApp(router, db = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/storage', router);
  return app;
}

describe('storage.routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /freezers', () => {
    it('returns only OPERATIONAL FREEZER containers, filtered by the real query (issue #856)', async () => {
      const { router } = loadRoute();
      const { capturedFilters } = createFilterCaptureStore();
      const collection = createMatchingCollection(
        [
          { _id: 'f1', containerID: 1, name: 'Ultra-Freezer 01', containerType: 'FREEZER', status: 'OPERATIONAL', temperature: -80 },
          // Same containerType, wrong status - must NOT appear in the response.
          { _id: 'f2', containerID: 2, name: 'Freezer em Manutenção', containerType: 'FREEZER', status: 'MAINTENANCE' },
          // Right status, wrong containerType - must NOT appear either.
          { _id: 'f3', containerID: 3, name: 'Rack A', containerType: 'RACK', status: 'OPERATIONAL' },
        ],
        { capturedFilters, key: 'storageContainers' }
      );
      const app = buildApp(router, { collection: (name) => (name === 'storageContainers' ? collection : null) });

      const res = await request(app).get('/api/storage/freezers');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.map((d) => d._id)).toEqual(['f1']);
      // Asserts the filter itself, not just the outcome - a mock that
      // answered regardless of the filter (the #843/#847/etc. failure
      // mode this factory exists to catch) would still pass the line
      // above by accident if the seed only had one matching document.
      expect(capturedFilters.storageContainers).toEqual({
        containerType: 'FREEZER',
        status: 'OPERATIONAL',
      });
    });

    it('rejects an unauthenticated request with 401 before touching the database (issue #856)', async () => {
      const { router } = loadRoute({ authImpl: unauthenticated });
      const collection = createMatchingCollection([
        { _id: 'f1', containerType: 'FREEZER', status: 'OPERATIONAL' },
      ]);
      const app = buildApp(router, { collection: () => collection });

      const res = await request(app).get('/api/storage/freezers');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(collection.find).not.toHaveBeenCalled();
    });

    // GET /freezers takes no request input (no params, query, or body) to
    // validate, so there is no genuine "validation rejection" case for it -
    // per the brief's own allowance, this substitutes the route's other
    // real rejection path: an unusable db still yields a clean error
    // response rather than an unhandled exception.
    it('returns 500 rather than throwing when app.locals.db is unavailable', async () => {
      const { router } = loadRoute();
      const app = buildApp(router, undefined);

      const res = await request(app).get('/api/storage/freezers');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /box/:boxId/available', () => {
    it('returns available/occupied positions computed from the box document (issue #856)', async () => {
      const { router } = loadRoute();
      const collection = createMatchingCollection([
        {
          _id: 'box1',
          name: 'Box A1-01',
          dimension: { rows: 2, cols: 2 },
          currentOccupancy: 1,
          occupancyGrid: { A1: 'sample-1' },
        },
      ]);
      const app = buildApp(router, { collection: (name) => (name === 'storageBoxes' ? collection : null) });

      const res = await request(app).get('/api/storage/box/box1/available');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.availablePositions).toEqual(['A2', 'B1', 'B2']);
      expect(res.body.data.occupiedPositions).toEqual(['A1']);
      expect(res.body.data.stats).toEqual({
        capacity: 4,
        occupied: 1,
        available: 3,
        occupancyPercent: 25,
      });
    });

    it('rejects an unauthenticated request with 401 before touching the database (issue #856)', async () => {
      const { router } = loadRoute({ authImpl: unauthenticated });
      const collection = createMatchingCollection([
        { _id: 'box1', dimension: { rows: 1, cols: 1 }, occupancyGrid: {} },
      ]);
      const app = buildApp(router, { collection: () => collection });

      const res = await request(app).get('/api/storage/box/box1/available');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(collection.findOne).not.toHaveBeenCalled();
    });

    it('returns 404 when no box matches the given boxId (issue #856)', async () => {
      const { router } = loadRoute();
      const collection = createMatchingCollection([
        { _id: 'box1', dimension: { rows: 1, cols: 1 }, occupancyGrid: {} },
      ]);
      const app = buildApp(router, { collection: (name) => (name === 'storageBoxes' ? collection : null) });

      const res = await request(app).get('/api/storage/box/does-not-exist/available');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('não encontrada');
    });
  });
});
