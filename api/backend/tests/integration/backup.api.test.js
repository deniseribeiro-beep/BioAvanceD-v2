import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const backupService = require('../../src/services/backup.service');
const { createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #421: enforcement resolves permissions via UserRoleAssignment -> Role ->
// Permission, keyed by userID — not accessType off the JWT directly. Give
// the admin userID a real accessType-4 assignment (backup routes are
// admin-only); the "non-admin" token below uses a distinct userID with no
// assignment at all, so it's denied regardless of its accessType claim.
function makeToken(accessType = 4) {
  const userID = accessType === 4 ? 'qa-admin-1' : 'qa-user-non-admin';
  return jwt.sign(
    { userID, accessType, roleName: accessType === 4 ? 'Administrador' : 'Técnico', name: 'QA Admin', mfaVerified: true },
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
  app.locals.db = createDbMock({
    ...buildRbacCollections([{ userAccountId: 'qa-admin-1', accessType: 4 }]),
  });
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

  it('returns 500 when runBackup throws', async () => {
    vi.spyOn(backupService, 'runBackup').mockRejectedValue(new Error('disk full'));

    const res = await request(app)
      .post('/api/backup/perform')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('falls back to a default error message when backup fails without an error field', async () => {
    vi.spyOn(backupService, 'runBackup').mockResolvedValue({ success: false });

    const res = await request(app)
      .post('/api/backup/perform')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Não foi possível executar backup');
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

  it('lists backup directories with computed size, sorted newest first', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-list-'));
    const older = path.join(baseDir, 'backup-old');
    const newer = path.join(baseDir, 'backup-new');
    fs.mkdirSync(older);
    fs.mkdirSync(newer);
    fs.writeFileSync(path.join(older, 'a.bson'), 'x'.repeat(10));
    fs.writeFileSync(path.join(newer, 'b.bson'), 'x'.repeat(20));
    // ensure distinct, ordered birthtimes regardless of filesystem resolution
    const past = new Date(Date.now() - 60_000);
    const now = new Date();
    fs.utimesSync(older, past, past);
    fs.utimesSync(newer, now, now);

    vi.spyOn(backupService, 'getBackupBaseDir').mockReturnValue(baseDir);

    const res = await request(app)
      .get('/api/backup/list')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((d) => d.fileName)).toEqual(['backup-new', 'backup-old']);
    expect(res.body.data.find((d) => d.fileName === 'backup-old').size).toBe(10);
    expect(res.body.data.find((d) => d.fileName === 'backup-new').size).toBe(20);

    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('returns 500 when listing throws', async () => {
    vi.spyOn(backupService, 'getBackupBaseDir').mockImplementation(() => {
      throw new Error('fs unavailable');
    });

    const res = await request(app)
      .get('/api/backup/list')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
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

  it('returns 400 fileName inválido when the param reduces to an empty basename', async () => {
    const res = await request(app)
      .post('/api/backup/restore/%2F')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    // '%2F' decodes to '/', whose basename() is '' — hits the fileName-empty guard
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('fileName inválido');
  });

  it('strips path segments from a traversal-style fileName (basename sanitization)', async () => {
    vi.spyOn(backupService, 'getBackupBaseDir').mockReturnValue('/nonexistent/path/backups');

    const res = await request(app)
      .post('/api/backup/restore/' + encodeURIComponent('../../etc/passwd'))
      .set('Authorization', `Bearer ${makeToken(4)}`);

    // basename() reduces the traversal to just "passwd", which then 404s under the base dir
    expect(res.status).toBe(404);
  });

  it('restores successfully when backup file exists', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-'));
    fs.writeFileSync(path.join(baseDir, 'backup-2026-06-30'), 'dump-contents');
    vi.spyOn(backupService, 'getBackupBaseDir').mockReturnValue(baseDir);
    vi.spyOn(backupService, 'restoreBackup').mockResolvedValue({ success: true, restored: 'backup-2026-06-30' });

    const res = await request(app)
      .post('/api/backup/restore/backup-2026-06-30')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('returns 400 when restoreBackup reports failure', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-'));
    fs.writeFileSync(path.join(baseDir, 'backup-2026-06-30'), 'dump-contents');
    vi.spyOn(backupService, 'getBackupBaseDir').mockReturnValue(baseDir);
    vi.spyOn(backupService, 'restoreBackup').mockResolvedValue({ success: false, error: 'corrupted archive' });

    const res = await request(app)
      .post('/api/backup/restore/backup-2026-06-30')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);

    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('returns 500 when restore throws', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-'));
    fs.writeFileSync(path.join(baseDir, 'backup-2026-06-30'), 'dump-contents');
    vi.spyOn(backupService, 'getBackupBaseDir').mockReturnValue(baseDir);
    vi.spyOn(backupService, 'restoreBackup').mockRejectedValue(new Error('mongorestore failed'));

    const res = await request(app)
      .post('/api/backup/restore/backup-2026-06-30')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);

    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('falls back to a default error message when restoreBackup reports failure without an error field', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-'));
    fs.writeFileSync(path.join(baseDir, 'backup-2026-06-30'), 'dump-contents');
    vi.spyOn(backupService, 'getBackupBaseDir').mockReturnValue(baseDir);
    vi.spyOn(backupService, 'restoreBackup').mockResolvedValue({ success: false });

    const res = await request(app)
      .post('/api/backup/restore/backup-2026-06-30')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Erro ao restaurar backup');

    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('falls back to String(error) when restoreBackup rejects with a non-Error value', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-restore-'));
    fs.writeFileSync(path.join(baseDir, 'backup-2026-06-30'), 'dump-contents');
    vi.spyOn(backupService, 'getBackupBaseDir').mockReturnValue(baseDir);
    vi.spyOn(backupService, 'restoreBackup').mockRejectedValue('boom');

    const res = await request(app)
      .post('/api/backup/restore/backup-2026-06-30')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('boom');

    fs.rmSync(baseDir, { recursive: true, force: true });
  });
});
