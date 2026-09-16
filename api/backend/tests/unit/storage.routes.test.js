import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/interface/routes/storage.routes.js');
const allocatePath = require.resolve('../../src/core/use-cases/AllocateSampleUseCase');
const movePath = require.resolve('../../src/core/use-cases/MoveSampleUseCase');
const releasePath = require.resolve('../../src/core/use-cases/ReleaseSampleUseCase');
const storageServicePath = require.resolve('../../src/services/storageService');
const listFreezersPath = require.resolve('../../src/core/use-cases/ListOperationalFreezersUseCase');
const searchSamplesPath = require.resolve('../../src/core/use-cases/SearchAllocatableSamplesUseCase');
const getPlacementPath = require.resolve('../../src/core/use-cases/GetSampleStorageLocationUseCase');
const getAvailablePath = require.resolve('../../src/core/use-cases/GetBoxAvailablePositionsUseCase');

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
let currentAllocate = vi.fn(async () => ({ currentStoragePlacement: placement, lineageQueued: true, lineageEventId: 'evt-allocate' }));
let currentMove = vi.fn(async () => ({
  specimenId: 'SPEC-1',
  from: { boxId: 'box-1', position: 'A1' },
  to: { boxId: 'box-2', position: 'B2' },
  lineageQueued: true,
  lineageEventId: 'evt-move'
}));
let currentRelease = vi.fn(async () => ({
  releasedFrom: { specimenId: 'SPEC-1', boxId: 'box-1', position: 'A1' },
  lineageQueued: true,
  lineageEventId: 'evt-release'
}));
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

installClass(allocatePath, function StableAllocateSampleUseCase() {
  this.execute = (...args) => currentAllocate(...args);
});
installClass(movePath, function StableMoveSampleUseCase() {
  this.execute = (...args) => currentMove(...args);
});
installClass(releasePath, function StableReleaseSampleUseCase() {
  this.execute = (...args) => currentRelease(...args);
});
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

const router = require(routePath);

function resetDoubles() {
  currentAuth = (req, _res, next) => {
    req.user = { id: 'user-1', name: 'Tester', roleName: 'Administrador' };
    next();
  };
  currentPermission = () => (_req, _res, next) => next();
  currentAllocate = vi.fn(async () => ({ currentStoragePlacement: placement, lineageQueued: true, lineageEventId: 'evt-allocate' }));
  currentMove = vi.fn(async () => ({ specimenId: 'SPEC-1', from: { boxId: 'box-1', position: 'A1' }, to: { boxId: 'box-2', position: 'B2' }, lineageQueued: true, lineageEventId: 'evt-move' }));
  currentRelease = vi.fn(async () => ({ releasedFrom: { specimenId: 'SPEC-1', boxId: 'box-1', position: 'A1' }, lineageQueued: true, lineageEventId: 'evt-release' }));
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

  it('GET /sample/:sampleId exposes the canonical placement projection', async () => {
    const res = await request(buildApp()).get('/api/storage/sample/SPEC-1');
    expect(res.status).toBe(200);
    expect(res.body.data.canonicalPlacement).toEqual(placement);
    expect(currentGetPlacement).toHaveBeenCalledWith({ specimenId: 'SPEC-1' });
  });

  it('GET /sample/:sampleId maps a missing specimen to 404', async () => {
    currentGetPlacement.mockResolvedValueOnce({ found: false, error: 'SAMPLE_NOT_FOUND', message: 'Amostra não encontrada' });
    const res = await request(buildApp()).get('/api/storage/sample/missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SAMPLE_NOT_FOUND');
  });

  it('GET /box/:boxId/available returns layout availability while custody remains canonical elsewhere', async () => {
    const res = await request(buildApp()).get('/api/storage/box/box-1/available');
    expect(res.status).toBe(200);
    expect(res.body.data.availablePositions).toEqual(['A2', 'B1', 'B2']);
    expect(currentGetAvailable).toHaveBeenCalledWith({ boxId: 'box-1' });
  });

  it('server-side RBAC blocks custody mutation before the use case executes', async () => {
    currentPermission = (permission) => (_req, res, next) => {
      if (permission === 'manageStorageAllocation') return res.status(403).json({ success: false, error: 'FORBIDDEN' });
      return next();
    };
    const res = await request(buildApp())
      .post('/api/storage/allocate')
      .send({ sampleId: 'SPEC-1', boxId: 'box-1', position: 'A1' });
    expect(res.status).toBe(403);
    expect(currentAllocate).not.toHaveBeenCalled();
  });

  it('POST /allocate returns CurrentStoragePlacement and projection evidence', async () => {
    const res = await request(buildApp())
      .post('/api/storage/allocate')
      .send({ sampleId: 'SPEC-1', boxId: 'box-1', position: 'A1' });
    expect(res.status).toBe(201);
    expect(res.body.currentStoragePlacement).toEqual(placement);
    expect(res.body.data).toEqual(placement);
    expect(res.body.projectionQueued).toBe(true);
    expect(currentAllocate).toHaveBeenCalledWith(expect.objectContaining({ specimenId: 'SPEC-1', boxId: 'box-1', position: 'A1' }));
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

  it('POST /move keeps route/controller mapping while returning the governed move result', async () => {
    const res = await request(buildApp())
      .post('/api/storage/move')
      .send({ sampleId: 'SPEC-1', targetBoxId: 'box-2', targetPosition: 'B2', reason: 'relocation' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.to).toEqual({ boxId: 'box-2', position: 'B2' });
    expect(currentMove).toHaveBeenCalledWith(expect.objectContaining({ specimenId: 'SPEC-1', targetBoxId: 'box-2', targetPosition: 'B2' }));
  });

  it('DELETE /release/:sampleId returns release evidence without any direct graph persistence flag', async () => {
    const res = await request(buildApp()).delete('/api/storage/release/SPEC-1');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ specimenId: 'SPEC-1', boxId: 'box-1', position: 'A1' });
    expect(res.body.projectionQueued).toBe(true);
    expect(currentRelease).toHaveBeenCalledWith(expect.objectContaining({ specimenId: 'SPEC-1' }));
  });
});
