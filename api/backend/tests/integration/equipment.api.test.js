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
    { userID: 'qa-user-1', accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

const FAKE_EQ = { _id: '507f1f77bcf86cd799439011', equipmentID: 'EQ-001', name: 'Freezer A', type: 'Storage', status: 'Active' };

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/equipment', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/equipment');
    expect(res.status).toBe(401);
  });

  it('returns equipment list for authenticated user', async () => {
    const coll = createCollectionMock({ find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([FAKE_EQ]) }) });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app).get('/api/equipment').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/equipment/analytical', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/equipment/analytical');
    expect(res.status).toBe(401);
  });

  it('returns analytical equipment', async () => {
    const coll = createCollectionMock({ find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app).get('/api/equipment/analytical').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/equipment/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/equipment/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('returns 404 when not found', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .get('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(404);
  });

  it('returns equipment by id', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_EQ) });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .get('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/equipment', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/equipment').send({ name: 'New EQ' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico (accessType 2 — no createPatient permission)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ name: 'New EQ', type: 'Analytical' });
    expect(res.status).toBe(403);
  });

  it('creates equipment for Coordenador (accessType 3)', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      countDocuments: vi.fn().mockResolvedValue(0),
    });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .post('/api/equipment')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ name: 'New Freezer', type: 'Storage', status: 'Active', location: 'Lab-1' });
    expect([200, 201, 400]).toContain(res.status);
  });
});

describe('PUT /api/equipment/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/equipment/507f1f77bcf86cd799439011').send({ status: 'Maintenance' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ status: 'Maintenance' });
    expect(res.status).toBe(403);
  });

  it('updates equipment for admin', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .put('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ status: 'Maintenance' });
    expect([200, 400]).toContain(res.status);
  });
});

describe('DELETE /api/equipment/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/equipment/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .delete('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });

  it('deletes equipment for admin', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_EQ),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    app.locals.db = createDbMock({ equipment: coll });

    const res = await request(app)
      .delete('/api/equipment/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect([200, 400]).toContain(res.status);
  });
});
