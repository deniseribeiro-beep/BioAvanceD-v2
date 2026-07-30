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
    app.locals.db = createDbMock({ organizations: coll });

    const res = await request(app)
      .get('/api/organizations')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
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
    app.locals.db = createDbMock({ organizations: coll });

    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ officialName: 'USF', countryCode: 'BR' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 for missing required fields', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({});

    expect(res.status).toBe(400);
  });
});
