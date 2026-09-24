import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const { StorageTopologyAuthoringService } = require('../../src/services/storage-topology-authoring.service');
const auditLogger = require('../../src/utils/auditLogger');

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/interface/routes/storage.routes.js');
const storageServicePath = require.resolve('../../src/services/storageService');
const listFreezersPath = require.resolve('../../src/core/use-cases/ListOperationalFreezersUseCase');
const searchSamplesPath = require.resolve('../../src/core/use-cases/SearchAllocatableSamplesUseCase');
const getPlacementPath = require.resolve('../../src/core/use-cases/GetSampleStorageLocationUseCase');
const getAvailablePath = require.resolve('../../src/core/use-cases/GetBoxAvailablePositionsUseCase');
const queryControllerPath = require.resolve('../../src/interface/controllers/storage-query.controller');
const autoControllerPath = require.resolve('../../src/interface/controllers/auto-assign-sample.controller');

const placement = {
  specimenId: 'SPEC-1',
  boxId: 'box-1',
  positionCode: 'A1',
  storageRackId: 'rack-1',
  storagePositionId: 'position-1'
};

let currentAuth = (req, _res, next) => {
  req.user = { id: 'user-1', name: 'Tester', roleName: 'Administrador' };
  next();
};
let currentPermission = () => (_req, _res, next) => next();
let currentAutoAssign = vi.fn(async () => ({
  success: true,
  currentStoragePlacement: placement,
  projectionQueued: true,
  projectionEventId: 'evt-auto'
}));
let currentListFreezers = vi.fn(async () => [{ _id: 'freezer-1', name: 'Freezer 1', status: 'OPERATIONAL' }]);
let currentSearchSamples = vi.fn(async () => [{ _id: 'sample-1', specimenId: 'SPEC-1', barcode: 'BC-1' }]);
let currentGetPlacement = vi.fn(async () => ({ found: true, placement: { canonicalPlacement: placement, box: { boxId: 'box-1', position: 'A1' } } }));
let currentGetAvailable = vi.fn(async () => ({
  boxId: 'box-1',
  stats: { capacity: 4, occupied: 1, available: 3, occupancyPercent: 25 },
  availablePositions: ['A2', 'B1', 'B2'],
  occupiedPositions: ['A1']
}));

const authModule = require(authPath);
authModule.authenticate = (req, res, next) => currentAuth(req, res, next);

const rbacModule = require(rbacPath);
rbacModule.requirePermission = (permission) => (req, res, next) => currentPermission(permission)(req, res, next);

function installClass(path, factory) {
  require.cache[path] = {
    id: path,
    filename: path,
    loaded: true,
    exports: factory
  };
}

// This route suite owns routing/RBAC/query wiring only. Allocate/move/release
// controller behavior is covered by their dedicated unit suites; keeping
// module-cache doubles for those controllers made this route suite certify an
// implementation different from the canonical v2 runtime.
installClass(storageServicePath, function StableStorageService() {
  this.autoAssignSampleToBox = (...args) => currentAutoAssign(...args);
});
installClass(listFreezersPath, function StableListOperationalFreezersUseCase() {
  this.execute = (...args) => currentListFreezers(...args);
});
installClass(searchSamplesPath, function StableSearchAllocatableSamplesUseCase() {
  this.execute = (...args) => currentSearchSamples(...args);
});
installClass(getPlacementPath, function StableGetSampleStorageLocationUseCase() {
  this.execute = (...args) => currentGetPlacement(...args);
});
installClass(getAvailablePath, function StableGetBoxAvailablePositionsUseCase() {
  this.execute = (...args) => currentGetAvailable(...args);
});

for (const controllerPath of [queryControllerPath, autoControllerPath]) delete require.cache[controllerPath];
delete require.cache[routePath];
const router = require(routePath);

for (const modulePath of [storageServicePath, listFreezersPath, searchSamplesPath, getPlacementPath, getAvailablePath, queryControllerPath, autoControllerPath, routePath]) {
  delete require.cache[modulePath];
}

function resetDoubles() {
  currentAuth = (req, _res, next) => {
    req.user = { id: 'user-1', name: 'Tester', roleName: 'Administrador' };
    next();
  };
  currentPermission = () => (_req, _res, next) => next();
  currentAutoAssign = vi.fn(async () => ({ success: true, currentStoragePlacement: placement, projectionQueued: true, projectionEventId: 'evt-auto' }));
  currentListFreezers = vi.fn(async () => [{ _id: 'freezer-1', name: 'Freezer 1', status: 'OPERATIONAL' }]);
  currentSearchSamples = vi.fn(async () => [{ _id: 'sample-1', specimenId: 'SPEC-1', barcode: 'BC-1' }]);
  currentGetPlacement = vi.fn(async () => ({ found: true, placement: { canonicalPlacement: placement, box: { boxId: 'box-1', position: 'A1' } } }));
  currentGetAvailable = vi.fn(async () => ({ boxId: 'box-1', stats: { capacity: 4, occupied: 1, available: 3, occupancyPercent: 25 }, availablePositions: ['A2', 'B1', 'B2'], occupiedPositions: ['A1'] }));
}

function buildApp(db = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/storage', router);
  return app;
}

function findRoute(path, method) {
  return router.stack.find((layer) => layer.route?.path === path && layer.route.methods?.[method]);
}

afterEach(() => {
  vi.restoreAllMocks();
  resetDoubles();
});

describe('storage.routes canonical v2', () => {
  it('enforces authentication before storage queries', async () => {
    currentAuth = (_req, res) => res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
    const res = await request(buildApp()).get('/api/storage/freezers');
    expect(res.status).toBe(401);
    expect(currentListFreezers).not.toHaveBeenCalled();
  });

  it('GET /freezers delegates to the governed topology read use case', async () => {
    const res = await request(buildApp()).get('/api/storage/freezers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ _id: 'freezer-1', name: 'Freezer 1', status: 'OPERATIONAL' }] });
    expect(currentListFreezers).toHaveBeenCalledTimes(1);
  });

  it('GET /samples/search delegates candidate selection without embedded placement aliases', async () => {
    const res = await request(buildApp()).get('/api/storage/samples/search?q=BC-1');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ _id: 'sample-1', specimenId: 'SPEC-1', barcode: 'BC-1' }]);
    expect(currentSearchSamples).toHaveBeenCalledWith({ query: 'BC-1' });
  });

  it('GET /specimen/:specimenId exposes the canonical placement projection', async () => {
    const res = await request(buildApp()).get('/api/storage/specimen/SPEC-1');
    expect(res.status).toBe(200);
    expect(res.body.data.canonicalPlacement).toEqual(placement);
    expect(currentGetPlacement).toHaveBeenCalledWith({ specimenId: 'SPEC-1' });
  });

  it('GET /specimen/:specimenId maps a missing specimen to 404', async () => {
    currentGetPlacement.mockResolvedValueOnce({ found: false, error: 'SAMPLE_NOT_FOUND', message: 'Amostra não encontrada' });
    const res = await request(buildApp()).get('/api/storage/specimen/missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SAMPLE_NOT_FOUND');
  });

  it('GET /box/:boxId/available returns layout availability while custody remains canonical elsewhere', async () => {
    const res = await request(buildApp()).get('/api/storage/box/box-1/available');
    expect(res.status).toBe(200);
    expect(res.body.data.availablePositions).toEqual(['A2', 'B1', 'B2']);
    expect(currentGetAvailable).toHaveBeenCalledWith({ boxId: 'box-1' });
  });

  it('server-side RBAC blocks custody mutation before the allocate controller executes', async () => {
    currentPermission = (permission) => (_req, res, next) => {
      if (permission === 'manageStorageAllocation') return res.status(403).json({ success: false, error: 'FORBIDDEN' });
      return next();
    };
    const res = await request(buildApp())
      .post('/api/storage/allocate')
      .send({ specimenId: 'SPEC-1', boxId: 'box-1', position: 'A1' });
    expect(res.status).toBe(403);
  });

  it('registers POST /allocate on the canonical specimen custody boundary', () => {
    const route = findRoute('/allocate', 'post');
    expect(route).toBeDefined();
    expect(route.route.stack.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /allocate/auto uses the same canonical placement response contract', async () => {
    const res = await request(buildApp())
      .post('/api/storage/allocate/auto')
      .send({ specimenId: 'SPEC-1', boxId: 'box-1' });
    expect(res.status).toBe(201);
    expect(res.body.currentStoragePlacement).toEqual(placement);
    expect(res.body.data).toEqual(placement);
    expect(res.body.projectionQueued).toBe(true);
    expect(currentAutoAssign).toHaveBeenCalledWith('SPEC-1', 'box-1');
  });

  it('registers POST /move on the canonical specimenId boundary', () => {
    const route = findRoute('/move', 'post');
    expect(route).toBeDefined();
    expect(route.route.stack.length).toBeGreaterThanOrEqual(2);
  });

  it('registers DELETE /release/:specimenId without a legacy sampleId alias', () => {
    expect(findRoute('/release/:specimenId', 'delete')).toBeDefined();
    expect(findRoute('/release/:sampleId', 'delete')).toBeUndefined();
  });
});

describe('storage.routes item 8 topology authoring and freezer-room residuals', () => {
  const FREEZER_ID = '507f1f77bcf86cd799439011';
  const ROOM_ID = '507f191e810c19729de860ea';

  afterEach(() => {
    vi.restoreAllMocks();
    resetDoubles();
  });

  it('creates a governed container layout using the resolved actor identity and audits the configuration write', async () => {
    currentAuth = (req, _res, next) => {
      req.user = { userID: 'author-1' };
      next();
    };
    const created = {
      _id: 'container-object-1',
      containerType: 'FREEZER',
      parent_id: null,
      roomId: ROOM_ID,
      containerID: 'FREEZER-A',
    };
    const createSpy = vi.spyOn(StorageTopologyAuthoringService.prototype, 'createContainer').mockResolvedValue(created);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const auditSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const res = await request(buildApp({}))
      .post('/api/storage/topology/containers')
      .send({ containerType: 'FREEZER', name: 'Freezer A' });

    expect(res.status).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(
      { containerType: 'FREEZER', name: 'Freezer A' },
      'author-1'
    );
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      resourceType: 'StorageContainerLayout',
      resourceId: 'container-object-1',
      payload: {
        containerType: 'FREEZER',
        parentId: null,
        roomId: ROOM_ID,
        equipmentId: 'FREEZER-A',
      },
    }));
  });

  it('creates a governed box layout and preserves its canonical layout metadata in the audit payload', async () => {
    const created = {
      _id: 'box-object-1',
      parent_id: FREEZER_ID,
      dimension: { rows: 8, cols: 12 },
      capacity: 96,
    };
    const createSpy = vi.spyOn(StorageTopologyAuthoringService.prototype, 'createBox').mockResolvedValue(created);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const auditSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const res = await request(buildApp({}))
      .post('/api/storage/topology/boxes')
      .send({ parent_id: FREEZER_ID, name: 'Box A', dimension: { rows: 8, cols: 12 } });

    expect(res.status).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(
      { parent_id: FREEZER_ID, name: 'Box A', dimension: { rows: 8, cols: 12 } },
      null
    );
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'StorageBoxLayout',
      payload: {
        parentId: FREEZER_ID,
        dimension: { rows: 8, cols: 12 },
        capacity: 96,
      },
    }));
  });

  it('maps governed topology service errors to their documented status/code and unexpected errors to 500', async () => {
    const governed = Object.assign(new Error('layout inválido'), {
      statusCode: 422,
      code: 'INVALID_LAYOUT',
    });
    vi.spyOn(StorageTopologyAuthoringService.prototype, 'createContainer').mockRejectedValueOnce(governed);

    const invalid = await request(buildApp({}))
      .post('/api/storage/topology/containers')
      .send({ name: 'bad' });
    expect(invalid.status).toBe(422);
    expect(invalid.body).toEqual({
      success: false,
      error: 'INVALID_LAYOUT',
      message: 'layout inválido',
    });

    vi.spyOn(StorageTopologyAuthoringService.prototype, 'createBox').mockRejectedValueOnce(new Error('unexpected'));
    const failed = await request(buildApp({}))
      .post('/api/storage/topology/boxes')
      .send({ name: 'Box' });
    expect(failed.status).toBe(500);
    expect(failed.body).toMatchObject({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'unexpected',
    });

    // Thrown value without message exercises sendTopologyError's 'Erro interno' fallback
    vi.spyOn(StorageTopologyAuthoringService.prototype, 'createBox').mockRejectedValueOnce({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
    const noMessage = await request(buildApp({}))
      .post('/api/storage/topology/boxes')
      .send({ name: 'Box' });
    expect(noMessage.status).toBe(500);
    expect(noMessage.body.message).toBe('Erro interno');
  });

  it('validates freezer and room identifiers before writing any room assignment', async () => {
    const storageContainers = {
      findOne: vi.fn(),
      updateOne: vi.fn(),
    };
    const rooms = { findOne: vi.fn() };
    const db = {
      collection: vi.fn((name) => name === 'storageContainers' ? storageContainers : rooms),
    };

    const invalidFreezer = await request(buildApp(db))
      .patch('/api/storage/freezer/not-an-id/room')
      .send({ roomId: ROOM_ID });
    expect(invalidFreezer.status).toBe(400);
    expect(storageContainers.findOne).not.toHaveBeenCalled();

    storageContainers.findOne.mockResolvedValueOnce({ _id: FREEZER_ID, containerType: 'FREEZER' });
    const invalidRoom = await request(buildApp(db))
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .send({ roomId: 'not-an-id' });
    expect(invalidRoom.status).toBe(400);
    expect(invalidRoom.body.error).toBe('roomId inválido');
    expect(storageContainers.updateOne).not.toHaveBeenCalled();
  });

  it('distinguishes missing containers, non-freezers and missing rooms', async () => {
    const storageContainers = {
      findOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: FREEZER_ID, containerType: 'RACK' })
        .mockResolvedValueOnce({ _id: FREEZER_ID, containerType: 'FREEZER' }),
      updateOne: vi.fn(),
    };
    const rooms = { findOne: vi.fn().mockResolvedValue(null) };
    const db = {
      collection: vi.fn((name) => name === 'storageContainers' ? storageContainers : rooms),
    };

    const missingFreezer = await request(buildApp(db))
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .send({ roomId: ROOM_ID });
    expect(missingFreezer.status).toBe(404);
    expect(missingFreezer.body.error).toBe('FREEZER_NOT_FOUND');

    const wrongType = await request(buildApp(db))
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .send({ roomId: ROOM_ID });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error).toBe('NOT_A_FREEZER');

    const missingRoom = await request(buildApp(db))
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .send({ roomId: ROOM_ID });
    expect(missingRoom.status).toBe(404);
    expect(missingRoom.body.error).toBe('ROOM_NOT_FOUND');
  });

  it('assigns and clears roomId through the canonical storageContainers configuration document', async () => {
    const storageContainers = {
      findOne: vi.fn()
        .mockResolvedValue({ _id: FREEZER_ID, containerType: 'FREEZER' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const rooms = { findOne: vi.fn().mockResolvedValue({ _id: ROOM_ID, deletedAt: null }) };
    const db = {
      collection: vi.fn((name) => name === 'storageContainers' ? storageContainers : rooms),
    };
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const auditSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const assigned = await request(buildApp(db))
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .send({ roomId: ROOM_ID });
    expect(assigned.status).toBe(200);
    expect(storageContainers.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: { roomId: expect.any(Object), updatedAt: expect.any(Date) } }
    );
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE',
      resourceType: 'StorageContainer',
      payload: { roomId: ROOM_ID },
    }));

    rooms.findOne.mockClear();
    storageContainers.updateOne.mockClear();
    const cleared = await request(buildApp(db))
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .send({});
    expect(cleared.status).toBe(200);
    expect(rooms.findOne).not.toHaveBeenCalled();
    expect(storageContainers.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: { roomId: null, updatedAt: expect.any(Date) } }
    );
  });

  it('returns 500 when room assignment persistence fails', async () => {
    const storageContainers = {
      findOne: vi.fn().mockResolvedValue({ _id: FREEZER_ID, containerType: 'FREEZER' }),
      updateOne: vi.fn().mockRejectedValue(new Error('mongo write failed')),
    };
    const db = {
      collection: vi.fn((name) => name === 'storageContainers' ? storageContainers : { findOne: vi.fn() }),
    };

    const res = await request(buildApp(db))
      .patch(`/api/storage/freezer/${FREEZER_ID}/room`)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'mongo write failed',
    });
  });
});

