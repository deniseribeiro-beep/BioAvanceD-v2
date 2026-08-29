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
// #859: same proxy pattern as requirePermission above -- storage.routes.js
// destructures requireRole at require-time, so the seam has to exist before
// the single require() below.
let currentRequireRole = () => (req, res, next) => next();

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
// The middleware FACTORY runs once, at route-registration time, so a
// proxy of the form `(...args) => currentRequireRole(...args)` would
// capture whatever implementation was current at module load and ignore
// every later swap. Returning a stable middleware that dispatches through
// the closure variable per REQUEST is what makes the seam actually
// swappable. (requirePermission above has the same shape and the same
// latent limitation; not changed here, since no test currently swaps it
// after load.)
rbacModule.requireRole = (...args) => (req, res, next) =>
  currentRequireRole(...args)(req, res, next);

// Required exactly once - see comment above.
const router = require(routePath);

function loadRoute({ authImpl, requirePermissionImpl, requireRoleImpl } = {}) {
  currentAuth = authImpl || defaultAuth;
  currentRequirePermission = requirePermissionImpl || (() => (req, res, next) => next());
  currentRequireRole = requireRoleImpl || (() => (req, res, next) => next());
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

  describe('GET /samples/search', () => {
    it('sends the real $and/$or/$in/$exists filter to the samples collection (issue #856)', async () => {
      const { router } = loadRoute();
      const { capturedFilters } = createFilterCaptureStore();
      // The mock's matcher does not evaluate `$regex` (see filter.factory's
      // own doc comment), so a document seeded here can never actually
      // surface in the response body no matter how well it matches the
      // search term -- the repository always builds `new RegExp(term, 'i')`
      // conditions for barcode/participantId/specimenId, and the matcher
      // compares document values against the *stringified* RegExp instead
      // of testing them. That is exactly why the filter itself, not the
      // returned array, is the assertion that can actually catch a
      // regression here.
      const samples = createMatchingCollection(
        [
          { _id: 's-decoy', barcode: 'BR-2025-002', participantId: 'PARTICIPANT-2', specimenId: 'SPEC-2', specimenStatus: 'available', storageLocation: { boxId: 'box1' } },
          { _id: 's1', barcode: 'BR-2025-001', participantId: 'PARTICIPANT-1', specimenId: 'SPEC-1', specimenStatus: 'available' },
        ],
        { capturedFilters, key: 'samples' }
      );
      const patients = createMatchingCollection([]);
      const consents = createMatchingCollection([]);
      const app = buildApp(router, {
        collection: (name) => {
          if (name === 'samples') return samples;
          if (name === 'patients') return patients;
          if (name === 'patientConsents') return consents;
          return null;
        },
      });

      const res = await request(app).get('/api/storage/samples/search?q=BR2025');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(capturedFilters.samples).toEqual({
        $and: [
          {
            $or: [
              { barcode: expect.any(RegExp) },
              { participantId: expect.any(RegExp) },
              { specimenId: expect.any(RegExp) },
            ],
          },
          { specimenStatus: { $in: ['available', 'reserved'] } },
          {
            $or: [
              { 'storageLocation.boxId': { $exists: false } },
              { 'storageLocation.boxId': null },
            ],
          },
        ],
      });
    });

    it('returns 200 with an empty array and never touches the samples collection for a sub-2-character query', async () => {
      const { router } = loadRoute();
      const samples = createMatchingCollection([
        { _id: 's1', barcode: 'BR-2025-001', specimenStatus: 'available' },
      ]);
      const app = buildApp(router, {
        collection: (name) => (name === 'samples' ? samples : null),
      });

      const res = await request(app).get('/api/storage/samples/search');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(samples.find).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated request with 401 before touching the database', async () => {
      const { router } = loadRoute({ authImpl: unauthenticated });
      const samples = createMatchingCollection([
        { _id: 's1', barcode: 'BR-2025-001', specimenStatus: 'available' },
      ]);
      const app = buildApp(router, { collection: () => samples });

      const res = await request(app).get('/api/storage/samples/search?q=BR2025');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(samples.find).not.toHaveBeenCalled();
    });
  });

  describe('GET /sample/:sampleId', () => {
    it('resolves barcode, box and path/fullHierarchy for a sample looked up by id', async () => {
      const { router } = loadRoute();
      const samples = createMatchingCollection([
        // Same shape, different _id -- proves the lookup is keyed by _id
        // rather than "whichever document was seeded first".
        { _id: 'sample-decoy', barcode: 'BR-DECOY', storageLocation: { boxId: 'box1', boxName: 'Box A1-01', position: 'A1' } },
        { _id: 'sample1', barcode: 'BR-2025-001', storageLocation: { boxId: 'box1', boxName: 'Box A1-01', position: 'A1' } },
      ]);
      const storagePaths = createMatchingCollection([
        { boxId: 'box1', path: 'Freezer 1/Shelf 1/Rack A/Box A1-01', freezerId: 'freezer1', shelfId: 'shelf1', rackId: 'rack1' },
      ]);
      const app = buildApp(router, {
        collection: (name) => (name === 'samples' ? samples : name === 'storagePaths' ? storagePaths : null),
      });

      const res = await request(app).get('/api/storage/sample/sample1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.specimenId).toBe('sample1');
      expect(res.body.data.barcode).toBe('BR-2025-001');
      expect(res.body.data.box).toEqual({ boxId: 'box1', boxName: 'Box A1-01', position: 'A1' });
      expect(res.body.data.path).toBe('Freezer 1/Shelf 1/Rack A/Box A1-01');
      expect(res.body.data.fullHierarchy).toEqual({
        freezerId: 'freezer1',
        shelfId: 'shelf1',
        rackId: 'rack1',
        boxId: 'box1',
      });
    });

    it('returns 404 SAMPLE_NOT_FOUND when no sample matches the given sampleId', async () => {
      const { router } = loadRoute();
      const samples = createMatchingCollection([
        { _id: 'sample1', storageLocation: { boxId: 'box1', position: 'A1' } },
      ]);
      const app = buildApp(router, { collection: (name) => (name === 'samples' ? samples : null) });

      const res = await request(app).get('/api/storage/sample/does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('SAMPLE_NOT_FOUND');
    });

    it('rejects an unauthenticated request with 401 before touching the database', async () => {
      const { router } = loadRoute({ authImpl: unauthenticated });
      const samples = createMatchingCollection([
        { _id: 'sample1', storageLocation: { boxId: 'box1', position: 'A1' } },
      ]);
      const app = buildApp(router, { collection: () => samples });

      const res = await request(app).get('/api/storage/sample/sample1');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(samples.findOne).not.toHaveBeenCalled();
    });
  });

  describe('GET /validate/:boxId/:position', () => {
    it('reports an unoccupied position as available with box occupancy data', async () => {
      const { router } = loadRoute();
      const storageBoxes = createMatchingCollection([
        { _id: 'box1', status: 'ACTIVE', name: 'Box A1-01', dimension: { rows: 2, cols: 2 }, occupancyGrid: {}, currentOccupancy: 0 },
      ]);
      const storagePaths = createMatchingCollection([]);
      const app = buildApp(router, {
        collection: (name) => (name === 'storageBoxes' ? storageBoxes : name === 'storagePaths' ? storagePaths : null),
      });

      const res = await request(app).get('/api/storage/validate/box1/A1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.available).toBe(true);
      expect(res.body.boxData).toEqual({
        boxId: 'box1',
        boxName: 'Box A1-01',
        dimension: { rows: 2, cols: 2 },
        currentOccupancy: 0,
        capacity: 4,
        availablePositions: 4,
      });
    });

    // Survey claim under test: this answers 409, not 400, when the position
    // is already occupied -- ValidateStoragePositionUseCase's controller
    // maps every `!available` outcome (collision, bad format, out of
    // bounds, box not found) to 409, not just the collision case.
    it('answers 409 (not 400) with STORAGE_COLLISION when the position is already occupied', async () => {
      const { router } = loadRoute();
      const storageBoxes = createMatchingCollection([
        { _id: 'box1', status: 'ACTIVE', name: 'Box A1-01', dimension: { rows: 2, cols: 2 }, occupancyGrid: { A1: 'sample-occupant' }, currentOccupancy: 1 },
      ]);
      const storagePaths = createMatchingCollection([]);
      const app = buildApp(router, {
        collection: (name) => (name === 'storageBoxes' ? storageBoxes : name === 'storagePaths' ? storagePaths : null),
      });

      const res = await request(app).get('/api/storage/validate/box1/A1');

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.available).toBe(false);
      expect(res.body.error).toBe('STORAGE_COLLISION');
      expect(res.body.occupiedBySampleId).toBe('sample-occupant');
    });

    it('rejects an unauthenticated request with 401 before touching the database', async () => {
      const { router } = loadRoute({ authImpl: unauthenticated });
      const storageBoxes = createMatchingCollection([
        { _id: 'box1', status: 'ACTIVE', dimension: { rows: 1, cols: 1 }, occupancyGrid: {} },
      ]);
      const app = buildApp(router, { collection: () => storageBoxes });

      const res = await request(app).get('/api/storage/validate/box1/A1');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(storageBoxes.findOne).not.toHaveBeenCalled();
    });
  });

  describe('GET /freezer/:freezerId/stats', () => {
    it('returns rack occupancy stats, filtered on _id + containerType (issue #856)', async () => {
      const { router } = loadRoute();
      const { capturedFilters } = createFilterCaptureStore();
      const storageContainers = createMatchingCollection(
        [
          // Same _id, wrong containerType -- must not be the container this
          // resolves to. docs.find() picks the first match in array order,
          // so if containerType were dropped from the filter this decoy
          // (seeded first) would answer instead and leak its name below.
          { _id: 'freezer1', containerType: 'RACK', name: 'Wrong Type Container' },
          { _id: 'freezer1', containerType: 'FREEZER', name: 'Freezer 1', temperature: -80 },
        ],
        { capturedFilters, key: 'freezerStats' }
      );
      const storageBoxes = { aggregate: vi.fn().mockReturnValue({ toArray: async () => [] }) };
      const app = buildApp(router, {
        collection: (name) => (name === 'storageContainers' ? storageContainers : name === 'storageBoxes' ? storageBoxes : null),
      });

      const res = await request(app).get('/api/storage/freezer/freezer1/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.freezerName).toBe('Freezer 1');
      expect(res.body.data.rackStats).toEqual([]);
      expect(res.body.data.aggregate).toEqual({
        totalCapacity: 0,
        totalOccupied: 0,
        totalAvailable: 0,
        occupancyPercent: 0,
      });
      expect(capturedFilters.freezerStats).toEqual({ _id: 'freezer1', containerType: 'FREEZER' });
    });

    // Survey claim under test: 404 when the id matches a container that
    // exists but is not a FREEZER.
    it('returns 404 FREEZER_NOT_FOUND when the id matches a non-FREEZER container', async () => {
      const { router } = loadRoute();
      const storageContainers = createMatchingCollection([
        { _id: 'rack-only', containerType: 'RACK', name: 'Just a rack' },
      ]);
      const storageBoxes = { aggregate: vi.fn() };
      const app = buildApp(router, {
        collection: (name) => (name === 'storageContainers' ? storageContainers : name === 'storageBoxes' ? storageBoxes : null),
      });

      const res = await request(app).get('/api/storage/freezer/rack-only/stats');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('FREEZER_NOT_FOUND');
      expect(storageBoxes.aggregate).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated request with 401 before touching the database', async () => {
      const { router } = loadRoute({ authImpl: unauthenticated });
      const storageContainers = createMatchingCollection([
        { _id: 'freezer1', containerType: 'FREEZER', name: 'Freezer 1' },
      ]);
      const app = buildApp(router, { collection: () => storageContainers });

      const res = await request(app).get('/api/storage/freezer/freezer1/stats');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(storageContainers.findOne).not.toHaveBeenCalled();
    });
  });

  describe('GET /box/:boxId/integrity', () => {
    it('reports valid:true with no errors when occupancyGrid matches sample records and the count', async () => {
      const { router } = loadRoute();
      const storageBoxes = createMatchingCollection([
        { _id: 'box1', dimension: { rows: 2, cols: 2 }, currentOccupancy: 1, occupancyGrid: { A1: 'sample1' } },
      ]);
      const samples = createMatchingCollection([
        { _id: 'sample1', storageLocation: { boxId: 'box1', position: 'A1' } },
      ]);
      const app = buildApp(router, {
        collection: (name) => (name === 'storageBoxes' ? storageBoxes : name === 'samples' ? samples : null),
      });

      const res = await request(app).get('/api/storage/box/box1/integrity');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.errors).toBeUndefined();
      expect(res.body.data.stats).toEqual({
        boxId: 'box1',
        dimension: { rows: 2, cols: 2 },
        capacity: 4,
        currentOccupancy: 1,
        actualOccupancy: 1,
      });
    });

    // Survey claim under test: valid-but-inconsistent answers 400 (not 404
    // or 409), success:false, with an errors array -- an orphaned position
    // reference plus a currentOccupancy/actualOccupancy mismatch.
    it('answers 400 with success:false and an errors array for an orphaned/miscounted box', async () => {
      const { router } = loadRoute();
      const storageBoxes = createMatchingCollection([
        { _id: 'box2', dimension: { rows: 2, cols: 2 }, currentOccupancy: 2, occupancyGrid: { A1: 'sample-missing' } },
      ]);
      const samples = createMatchingCollection([]);
      const app = buildApp(router, {
        collection: (name) => (name === 'storageBoxes' ? storageBoxes : name === 'samples' ? samples : null),
      });

      const res = await request(app).get('/api/storage/box/box2/integrity');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.errors).toHaveLength(2);
      expect(res.body.data.errors[0]).toContain('Orfão');
      expect(res.body.data.errors[1]).toContain('Contagem incorreta');
    });

    it('rejects an unauthenticated request with 401 before touching the database', async () => {
      const { router } = loadRoute({ authImpl: unauthenticated });
      const storageBoxes = createMatchingCollection([
        { _id: 'box1', dimension: { rows: 1, cols: 1 }, occupancyGrid: {} },
      ]);
      const app = buildApp(router, { collection: () => storageBoxes });

      const res = await request(app).get('/api/storage/box/box1/integrity');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(storageBoxes.findOne).not.toHaveBeenCalled();
    });
  });

  describe('GET /freezer/:freezerId/tree', () => {
    it('resolves the freezer and its shelves from storageContainers via two distinct filters (issue #856)', async () => {
      const { router } = loadRoute();
      const { capturedFilters } = createFilterCaptureStore();
      const storageContainers = createMatchingCollection(
        [
          // Same _id as the freezer, wrong containerType -- must not be
          // picked as the freezer.
          { _id: 'freezer1', containerType: 'RACK', name: 'Wrong Type Container' },
          { _id: 'freezer1', containerType: 'FREEZER', name: 'Freezer 1', temperature: -80, temperatureUnit: 'CELSIUS', status: 'OPERATIONAL' },
          // Right containerType (SHELF), wrong parent -- must not appear
          // among freezer1's shelves.
          { _id: 'shelf-wrong-parent', parent_id: 'other-freezer', containerType: 'SHELF', name: 'Shelf Elsewhere' },
          // Right parent, wrong containerType (RACK) -- must not appear
          // among freezer1's shelves either.
          { _id: 'rack-under-freezer', parent_id: 'freezer1', containerType: 'RACK', name: 'Rack Directly Under Freezer' },
        ],
        { capturedFilters, key: 'storageContainers' }
      );
      const storageBoxes = {};
      const app = buildApp(router, {
        collection: (name) => (name === 'storageContainers' ? storageContainers : name === 'storageBoxes' ? storageBoxes : null),
      });

      const res = await request(app).get('/api/storage/freezer/freezer1/tree');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.freezerName).toBe('Freezer 1');
      expect(res.body.data.shelves).toEqual([]);
      expect(res.body.data.aggregateStats).toEqual({
        totalShelves: 0,
        totalRacks: 0,
        totalBoxes: 0,
        totalCapacity: 0,
        totalOccupied: 0,
        totalAvailable: 0,
        occupancyPercent: 0,
      });

      // capturedFilters keeps only the LAST filter recorded per key on this
      // collection, and this route issues two distinct storageContainers
      // filters (freezer findOne, then shelves find) -- .mock.calls is what
      // reaches both.
      expect(storageContainers.findOne.mock.calls[0][0]).toEqual({ _id: 'freezer1', containerType: 'FREEZER' });
      expect(storageContainers.find.mock.calls[0][0]).toEqual({ parent_id: 'freezer1', containerType: 'SHELF' });
    });

    it('returns 404 FREEZER_NOT_FOUND when the id matches a non-FREEZER container', async () => {
      const { router } = loadRoute();
      const storageContainers = createMatchingCollection([
        { _id: 'rack-only', containerType: 'RACK', name: 'Just a rack' },
      ]);
      const app = buildApp(router, { collection: (name) => (name === 'storageContainers' ? storageContainers : null) });

      const res = await request(app).get('/api/storage/freezer/rack-only/tree');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('FREEZER_NOT_FOUND');
    });

    it('rejects an unauthenticated request with 401 before touching the database', async () => {
      const { router } = loadRoute({ authImpl: unauthenticated });
      const storageContainers = createMatchingCollection([
        { _id: 'freezer1', containerType: 'FREEZER', name: 'Freezer 1' },
      ]);
      const app = buildApp(router, { collection: () => storageContainers });

      const res = await request(app).get('/api/storage/freezer/freezer1/tree');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(storageContainers.findOne).not.toHaveBeenCalled();
    });
  });
});

// #859: storage.routes.js applied `router.use(authenticate)` and then
// registered twelve routes with no permission gate at all -- exactly one
// route in the file (PATCH /freezer/:freezerId/room) carried a
// requirePermission, and it names 'createPatient', a Patient-domain code on
// a storage-topology route.
//
// Four of the ungated twelve are MUTATIONS of physical inventory:
// POST /allocate, POST /allocate/auto, POST /move and
// DELETE /release/:sampleId. The issue's body names only the three POSTs;
// the DELETE is the one it misses, and it is the same class of hole.
//
// The gate chosen here is requireRole(2, 3, 4) -- everyone except
// Usuario Externo (level 1) -- rather than a requirePermission, for two
// reasons that are checkable rather than stylistic:
//
//  1. No storage-scoped permission code exists. The RBAC catalog defines
//     21 codes and not one of them is about storage, allocation or
//     movement, so any requirePermission here would have to borrow a
//     wrong-domain code -- which is precisely the mistake the file's one
//     existing gate already makes. Adding proper codes touches the
//     canonical dictionary and is filed separately.
//  2. Level 1 is the unambiguous part. RF006 (custody/movement) names the
//     Tecnico as primary actor and RF017 (storage topology) names the
//     Coordenador, so the two requirements disagree about whether 2 or 3
//     is the floor -- but RF002 AC#4 limits the Usuario Externo to "dados
//     e relatorios previamente autorizados" under either reading, and
//     RF002 AC#5 requires the backend to enforce it independently of
//     whatever the frontend hides. Excluding level 1 is correct under both
//     readings; picking between 2 and 3 is not, so this does not pick.
describe('storage.routes authorization (#859)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Rejects at the gate the way the real requireRole does for a
  // disallowed level, so the assertion is about the gate being applied at
  // all -- not about resolveUserHierarchyLevel's own logic, which
  // rbac.js's own tests cover.
  function denyingRequireRole() {
    return () => (req, res) =>
      res.status(403).json({ success: false, error: 'Acesso negado' });
  }

  const MUTATIONS = [
    { method: 'post', path: '/api/storage/allocate' },
    { method: 'post', path: '/api/storage/allocate/auto' },
    { method: 'post', path: '/api/storage/move' },
    { method: 'delete', path: '/api/storage/release/sample-1' },
  ];

  for (const { method, path } of MUTATIONS) {
    it(`refuses ${method.toUpperCase()} ${path} for a role the gate rejects`, async () => {
      const { router } = loadRoute({ requireRoleImpl: denyingRequireRole() });
      const app = buildApp(router, { collection: () => ({}) });

      const res = await request(app)[method](path).send({});

      expect(res.status).toBe(403);
    });
  }

  it('leaves the read-only routes reachable without a role gate', async () => {
    // The mutations are the hole; the GETs are not. RF002 AC#1 puts
    // "custodia e armazenamento" inside what the Tecnico may see, and the
    // sibling sample.routes.js gates only its mutations too. A denying
    // role gate must therefore NOT be reached on a read.
    const { router } = loadRoute({ requireRoleImpl: denyingRequireRole() });
    const collection = createMatchingCollection([], { key: 'storageContainers' });
    const app = buildApp(router, {
      collection: (name) => (name === 'storageContainers' ? collection : null),
    });

    const res = await request(app).get('/api/storage/freezers');

    expect(res.status).not.toBe(403);
  });
});
