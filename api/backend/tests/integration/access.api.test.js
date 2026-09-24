import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


// #421: enforcement resolves permissions purely by req.user.userID (via
// UserRoleAssignment), ignoring accessType/roleName carried in the JWT.
// Different accessType levels therefore need distinct userIDs so each one
// resolves to the correct seeded role.
function makeToken(accessType = 4) {
  return makeAuthToken(accessType);
}

const rbacCollections = buildRbacCollections([
  { userAccountId: TEST_USER_ACCOUNT_IDS[2], accessType: 2 },
  { userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType: 4 },
]);

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

const FAKE_ACCESS = { _id: '507f1f77bcf86cd799439011', reportID: 1, reportType: 'SampleReport', accessType: 1 };
const VALID_PAYLOAD = { reportID: 42, reportType: 'SampleReport', accessType: 1 };

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/access', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/access');
    expect(res.status).toBe(401);
  });

  it('returns access list for authenticated user', async () => {
    const coll = createCollectionMock({ find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([FAKE_ACCESS]) }) });
    app.locals.db = createDbMock({ access: coll, ...rbacCollections });

    const res = await request(app).get('/api/access').set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/access/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/access/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('returns 404 when not found', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ access: coll, ...rbacCollections });

    const res = await request(app)
      .get('/api/access/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(404);
  });

  it('returns access by id', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_ACCESS) });
    app.locals.db = createDbMock({ access: coll, ...rbacCollections });

    const res = await request(app)
      .get('/api/access/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/access', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/access').send(VALID_PAYLOAD);
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico (no createUser permission)', async () => {
    app.locals.db = createDbMock({ ...rbacCollections });
    const res = await request(app)
      .post('/api/access')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send(VALID_PAYLOAD);
    expect(res.status).toBe(403);
  });

  it('returns 422 for invalid payload (missing reportID)', async () => {
    app.locals.db = createDbMock({ ...rbacCollections });
    const res = await request(app)
      .post('/api/access')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ reportType: 'SampleReport' });
    expect(res.status).toBe(422);
  });

  it('creates access for admin', async () => {
    const coll = createCollectionMock({
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
    });
    app.locals.db = createDbMock({ access: coll, ...rbacCollections });

    const res = await request(app)
      .post('/api/access')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(VALID_PAYLOAD);
    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
  });
});

describe('PUT /api/access/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/access/507f1f77bcf86cd799439011').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico', async () => {
    app.locals.db = createDbMock({ ...rbacCollections });
    const res = await request(app)
      .put('/api/access/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ reportType: 'Updated' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when not found', async () => {
    const coll = createCollectionMock({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) });
    app.locals.db = createDbMock({ access: coll, ...rbacCollections });

    const res = await request(app)
      .put('/api/access/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ reportType: 'Updated' });
    expect(res.status).toBe(404);
  });

  it('updates access for admin', async () => {
    const coll = createCollectionMock({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
    app.locals.db = createDbMock({ access: coll, ...rbacCollections });

    const res = await request(app)
      .put('/api/access/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ reportType: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // #875: PUT /:id used to $set req.body verbatim -- an unfiltered or
  // under-filtered body could inject arbitrary keys or overwrite identity
  // fields. Only AccessModel.create()'s own fields (minus accessID, which
  // is business identity) may reach $set.
  it('#875: filters $set to the AccessModel allowlist, dropping injected/identity keys', async () => {
    const coll = createCollectionMock({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) });
    app.locals.db = createDbMock({ access: coll, ...rbacCollections });

    const res = await request(app)
      .put('/api/access/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ expiresAt: '2030-01-01T00:00:00.000Z', injected: 'x', accessID: 999 });

    expect(res.status).toBe(200);
    const setArg = coll.updateOne.mock.calls[0][1].$set;
    expect(setArg).toHaveProperty('expiresAt');
    expect(setArg).toHaveProperty('updatedAt');
    expect(setArg).not.toHaveProperty('injected');
    expect(setArg).not.toHaveProperty('accessID');
    expect(Object.keys(setArg).sort()).toEqual(['expiresAt', 'updatedAt']);
  });
});

describe('DELETE /api/access/:id', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/access/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('returns 403 for Técnico', async () => {
    app.locals.db = createDbMock({ ...rbacCollections });
    const res = await request(app)
      .delete('/api/access/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 when not found', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }) });
    app.locals.db = createDbMock({ access: coll, ...rbacCollections });

    const res = await request(app)
      .delete('/api/access/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(404);
  });

  it('deletes access for admin', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }) });
    app.locals.db = createDbMock({ access: coll, ...rbacCollections });

    const res = await request(app)
      .delete('/api/access/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
