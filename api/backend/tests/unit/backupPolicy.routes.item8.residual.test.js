import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { getPolicy, updatePolicy, reloadBackupSchedule, loggerError } = vi.hoisted(() => ({
  getPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  reloadBackupSchedule: vi.fn(),
  loggerError: vi.fn(),
}));

// CommonJS dependencies are captured when the router is required, so patch
// the exported properties before loading the route instead of relying on
// vi.mock() interception.
const authModule = require('../../src/infrastructure/middleware/auth');
const rbacModule = require('../../src/infrastructure/middleware/rbac');
const backupPolicyService = require('../../src/services/backup-policy.service');
const schedulerService = require('../../src/services/scheduler.service');
const logger = require('../../src/utils/logger');

const originals = {
  authenticate: authModule.authenticate,
  requireRole: rbacModule.requireRole,
  getPolicy: backupPolicyService.getPolicy,
  updatePolicy: backupPolicyService.updatePolicy,
  reloadBackupSchedule: schedulerService.reloadBackupSchedule,
  loggerError: logger.error,
};

authModule.authenticate = (_req, _res, next) => next();
rbacModule.requireRole = () => (_req, _res, next) => next();
backupPolicyService.getPolicy = getPolicy;
backupPolicyService.updatePolicy = updatePolicy;
schedulerService.reloadBackupSchedule = reloadBackupSchedule;
logger.error = loggerError;

const router = require('../../src/interface/routes/backupPolicy.routes');

afterAll(() => {
  authModule.authenticate = originals.authenticate;
  rbacModule.requireRole = originals.requireRole;
  backupPolicyService.getPolicy = originals.getPolicy;
  backupPolicyService.updatePolicy = originals.updatePolicy;
  schedulerService.reloadBackupSchedule = originals.reloadBackupSchedule;
  logger.error = originals.loggerError;
});

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.app.locals.db = db;
    next();
  });
  app.use('/api/backup-policy', router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  getPolicy.mockResolvedValue({ cronExpression: '0 2 * * *' });
  updatePolicy.mockResolvedValue({
    merged: { cronExpression: '0 2 * * *' },
    changed: [],
  });
  reloadBackupSchedule.mockResolvedValue();
});

describe('backupPolicy.routes item 8 residual branches', () => {
  it('GET returns 503 when the database handle is absent', async () => {
    const response = await request(makeApp(null)).get('/api/backup-policy');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: 'Banco de dados não disponível',
    });
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it('GET maps Error and primitive failures without crashing the route', async () => {
    const db = {};

    getPolicy.mockRejectedValueOnce(new Error('read failed'));
    let response = await request(makeApp(db)).get('/api/backup-policy');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: 'Erro ao buscar política de backup',
      message: 'read failed',
    });

    getPolicy.mockRejectedValueOnce('primitive read failure');
    response = await request(makeApp(db)).get('/api/backup-policy');
    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Erro ao buscar política de backup');
    expect(loggerError).toHaveBeenLastCalledWith(
      'Erro ao buscar política de backup:',
      'primitive read failure'
    );
  });

  it('PUT returns 503 before reading or updating policy when db is absent', async () => {
    const response = await request(makeApp(null))
      .put('/api/backup-policy')
      .send({ cronExpression: '0 3 * * *' });

    expect(response.status).toBe(503);
    expect(getPolicy).not.toHaveBeenCalled();
    expect(updatePolicy).not.toHaveBeenCalled();
    expect(reloadBackupSchedule).not.toHaveBeenCalled();
  });

  it('PUT maps a generic policy update failure to 400 and does not reload the scheduler', async () => {
    const db = {};
    updatePolicy.mockRejectedValueOnce(new Error('write failed'));

    const response = await request(makeApp(db))
      .put('/api/backup-policy')
      .send({ retentionDays: 90 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: 'Erro ao atualizar política de backup',
      message: 'write failed',
    });
    expect(reloadBackupSchedule).not.toHaveBeenCalled();
  });

  it('PUT logs primitive failures through the logger fallback branch', async () => {
    const db = {};
    updatePolicy.mockRejectedValueOnce('primitive write failure');

    const response = await request(makeApp(db))
      .put('/api/backup-policy')
      .send({ retentionDays: 90 });

    expect(response.status).toBe(400);
    expect(loggerError).toHaveBeenLastCalledWith(
      'Erro ao atualizar política de backup:',
      'primitive write failure'
    );
  });
});
