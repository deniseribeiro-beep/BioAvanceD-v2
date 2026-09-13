import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const cidService = require('../../src/services/cid.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-1', accessType, roleName: 'Administrador', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// #421: enforcement resolves permissions via UserRoleAssignment -> Role ->
// Permission, keyed by userID — reproduce a real assignment matching
// whichever accessType the test's token carries so the mock behaves exactly
// like the old accessType-based checks did.
function dbWithRbac(collections = {}, accessType = 4) {
  return createDbMock({
    ...collections,
    ...buildRbacCollections([{ userAccountId: 'qa-1', accessType }]),
  });
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
    app.locals.db = dbWithRbac({}, 2);
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
    app.locals.db = dbWithRbac({ cids: coll }, 4);

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
    app.locals.db = dbWithRbac({}, 4);
    const res = await request(app)
      .post('/api/cids')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ Codigo_Tabulacao: 'B00' });
    expect(res.status).toBe(405);
  });
});

describe('PUT /api/cids/:id (method not allowed)', () => {
  it('returns 405 for admin', async () => {
    app.locals.db = dbWithRbac({}, 4);
    const res = await request(app)
      .put('/api/cids/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ Descricao: 'Updated' });
    expect(res.status).toBe(405);
  });
});

describe('GET /api/cids/search', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/cids/search').query({ q: 'colera' });
    expect(res.status).toBe(401);
  });

  it('returns an empty paginated envelope for a query shorter than 2 chars, without calling the service', async () => {
    app.locals.db = dbWithRbac({}, 2);
    const spy = vi.spyOn(cidService, 'searchPaginated');

    const res = await request(app)
      .get('/api/cids/search')
      .query({ q: 'a', page: 2, limit: 5 })
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [],
      pagination: { page: 2, limit: 5, total: 0, totalPages: 0, hasNext: false, hasPrev: false, query: 'a' },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('defaults page/limit and trims the query when delegating to the service', async () => {
    app.locals.db = dbWithRbac({}, 2);
    const fakeResult = {
      items: [FAKE_CID],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1, hasNext: false, hasPrev: false, query: 'colera' },
    };
    vi.spyOn(cidService, 'searchPaginated').mockResolvedValue(fakeResult);

    const res = await request(app)
      .get('/api/cids/search')
      .query({ q: '  colera  ' })
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeResult);
    expect(cidService.searchPaginated).toHaveBeenCalledWith(app.locals.db, 'colera', 1, 10);
  });

  it('returns 500 with the error message when the service throws', async () => {
    app.locals.db = dbWithRbac({}, 2);
    vi.spyOn(cidService, 'searchPaginated').mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/cids/search')
      .query({ q: 'colera' })
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: 'Erro ao buscar CIDs',
      message: 'boom',
    });
  });
});
