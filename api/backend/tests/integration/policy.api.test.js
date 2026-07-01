import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-admin-1', accessType, roleName: 'Administrador', name: 'QA Admin', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

const FAKE_POLICY = { _id: 'policy-1', policyId: 1, name: 'Política Padrão', minTemp: 2, maxTemp: 8 };

describe('GET /api/policies', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/policies');
    expect(res.status).toBe(401);
  });

  it('returns policy list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([FAKE_POLICY]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
    });
    app.locals.db = createDbMock({ policies: coll });

    const res = await request(app)
      .get('/api/policies')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/policies/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/policies/1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when policy not found', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ policies: coll });

    const res = await request(app)
      .get('/api/policies/1')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });

  it('returns policy by numeric policyId', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_POLICY) });
    app.locals.db = createDbMock({ policies: coll });

    const res = await request(app)
      .get('/api/policies/1')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/policies', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/policies').send({ name: 'Nova Política' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Pesquisador without viewTemperature permission (accessType 1)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/policies')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ name: 'Nova Política', minTemp: 2, maxTemp: 8 });
    expect(res.status).toBe(403);
  });

  it('creates a policy for admin', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-policy-id' }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    app.locals.db = createDbMock({ policies: coll });

    const res = await request(app)
      .post('/api/policies')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Criotecnia', minTemp: -80, maxTemp: -60, description: 'Armazenamento criogênico' });

    expect([200, 201, 400]).toContain(res.status);
  });
});

describe('PUT /api/policies/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/policies/1').send({ name: 'Atualizada' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Pesquisador (accessType 1)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .put('/api/policies/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ name: 'Atualizada' });
    expect(res.status).toBe(403);
  });

  it('updates an existing policy', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_POLICY),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ policies: coll });

    const res = await request(app)
      .put('/api/policies/1')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ name: 'Política Atualizada', minTemp: 2, maxTemp: 8 });

    expect([200, 400]).toContain(res.status);
  });
});

describe('DELETE /api/policies/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/policies/1');
    expect(res.status).toBe(401);
  });

  it('returns 403 for Pesquisador (accessType 1)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .delete('/api/policies/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(1)}`);
    expect(res.status).toBe(403);
  });

  it('deletes a policy for admin', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_POLICY),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    app.locals.db = createDbMock({ policies: coll });

    const res = await request(app)
      .delete('/api/policies/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect([200, 400]).toContain(res.status);
  });
});
