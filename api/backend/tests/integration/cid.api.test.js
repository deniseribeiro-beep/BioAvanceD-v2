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
    { userID: 'qa-1', accessType, roleName: 'Administrador', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

const FAKE_CID = { _id: '507f1f77bcf86cd799439011', Codigo_Tabulacao: 'A00', Codigos_CID10: 'A00', Descricao: 'Cólera', active: true };

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/cids', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/cids');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin (requireRole(4))', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app).get('/api/cids').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });

  it('returns CID list for admin', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([FAKE_CID]),
      }),
    });
    app.locals.db = createDbMock({ cids: coll });

    const res = await request(app).get('/api/cids').set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/cids (method not allowed)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/cids').send({});
    expect(res.status).toBe(401);
  });

  it('returns 405 for admin (read-only endpoint)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/cids')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ Codigo_Tabulacao: 'B00' });
    expect(res.status).toBe(405);
  });
});

describe('PUT /api/cids/:id (method not allowed)', () => {
  it('returns 405 for admin', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .put('/api/cids/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ Descricao: 'Updated' });
    expect(res.status).toBe(405);
  });
});
