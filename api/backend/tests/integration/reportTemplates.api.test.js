import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createDbMock, createCollectionMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const { createFakeDb } = require('../unit/foundation/helpers/fake-db');

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

// accessType 2 (Tecnico) has viewReports but not manageReportTemplates;
// accessType 3 (Coordenador) and 4 (Administrador) have both, per #726's
// design call.
const USER_BY_ACCESS_TYPE = { 2: 'qa-tech-1', 3: 'qa-coord-1', 4: 'qa-admin-1' };
const ROLE_BY_ACCESS_TYPE = { 2: 'Tecnico', 3: 'Coordenador', 4: 'Administrador' };

function makeToken(accessType) {
  const userID = USER_BY_ACCESS_TYPE[accessType];
  return jwt.sign(
    { userID, accessType, roleName: ROLE_BY_ACCESS_TYPE[accessType], name: 'QA User', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function dbWithTemplates(overrides = {}) {
  return createDbMock({
    ...buildRbacCollections([
      { userAccountId: 'qa-tech-1', accessType: 2 },
      { userAccountId: 'qa-coord-1', accessType: 3 },
      { userAccountId: 'qa-admin-1', accessType: 4 },
    ]),
    ...overrides,
  });
}

beforeEach(() => {
  givenSession();
  app.locals.db = dbWithTemplates();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/report-templates', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/report-templates');
    expect(res.status).toBe(401);
  });

  it('returns 200 for any viewReports holder (Tecnico), sorted system-defined first then by name', async () => {
    // #1332: held out of order in a store that sorts, so the order is checked.
    const store = createFakeDb().collection('reportTemplates');
    await store.insertOne({ code: 'custom_b', name: 'Custom B', isSystemDefined: false });
    await store.insertOne({ code: 'storage', name: 'Armazenamento', isSystemDefined: true });
    await store.insertOne({ code: 'custom_a', name: 'Custom A', isSystemDefined: false });
    await store.insertOne({ code: 'sample', name: 'Amostras', isSystemDefined: true });
    app.locals.db = dbWithTemplates({
      reportTemplates: createCollectionMock({ find: vi.fn((filter) => store.find(filter)) }),
    });

    const res = await request(app)
      .get('/api/report-templates')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.map((template) => template.code)).toEqual(['sample', 'storage', 'custom_a', 'custom_b']);
  });

  it('returns 503 when db is unavailable', async () => {
    app.locals.db = null;

    const res = await request(app)
      .get('/api/report-templates')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(503);
  });
});

describe('GET /api/report-templates/:id', () => {
  it('returns 404 when not found', async () => {
    const res = await request(app)
      .get('/api/report-templates/does-not-exist')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(404);
  });

  it('finds a system template by its code', async () => {
    app.locals.db = dbWithTemplates({
      reportTemplates: createCollectionMock({
        findOne: vi.fn(async (query) => (query.$or.some((c) => c.code === 'sample') ? { code: 'sample', name: 'Amostras', isSystemDefined: true } : null)),
      }),
    });

    const res = await request(app)
      .get('/api/report-templates/sample')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('sample');
  });
});

describe('POST /api/report-templates', () => {
  it('returns 403 for a Tecnico (viewReports but not manageReportTemplates)', async () => {
    const res = await request(app)
      .post('/api/report-templates')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ code: 'custom_type', name: 'Custom Type', handlerKey: 'sample' });

    expect(res.status).toBe(403);
  });

  it('returns 422 for an invalid payload', async () => {
    const res = await request(app)
      .post('/api/report-templates')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ code: 'Bad Code', name: 'x', handlerKey: 'sample' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('creates a template for a Coordenador, stamping createdBy and isSystemDefined:false', async () => {
    const inserted = [];
    app.locals.db = dbWithTemplates({
      reportTemplates: createCollectionMock({
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn(async (doc) => {
          inserted.push(doc);
          return { insertedId: 'new-template-id' };
        }),
      }),
    });

    const res = await request(app)
      .post('/api/report-templates')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ code: 'custom_type', name: 'Custom Type', handlerKey: 'sample' });

    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe('custom_type');
    expect(res.body.data.isSystemDefined).toBe(false);
    expect(res.body.data.createdBy).toBe('User/qa-coord-1');
    expect(inserted).toHaveLength(1);
  });

  it('creates a template for an Administrador too', async () => {
    app.locals.db = dbWithTemplates({
      reportTemplates: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
    });

    const res = await request(app)
      .post('/api/report-templates')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ code: 'custom_type_2', name: 'Custom Type 2', handlerKey: 'result' });

    expect(res.status).toBe(201);
  });

  it('returns 409 when the code already exists', async () => {
    app.locals.db = dbWithTemplates({
      reportTemplates: createCollectionMock({
        findOne: vi.fn().mockResolvedValue({ code: 'sample', name: 'Amostras' }),
      }),
    });

    const res = await request(app)
      .post('/api/report-templates')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ code: 'sample', name: 'Duplicado', handlerKey: 'sample' });

    expect(res.status).toBe(409);
  });
});

describe('PUT /api/report-templates/:id', () => {
  it('returns 403 for a Tecnico', async () => {
    const res = await request(app)
      .put('/api/report-templates/custom_type')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ name: 'Renamed' });

    expect(res.status).toBe(403);
  });

  it('returns 404 when not found', async () => {
    app.locals.db = dbWithTemplates({
      reportTemplates: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
    });

    const res = await request(app)
      .put('/api/report-templates/does-not-exist')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'Renamed' });

    expect(res.status).toBe(404);
  });

  it('updates name/description while keeping code immutable, stamping updatedBy', async () => {
    const existing = { _id: 'template-1', code: 'custom_type', name: 'Old Name', handlerKey: 'sample', handlerOptions: {}, templateStatus: 'active', isSystemDefined: false };
    const updated = { ...existing, name: 'New Name', updatedBy: 'User/qa-coord-1' };
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(existing),
      findOneAndUpdate: vi.fn().mockResolvedValue(updated),
    });
    app.locals.db = dbWithTemplates({ reportTemplates: coll });

    const res = await request(app)
      .put('/api/report-templates/custom_type')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'New Name', code: 'attempted_change' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('New Name');
    const updateCall = coll.findOneAndUpdate.mock.calls[0];
    expect(updateCall[1].$set.name).toBe('New Name');
    expect(updateCall[1].$set).not.toHaveProperty('code');
  });

  it('returns 422 when the merged payload is invalid', async () => {
    const existing = { _id: 'template-1', code: 'custom_type', name: 'Old Name', handlerKey: 'sample', templateStatus: 'active', isSystemDefined: false };
    app.locals.db = dbWithTemplates({
      reportTemplates: createCollectionMock({ findOne: vi.fn().mockResolvedValue(existing) }),
    });

    const res = await request(app)
      .put('/api/report-templates/custom_type')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ handlerKey: 'notARealHandler' });

    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/report-templates/:id', () => {
  it('returns 403 for a Tecnico', async () => {
    const res = await request(app)
      .delete('/api/report-templates/custom_type')
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 when not found', async () => {
    app.locals.db = dbWithTemplates({
      reportTemplates: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
    });

    const res = await request(app)
      .delete('/api/report-templates/does-not-exist')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(404);
  });

  it('returns 400 and refuses to delete a system-defined template', async () => {
    app.locals.db = dbWithTemplates({
      reportTemplates: createCollectionMock({
        findOne: vi.fn().mockResolvedValue({ _id: 'template-1', code: 'sample', isSystemDefined: true }),
      }),
    });

    const res = await request(app)
      .delete('/api/report-templates/sample')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Modelos de relatório do sistema não podem ser removidos');
  });

  it('deletes a user-created template for a Coordenador', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: 'template-1', code: 'custom_type', isSystemDefined: false }),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    app.locals.db = dbWithTemplates({ reportTemplates: coll });

    const res = await request(app)
      .delete('/api/report-templates/custom_type')
      .set('Authorization', `Bearer ${makeToken(3)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(coll.deleteOne).toHaveBeenCalledWith({ _id: 'template-1' });
  });
});
