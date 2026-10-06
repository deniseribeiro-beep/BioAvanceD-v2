import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

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

describe('GET /api/organizations', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/organizations');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const org = { organizationId: 'org-1', officialName: 'Universidade São Francisco', countryCode: 'BR' };
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([org]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
    });
    app.locals.db = createDbMock({
      organizations: coll,
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });

    const res = await request(app)
      .get('/api/organizations')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // #1280: without an offset no client could read past the 500th row.
  describe('paging (#1280)', () => {
    function givenCursor() {
      const cursor = {
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      };
      app.locals.db = createDbMock({
        organizations: createCollectionMock({ find: vi.fn().mockReturnValue(cursor) }),
        ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
      });
      return cursor;
    }

    it('applies skip and limit over a name order with _id as the tie-break', async () => {
      const cursor = givenCursor();

      const res = await request(app)
        .get('/api/organizations?limit=500&skip=500')
        .set('Authorization', `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(cursor.sort).toHaveBeenCalledWith({ officialName: 1, _id: 1 });
      expect(cursor.skip).toHaveBeenCalledWith(500);
      expect(cursor.limit).toHaveBeenCalledWith(500);
    });

    it.each([
      ['', 0, 100],
      ['?skip=-5&limit=9999', 0, 500],
      ['?skip=abc&limit=0', 0, 100],
      ['?skip=2.7', 2, 100],
    ])('normalizes %s to skip %i, limit %i', async (query, skip, limit) => {
      const cursor = givenCursor();

      const res = await request(app)
        .get(`/api/organizations${query}`)
        .set('Authorization', `Bearer ${makeToken()}`);

      expect(res.status).toBe(200);
      expect(cursor.skip).toHaveBeenCalledWith(skip);
      expect(cursor.limit).toHaveBeenCalledWith(limit);
    });
  });
});

describe('GET /api/organizations/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/organizations/org-1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when the organization does not exist', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({
      organizations: coll,
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });

    const res = await request(app)
      .get('/api/organizations/org-missing')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(404);
  });

  it('returns the organization for an authenticated user', async () => {
    const existing = { organizationId: 'org-1', officialName: 'USF', countryCode: 'BR' };
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(existing) });
    app.locals.db = createDbMock({
      organizations: coll,
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });

    const res = await request(app)
      .get('/api/organizations/org-1')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.organizationId).toBe('org-1');
  });
});

describe('POST /api/organizations', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/organizations').send({ officialName: 'USF', countryCode: 'BR' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a role below Administrador', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 3 }]),
    });

    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ officialName: 'USF', countryCode: 'BR' });

    expect(res.status).toBe(403);
  });

  it('creates an organization for an Administrador', async () => {
    const created = { organizationId: 'org-1', officialName: 'USF', normalizedName: 'USF', countryCode: 'BR' };
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null).mockResolvedValueOnce(null).mockResolvedValueOnce(created),
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
    });
    app.locals.db = createDbMock({
      organizations: coll,
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });

    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ officialName: 'USF', countryCode: 'BR' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
  });

  it('returns 422 for missing required fields', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });
    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({});

    expect(res.status).toBe(422);
  });
});

describe('PUT /api/organizations/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/organizations/org-1').send({ officialName: 'USF' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a role below Administrador', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 3 }]),
    });

    const res = await request(app)
      .put('/api/organizations/org-1')
      .set('Authorization', `Bearer ${makeToken(3)}`)
      .send({ officialName: 'USF' });

    expect(res.status).toBe(403);
  });

  it('returns 404 when the organization does not exist', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({
      organizations: coll,
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });

    const res = await request(app)
      .put('/api/organizations/org-missing')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ officialName: 'USF' });

    expect(res.status).toBe(404);
  });

  it('updates an organization for an Administrador', async () => {
    const existing = { organizationId: 'org-1', officialName: 'USF', countryCode: 'BR' };
    const updated = { ...existing, website: 'https://www.usf.edu.br' };
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(existing),
      findOneAndUpdate: vi.fn().mockResolvedValue(updated),
    });
    app.locals.db = createDbMock({
      organizations: coll,
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });

    const res = await request(app)
      .put('/api/organizations/org-1')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ website: 'https://www.usf.edu.br' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.website).toBe('https://www.usf.edu.br');
    expect(coll.findOneAndUpdate).toHaveBeenCalled();
  });

  it('returns 422 when the merged payload is invalid', async () => {
    const existing = { organizationId: 'org-1', officialName: 'USF', countryCode: 'BR' };
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(existing) });
    app.locals.db = createDbMock({
      organizations: coll,
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });

    const res = await request(app)
      .put('/api/organizations/org-1')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ countryCode: 'BRA' });

    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/organizations/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/organizations/org-1');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a role below Administrador', async () => {
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 3 }]),
    });

    const res = await request(app)
      .delete('/api/organizations/org-1')
      .set('Authorization', `Bearer ${makeToken(3)}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 when the organization does not exist', async () => {
    const coll = createCollectionMock({ deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }) });
    app.locals.db = createDbMock({
      organizations: coll,
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });

    const res = await request(app)
      .delete('/api/organizations/org-missing')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(404);
  });

  it('deletes an organization for an Administrador', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: 'mongo-org-1', organizationId: 'org-1' }),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    app.locals.db = createDbMock({
      organizations: coll,
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });

    const res = await request(app)
      .delete('/api/organizations/org-1')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(coll.deleteOne).toHaveBeenCalledWith({ _id: 'mongo-org-1' });
  });

  // #1284: the delete used to orphan every record naming the organization.
  it('refuses with 409 and names the collections while records reference the organization', async () => {
    const coll = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: 'mongo-org-1', organizationId: 'org-uuid-1' }),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    const equipment = createCollectionMock({ countDocuments: vi.fn().mockResolvedValue(1) });
    const users = createCollectionMock({ countDocuments: vi.fn().mockResolvedValue(1) });
    const samples = createCollectionMock({ countDocuments: vi.fn().mockResolvedValue(0) });
    app.locals.db = createDbMock({
      organizations: coll,
      equipment,
      users,
      samples,
      ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
    });

    const res = await request(app)
      .delete('/api/organizations/mongo-org-1')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(409);
    expect(res.body.references).toEqual(['equipment', 'users']);
    expect(coll.deleteOne).not.toHaveBeenCalled();
    // References carry Organization.organizationId, never the Mongo _id.
    expect(equipment.countDocuments).toHaveBeenCalledWith({ organizationId: 'org-uuid-1' }, { limit: 1 });
    expect(users.countDocuments).toHaveBeenCalledWith(
      { $or: [{ organizationId: 'org-uuid-1' }, { organizationIds: 'org-uuid-1' }] },
      { limit: 1 }
    );
    expect(samples.countDocuments).toHaveBeenCalledWith({ collectionSite: 'org-uuid-1' }, { limit: 1 });
  });
});
