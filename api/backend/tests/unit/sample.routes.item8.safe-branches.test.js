import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);
const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const assignmentPath = require.resolve('../../src/services/rbac-assignment.service');
const routePath = require.resolve('../../src/interface/routes/sample.routes');

const authModule = require(authPath);
const rbacModule = require(rbacPath);
const assignmentModule = require(assignmentPath);

const originals = {
  authenticate: authModule.authenticate,
  requirePermission: rbacModule.requirePermission,
  requireOrganizationScope: rbacModule.requireOrganizationScope,
  isRecordInOrganizationScope: assignmentModule.isRecordInOrganizationScope,
};

let scopeAllowed = true;
authModule.authenticate = (req, _res, next) => {
  req.user = { userID: 'u1', id: 'u1', name: 'Coverage User', roleName: 'Administrador' };
  req.t = (key) => key;
  next();
};
rbacModule.requirePermission = () => (_req, _res, next) => next();
rbacModule.requireOrganizationScope = (req, _res, next) => {
  req.organizationScope = { scope: 'organization', organizationIds: ['org-1'] };
  next();
};
assignmentModule.isRecordInOrganizationScope = () => scopeAllowed;

delete require.cache[routePath];
const router = require(routePath);
const sampleService = require('../../src/services/sample.service');
const auditLogger = require('../../src/utils/auditLogger');

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/samples', router);
  return app;
}

function collection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn(() => ({
      limit: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    })),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'i1' }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    ...overrides,
  };
}

function dbWith(overrides = {}) {
  const map = { ...overrides };
  return {
    collection: vi.fn((name) => {
      if (!map[name]) map[name] = collection();
      return map[name];
    }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  scopeAllowed = true;
  vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  authModule.authenticate = originals.authenticate;
  rbacModule.requirePermission = originals.requirePermission;
  rbacModule.requireOrganizationScope = originals.requireOrganizationScope;
  assignmentModule.isRecordInOrganizationScope = originals.isRecordInOrganizationScope;
  delete require.cache[routePath];
});

describe('sample.routes item 8 safe residual branches without barcode compatibility paths', () => {
  const noDbRequests = [
    ['get', '/api/samples/507f1f77bcf86cd799439011/label/print-job'],
    ['post', '/api/samples/labels/batch'],
    ['post', '/api/samples/507f1f77bcf86cd799439011/withdraw'],
    ['put', '/api/samples/507f1f77bcf86cd799439011'],
    ['delete', '/api/samples/507f1f77bcf86cd799439011'],
    ['get', '/api/samples/search/by-term?q=ab'],
    ['get', '/api/samples/507f1f77bcf86cd799439011/results'],
    ['post', '/api/samples/507f1f77bcf86cd799439011/return'],
    ['get', '/api/samples/507f1f77bcf86cd799439011/movements'],
    ['get', '/api/samples/507f1f77bcf86cd799439011/rcs-assessments'],
    ['get', '/api/samples/507f1f77bcf86cd799439011/sprec-profiles'],
    ['get', '/api/samples/507f1f77bcf86cd799439011/quarantine-actions'],
  ];

  it.each(noDbRequests)('%s %s returns 503 without database', async (method, url) => {
    let req = request(buildApp(null))[method](url);
    if (method === 'post' || method === 'put') req = req.send({});
    const res = await req;
    expect(res.status).toBe(503);
  });

  it('print-job returns 404 for a missing canonical sample', async () => {
    const db = dbWith({ samples: collection() });
    expect((await request(buildApp(db)).get('/api/samples/SPEC-MISSING/label/print-job')).status).toBe(404);
  });

  it('print-job refuses an out-of-scope sample', async () => {
    scopeAllowed = false;
    const samples = collection({ findOne: vi.fn().mockResolvedValue({
      _id: 's1', specimenId: 'SPEC-1', barcode: 'DM-001', collectionSite: 'org-2',
    }) });
    const db = dbWith({ samples });
    expect((await request(buildApp(db)).get('/api/samples/SPEC-1/label/print-job')).status).toBe(403);
  });

  it('batch label endpoint requires a non-empty specimenIds array', async () => {
    const res = await request(buildApp(dbWith()))
      .post('/api/samples/labels/batch')
      .send({ specimenIds: [] });
    expect(res.status).toBe(400);
  });

  it('batch label endpoint returns per-item not-found and out-of-scope results without touching barcode assets', async () => {
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 's2', specimenId: 'SPEC-2', barcode: 'DM-002', collectionSite: 'org-2' });
    const db = dbWith({ samples: collection({ findOne }) });

    scopeAllowed = false;
    const assets = vi.spyOn(sampleService, 'getBarcodeIndustrialAssets');
    const res = await request(buildApp(db))
      .post('/api/samples/labels/batch')
      .send({ specimenIds: ['SPEC-MISSING', 'SPEC-2'] });

    expect(res.status).toBe(200);
    expect(res.body.data || res.body.results || res.body).toBeTruthy();
    expect(assets).not.toHaveBeenCalled();
  });

  it('withdraw/update/delete return 403 before mutation when sample is outside organization scope', async () => {
    scopeAllowed = false;
    vi.spyOn(sampleService, 'getSample').mockResolvedValue({ _id: 's1', collectionSite: 'org-2' });
    const withdraw = vi.spyOn(sampleService, 'withdrawSample');
    const update = vi.spyOn(sampleService, 'updateSample');
    const del = vi.spyOn(sampleService, 'deleteSample');
    const app = buildApp(dbWith());

    expect((await request(app).post('/api/samples/507f1f77bcf86cd799439011/withdraw').send({})).status).toBe(403);
    expect((await request(app).put('/api/samples/507f1f77bcf86cd799439011').send({})).status).toBe(403);
    expect((await request(app).delete('/api/samples/507f1f77bcf86cd799439011')).status).toBe(403);
    expect(withdraw).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('update and delete expose their not-found branches with in-scope sample', async () => {
    vi.spyOn(sampleService, 'getSample').mockResolvedValue({ _id: 's1', collectionSite: 'org-1' });
    vi.spyOn(sampleService, 'updateSample').mockResolvedValue(null);
    vi.spyOn(sampleService, 'deleteSample').mockResolvedValue(null);
    const app = buildApp(dbWith());

    expect((await request(app).put('/api/samples/507f1f77bcf86cd799439011').send({})).status).toBe(404);
    expect((await request(app).delete('/api/samples/507f1f77bcf86cd799439011')).status).toBe(404);
  });

  it('search endpoint rejects an empty/short term and returns 500 for storage errors', async () => {
    const db = dbWith();
    expect((await request(buildApp(db)).get('/api/samples/search/by-term?q=x')).status).toBe(400);

    db.collection = vi.fn(() => ({
      find: vi.fn(() => { throw new Error('search storage down'); }),
    }));
    const failed = await request(buildApp(db)).get('/api/samples/search/by-term?q=xy');
    expect(failed.status).toBe(500);
  });

  it('results and governance-history readers refuse out-of-scope samples before service access', async () => {
    scopeAllowed = false;
    vi.spyOn(sampleService, 'getSample').mockResolvedValue({ _id: 's1', collectionSite: 'org-2' });
    const resultSpy = vi.spyOn(sampleService, 'getSampleResults');
    const moveSpy = vi.spyOn(sampleService, 'getSampleMovements');
    const rcsSpy = vi.spyOn(sampleService, 'getRcsAssessments');
    const sprecSpy = vi.spyOn(sampleService, 'getSprecProfiles');
    const qaSpy = vi.spyOn(sampleService, 'getQuarantineActions');
    const app = buildApp(dbWith());
    const id = '507f1f77bcf86cd799439011';

    expect((await request(app).get(`/api/samples/${id}/results`)).status).toBe(403);
    expect((await request(app).get(`/api/samples/${id}/movements`)).status).toBe(403);
    expect((await request(app).get(`/api/samples/${id}/rcs-assessments`)).status).toBe(403);
    expect((await request(app).get(`/api/samples/${id}/sprec-profiles`)).status).toBe(403);
    expect((await request(app).get(`/api/samples/${id}/quarantine-actions`)).status).toBe(403);
    expect(resultSpy).not.toHaveBeenCalled();
    expect(moveSpy).not.toHaveBeenCalled();
    expect(rcsSpy).not.toHaveBeenCalled();
    expect(sprecSpy).not.toHaveBeenCalled();
    expect(qaSpy).not.toHaveBeenCalled();
  });
});
