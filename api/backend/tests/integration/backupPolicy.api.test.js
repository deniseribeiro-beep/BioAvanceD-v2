import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const scheduler = require('../../src/services/scheduler.service');
const { createDbMock, createCollectionMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

// #728: /api/backup-policy is gated by requireRole(4) directly (mirroring
// security.routes.js's own singleton-config gate), not a granular
// manageX permission -- only Administrador (accessType 4) should pass.
const USER_BY_ACCESS_TYPE = { 2: 'qa-tech-1', 3: 'qa-coord-1', 4: 'qa-admin-1' };
const ROLE_BY_ACCESS_TYPE = { 2: 'Tecnico', 3: 'Coordenador', 4: 'Administrador' };

function makeToken(accessType) {
  const userID = USER_BY_ACCESS_TYPE[accessType];
  return jwt.sign(
    { userID, accessType, roleName: ROLE_BY_ACCESS_TYPE[accessType], name: 'QA User', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function dbWithPolicy(overrides = {}) {
  return createDbMock({
    ...buildRbacCollections([
      { userAccountId: 'qa-tech-1', accessType: 2 },
      { userAccountId: 'qa-coord-1', accessType: 3 },
      { userAccountId: 'qa-admin-1', accessType: 4 },
    ]),
    ...overrides,
  });
}

beforeEach(() => {
  givenSession();
  app.locals.db = dbWithPolicy();
  vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'log').mockResolvedValue({});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/backup-policy', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/backup-policy');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a Coordenador (below Administrador)', async () => {
    const res = await request(app)
      .get('/api/backup-policy')
      .set('Authorization', `Bearer ${makeToken(3)}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 with the default policy for an Administrador', async () => {
    const res = await request(app)
      .get('/api/backup-policy')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.retentionDays).toBeGreaterThanOrEqual(30);
    expect(res.body.data.rpoHours).toBe(24);
    expect(res.body.data.rtoHours).toBe(12);
  });

  it('returns the persisted policy when one already exists', async () => {
    app.locals.db = dbWithPolicy({
      backup_policy: createCollectionMock({
        findOne: vi.fn().mockResolvedValue({
          _id: 'main',
          cronExpression: '0 4 * * *',
          retentionDays: 60,
          encryptionEnabled: true,
          rpoHours: 12,
          rtoHours: 6,
        }),
      }),
    });

    const res = await request(app)
      .get('/api/backup-policy')
      .set('Authorization', `Bearer ${makeToken(4)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.retentionDays).toBe(60);
    expect(res.body.data.cronExpression).toBe('0 4 * * *');
  });
});

describe('PUT /api/backup-policy', () => {
  it('returns 403 for a Tecnico', async () => {
    const res = await request(app)
      .put('/api/backup-policy')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ retentionDays: 60 });
    expect(res.status).toBe(403);
  });

  it('returns 422 for a payload violating RNF010 (retentionDays < 30)', async () => {
    const res = await request(app)
      .put('/api/backup-policy')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ retentionDays: 10 });

    expect(res.status).toBe(422);
    expect(res.body.details.join(' ')).toMatch(/retentionDays/);
  });

  it('updates the policy and logs an audit entry for an Administrador', async () => {
    const updateOne = vi.fn().mockResolvedValue({});
    app.locals.db = dbWithPolicy({
      backup_policy: createCollectionMock({
        findOne: vi.fn().mockResolvedValue({ _id: 'main', ...require('../../src/services/backup-policy.service').getDefaultPolicy() }),
        updateOne,
      }),
    });

    const res = await request(app)
      .put('/api/backup-policy')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ retentionDays: 90 });

    expect(res.status).toBe(200);
    expect(res.body.data.retentionDays).toBe(90);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'BackupPolicy',
      payload: expect.objectContaining({ field: 'retentionDays', newValue: 90 }),
    }));
  });

  it('hot-reloads the running cron schedule when cronExpression changes', async () => {
    const reloadSpy = vi.spyOn(scheduler, 'reloadBackupSchedule').mockResolvedValue();
    app.locals.db = dbWithPolicy({
      backup_policy: createCollectionMock({
        findOne: vi.fn().mockResolvedValue({ _id: 'main', ...require('../../src/services/backup-policy.service').getDefaultPolicy() }),
        updateOne: vi.fn().mockResolvedValue({}),
      }),
    });

    const res = await request(app)
      .put('/api/backup-policy')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ cronExpression: '0 5 * * *' });

    expect(res.status).toBe(200);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('does not hot-reload the schedule when cronExpression is unchanged', async () => {
    const reloadSpy = vi.spyOn(scheduler, 'reloadBackupSchedule').mockResolvedValue();
    const defaultPolicy = require('../../src/services/backup-policy.service').getDefaultPolicy();
    app.locals.db = dbWithPolicy({
      backup_policy: createCollectionMock({
        findOne: vi.fn().mockResolvedValue({ _id: 'main', ...defaultPolicy }),
        updateOne: vi.fn().mockResolvedValue({}),
      }),
    });

    const res = await request(app)
      .put('/api/backup-policy')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ retentionDays: 90 });

    expect(res.status).toBe(200);
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
