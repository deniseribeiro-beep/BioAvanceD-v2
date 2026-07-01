import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const logService = require('../../src/services/log.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');

function makeToken(accessType = 4, roleName = 'Administrador') {
  return jwt.sign(
    { userID: 'qa-admin-1', accessType, roleName, name: 'QA Admin', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

const FAKE_LOGS = [
  { logId: 'l1', action: 'CREATE', entity: 'Sample', result: 'success', severity: 'info', timestamp: new Date().toISOString() },
];

describe('GET /api/logs', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/logs');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin/non-auditor user (accessType 2, Técnico)', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${makeToken(2, 'Técnico')}`);
    expect(res.status).toBe(403);
  });

  it('returns log list for admin user', async () => {
    vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: FAKE_LOGS, total: 1, page: 1, totalPages: 1 });
    app.locals.db = createDbMock({});

    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${makeToken(4, 'Administrador')}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/logs/register', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/logs/register').send({ action: 'TEST' });
    expect(res.status).toBe(401);
  });

  it('registers a log entry for any authenticated user', async () => {
    vi.spyOn(logService, 'createLog').mockResolvedValue({ logId: 'new-log', action: 'TEST' });
    app.locals.db = createDbMock({});

    const res = await request(app)
      .post('/api/logs/register')
      .set('Authorization', `Bearer ${makeToken(2, 'Técnico')}`)
      .send({ action: 'TEST', entity: 'Sample', result: 'success' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/logs/export/csv', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 403 for non-admin user', async () => {
    app.locals.db = createDbMock({});
    const res = await request(app)
      .get('/api/logs/export/csv')
      .set('Authorization', `Bearer ${makeToken(2, 'Técnico')}`);
    expect(res.status).toBe(403);
  });

  it('returns CSV content for admin', async () => {
    vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: FAKE_LOGS, total: 1 });
    app.locals.db = createDbMock({});

    const res = await request(app)
      .get('/api/logs/export/csv')
      .set('Authorization', `Bearer ${makeToken(4, 'Administrador')}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });
});
