import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../src/infrastructure/middleware/auth', () => ({
  authenticate: (_req, _res, next) => next(),
}));

vi.mock('../../src/infrastructure/middleware/rbac', () => ({
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/services/backup-policy.service', () => ({
  getPolicy,
  updatePolicy,
}));

vi.mock('../../src/services/scheduler.service', () => ({
  reloadBackupSchedule,
}));

vi.mock('../../src/utils/logger', () => ({
  error: loggerError,
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

const router = require('../../src/interface/routes/backupPolicy.routes');

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
