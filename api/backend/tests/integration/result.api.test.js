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

const FAKE_RESULT = {
  _id: 'result-1',
  sampleID: 'SAMPLE-001',
  fileName: 'result_abc123.pdf',
  fileType: 'PDF',
  uploadedAt: new Date().toISOString(),
};

describe('GET /api/results', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/results');
    expect(res.status).toBe(401);
  });

  it('returns result list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([FAKE_RESULT]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
    });
    app.locals.db = createDbMock({ results: coll });

    const res = await request(app)
      .get('/api/results')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters results by importJobID when provided', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([FAKE_RESULT]),
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      }),
    });
    app.locals.db = createDbMock({ results: coll });

    const res = await request(app)
      .get('/api/results?importJobID=job-123')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/results/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/results/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('returns 404 when result not found', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ results: coll });

    const res = await request(app)
      .get('/api/results/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });

  it('returns a result by id', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_RESULT) });
    app.locals.db = createDbMock({ results: coll });

    const res = await request(app)
      .get('/api/results/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('DELETE /api/results/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/results/507f1f77bcf86cd799439011');
    expect(res.status).toBe(401);
  });

  it('returns 403 for user without deleteResult permission (accessType 1)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .delete('/api/results/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(1)}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 when result not found', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ results: coll });

    const res = await request(app)
      .delete('/api/results/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect([404, 400]).toContain(res.status);
  });
});
