import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { auditInit, auditCreate, auditUpdate, auditDelete } = vi.hoisted(() => ({
  auditInit: vi.fn(),
  auditCreate: vi.fn(),
  auditUpdate: vi.fn(),
  auditDelete: vi.fn(),
}));

// These routes are CommonJS and destructure middleware at require-time.
const authModule = require('../../src/infrastructure/middleware/auth');
const rbacModule = require('../../src/infrastructure/middleware/rbac');
const auditLogger = require('../../src/utils/auditLogger');

const originals = {
  authenticate: authModule.authenticate,
  requirePermission: rbacModule.requirePermission,
  auditInit: auditLogger.init,
  auditCreate: auditLogger.logCreate,
  auditUpdate: auditLogger.logUpdate,
  auditDelete: auditLogger.logDelete,
};

authModule.authenticate = (_req, _res, next) => next();
rbacModule.requirePermission = () => (_req, _res, next) => next();
auditLogger.init = auditInit;
auditLogger.logCreate = auditCreate;
auditLogger.logUpdate = auditUpdate;
auditLogger.logDelete = auditDelete;

const router = require('../../src/interface/routes/access.routes');

afterAll(() => {
  authModule.authenticate = originals.authenticate;
  rbacModule.requirePermission = originals.requirePermission;
  auditLogger.init = originals.auditInit;
  auditLogger.logCreate = originals.auditCreate;
  auditLogger.logUpdate = originals.auditUpdate;
  auditLogger.logDelete = originals.auditDelete;
});

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.app.locals.db = db;
    next();
  });
  app.use('/api/access', router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  auditCreate.mockResolvedValue();
  auditUpdate.mockResolvedValue();
  auditDelete.mockResolvedValue();
});

describe('access.routes item 8 residual branches', () => {
  it('returns 503 from every CRUD surface when the database handle is absent', async () => {
    const app = makeApp(null);
    const id = '507f1f77bcf86cd799439011';

    const responses = await Promise.all([
      request(app).get('/api/access'),
      request(app).get(`/api/access/${id}`),
      request(app).post('/api/access').send({}),
      request(app).put(`/api/access/${id}`).send({}),
      request(app).delete(`/api/access/${id}`),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        success: false,
        error: 'Banco de dados não disponível',
      });
    }
  });

  it('PUT allowlists canonical mutable fields and rejects a missing target with 404', async () => {
    const accessCollection = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
    };
    const db = { collection: vi.fn(() => accessCollection) };
    const id = '507f1f77bcf86cd799439011';

    const response = await request(makeApp(db))
      .put(`/api/access/${id}`)
      .send({
        reportID: 'R-1',
        accessType: 'read',
        injected: 'drop-me',
        accessID: 'do-not-reparent',
        updatedAt: 'caller-value',
      });

    expect(response.status).toBe(404);
    const setDoc = accessCollection.updateOne.mock.calls[0][1].$set;
    expect(setDoc).toEqual(expect.objectContaining({
      reportID: 'R-1',
      accessType: 'read',
      updatedAt: expect.any(Date),
    }));
    expect(setDoc).not.toHaveProperty('injected');
    expect(setDoc).not.toHaveProperty('accessID');
    expect(setDoc.updatedAt).not.toBe('caller-value');
    expect(auditUpdate).not.toHaveBeenCalled();
  });

  it('PUT audits a successful update', async () => {
    const accessCollection = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const db = { collection: vi.fn(() => accessCollection) };
    const id = '507f1f77bcf86cd799439011';

    const response = await request(makeApp(db))
      .put(`/api/access/${id}`)
      .send({ userId: 'user-1' });

    expect(response.status).toBe(200);
    expect(auditInit).toHaveBeenCalledWith(db);
    expect(auditUpdate).toHaveBeenCalledWith(expect.anything(), 'Access', id);
  });

  it('DELETE returns 404 without audit when nothing matches and audits a successful deletion', async () => {
    const id = '507f1f77bcf86cd799439011';
    const accessCollection = {
      deleteOne: vi.fn()
        .mockResolvedValueOnce({ deletedCount: 0 })
        .mockResolvedValueOnce({ deletedCount: 1 }),
    };
    const db = { collection: vi.fn(() => accessCollection) };
    const app = makeApp(db);

    let response = await request(app).delete(`/api/access/${id}`);
    expect(response.status).toBe(404);
    expect(auditDelete).not.toHaveBeenCalled();

    response = await request(app).delete(`/api/access/${id}`);
    expect(response.status).toBe(200);
    expect(auditInit).toHaveBeenCalledWith(db);
    expect(auditDelete).toHaveBeenCalledWith(expect.anything(), 'Access', id);
  });
});
