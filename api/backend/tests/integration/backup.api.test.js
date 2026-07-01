import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const backupService = require('../../src/services/backup.service');
const { createDbMock } = require('../factories/db.factory');

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

beforeEach(() => {
  givenSession();
  app.locals.db = createDbMock({});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('POST /api/backup/perform', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/backup/perform');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin (accessType 2)', async () => {
    const res = await request(app)
      .post('/api/backup/perform')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });

  it('returns backup result for admin', async () => {
    vi.spyOn(backupService, 'runBackup').mockResolvedValue({ success: true, path: '/backups/2026-06-30', size: 1024 });

    const res = await request(app)
      .post('/api/backup/perform')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when backup fails', async () => {
    vi.spyOn(backupService, 'runBackup').mockResolvedValue({ success: false, error: 'Disco cheio' });

    const res = await request(app)
      .post('/api/backup/perform')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/backup/list', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/backup/list');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/backup/list')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });

  it('returns empty list when backup dir does not exist', async () => {
    vi.spyOn(backupService, 'getBackupBaseDir').mockReturnValue('/nonexistent/path/backups');

    const res = await request(app)
      .get('/api/backup/list')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/backup/restore/:fileName', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/backup/restore/backup-2026-06-30');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/backup/restore/backup-2026-06-30')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 when backup file not found', async () => {
    vi.spyOn(backupService, 'getBackupBaseDir').mockReturnValue('/nonexistent/path/backups');

    const res = await request(app)
      .post('/api/backup/restore/backup-2026-06-30')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(404);
  });
});
