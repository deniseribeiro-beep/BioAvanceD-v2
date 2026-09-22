import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);
const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/interface/routes/user.routes.js');

let currentAuth = defaultAuth;
let currentRequirePermission = () => (req, res, next) => next();

function defaultAuth(req, res, next) {
  req.user = { userID: 'caller-1', roleName: 'Administrador' };
  req.t = (key) => key;
  next();
}

const authModule = require(authPath);
authModule.authenticate = (req, res, next) => currentAuth(req, res, next);

const rbacModule = require(rbacPath);
rbacModule.requirePermission = (...args) => (req, res, next) =>
  currentRequirePermission(...args)(req, res, next);

const router = require(routePath);

function loadRoute({ authImpl, requirePermissionImpl } = {}) {
  currentAuth = authImpl || defaultAuth;
  currentRequirePermission = requirePermissionImpl || (() => (req, res, next) => next());
  return router;
}

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.use('/api/users', router);
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
  loadRoute();
});

describe('user.routes item 8 legitimate residual branches', () => {
  it('rejects unknown organizations and hierarchy escalation during registration', async () => {
    const authService = require('../../src/services/auth.service');
    const rbacAssignment = require('../../src/services/rbac-assignment.service');
    const registerUser = vi.spyOn(authService, 'registerUser');

    const organizations = { findOne: vi.fn().mockResolvedValue(null) };
    let app = buildApp({ collection: (name) => name === 'organizations' ? organizations : {} });

    const missingOrg = await request(app).post('/api/users/register').send({
      username: 'synthetic',
      organizationId: 'ORG-MISSING',
    });
    expect(missingOrg.status).toBe(400);
    expect(missingOrg.body.message).toContain('organizationId ORG-MISSING não encontrado');
    expect(registerUser).not.toHaveBeenCalled();

    organizations.findOne.mockResolvedValue({ organizationId: 'ORG-1' });
    vi.spyOn(authService, 'getAccessTypeForRole').mockReturnValue(5);
    vi.spyOn(rbacAssignment, 'resolveUserHierarchyLevel').mockResolvedValue(3);

    app = buildApp({ collection: (name) => name === 'organizations' ? organizations : {} });
    const escalation = await request(app).post('/api/users/register').send({
      username: 'synthetic',
      organizationId: 'ORG-1',
      roleName: 'Administrador',
    });

    expect(escalation.status).toBe(403);
    expect(escalation.body.message).toContain('nível de acesso superior');
    expect(registerUser).not.toHaveBeenCalled();
  });

  it('registers a user with an existing organization and writes the explicit audit record', async () => {
    const authService = require('../../src/services/auth.service');
    const rbacAssignment = require('../../src/services/rbac-assignment.service');
    const auditLogger = require('../../src/utils/auditLogger');

    vi.spyOn(authService, 'registerUser').mockResolvedValue({ _id: 'new-user', username: 'synthetic' });
    vi.spyOn(rbacAssignment, 'resolveUserHierarchyLevel').mockResolvedValue(5);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const log = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const db = {
      collection: (name) => {
        if (name === 'organizations') return { findOne: vi.fn().mockResolvedValue({ organizationId: 'ORG-1' }) };
        return {};
      },
    };
    const app = buildApp(db);

    const res = await request(app).post('/api/users/register').send({
      username: 'synthetic',
      organizationId: ' ORG-1 ',
      accessType: 3,
    });

    expect(res.status).toBe(201);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      resourceType: 'User',
      resourceId: 'new-user',
    }));
  });

  it('covers delete not-found, success and collection failure branches', async () => {
    const auditLogger = require('../../src/utils/auditLogger');
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logDelete = vi.spyOn(auditLogger, 'logDelete').mockResolvedValue(undefined);

    const deleteOne = vi.fn()
      .mockResolvedValueOnce({ deletedCount: 0 })
      .mockResolvedValueOnce({ deletedCount: 1 })
      .mockRejectedValueOnce(new Error('delete-boom'));
    const db = { collection: () => ({ deleteOne }) };
    const app = buildApp(db);

    const missing = await request(app).delete('/api/users/missing');
    const ok = await request(app).delete('/api/users/u1');
    const failed = await request(app).delete('/api/users/u2');

    expect(missing.status).toBe(404);
    expect(ok.status).toBe(200);
    expect(logDelete).toHaveBeenCalledWith(expect.anything(), 'User', 'u1');
    expect(failed.status).toBe(400);
    expect(failed.body.message).toBe('delete-boom');
  });

  it('covers validate-status not-found, default status, explicit status and failure', async () => {
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'u1' })
      .mockResolvedValueOnce({ _id: 'u2', status: 'active' })
      .mockRejectedValueOnce(new Error('status-boom'));
    const app = buildApp({ collection: () => ({ findOne }) });

    const missing = await request(app).get('/api/users/missing/validate-status');
    const fallback = await request(app).get('/api/users/u1/validate-status');
    const active = await request(app).get('/api/users/u2/validate-status');
    const failed = await request(app).get('/api/users/u3/validate-status');

    expect(missing.status).toBe(404);
    expect(fallback.body.data.status).toBe('inactive');
    expect(active.body.data.status).toBe('active');
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('status-boom');
  });

  it('covers patient and sensor registration success and failure branches', async () => {
    const patientService = require('../../src/services/patient.service');
    const sensorService = require('../../src/services/sensor.service');
    vi.spyOn(patientService, 'createPatient')
      .mockResolvedValueOnce({ participantId: 'P-1' })
      .mockRejectedValueOnce(new Error('patient-boom'));
    vi.spyOn(sensorService, 'createSensor')
      .mockResolvedValueOnce({ sensorId: 'S-1' })
      .mockRejectedValueOnce(new Error('sensor-boom'));

    const db = {};
    const app = buildApp(db);

    const patientOk = await request(app).post('/api/users/register-patient').send({ participantId: 'P-1' });
    const patientFail = await request(app).post('/api/users/register-patient').send({});
    const sensorOk = await request(app).post('/api/users/register-sensor').send({ sensorId: 'S-1' });
    const sensorFail = await request(app).post('/api/users/register-sensor').send({});

    expect(patientOk.status).toBe(201);
    expect(patientFail.status).toBe(400);
    expect(patientFail.body.message).toBe('patient-boom');
    expect(sensorOk.status).toBe(201);
    expect(sensorFail.status).toBe(400);
    expect(sensorFail.body.message).toBe('sensor-boom');
  });

  it('covers report filter fallback, explicit filters and insertion failure', async () => {
    const reports = {
      insertOne: vi.fn()
        .mockResolvedValueOnce({ insertedId: 'r1' })
        .mockResolvedValueOnce({ insertedId: 'r2' })
        .mockRejectedValueOnce(new Error('report-boom')),
    };
    const app = buildApp({ collection: (name) => name === 'reports' ? reports : {} });

    const noFilters = await request(app).post('/api/users/generate-report').send({ reportType: 'summary' });
    const withFilters = await request(app).post('/api/users/generate-report').send({
      reportType: 'summary',
      filters: { status: 'active' },
    });
    const failed = await request(app).post('/api/users/generate-report').send({ reportType: 'summary' });

    expect(noFilters.status).toBe(201);
    expect(noFilters.body.data.filters).toEqual({});
    expect(withFilters.status).toBe(201);
    expect(withFilters.body.data.filters).toEqual({ status: 'active' });
    expect(failed.status).toBe(400);
    expect(failed.body.message).toBe('report-boom');
  });

  it('covers withdrawal missing id, successful withdrawal and validation failure', async () => {
    const consentValidator = require('../../src/services/consent.validator');
    const sampleService = require('../../src/services/sample.service');
    vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
    const validateAccess = vi.spyOn(consentValidator, 'validateAccess')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('consent-boom'));
    vi.spyOn(sampleService, 'withdrawSample').mockResolvedValue({ movementID: 'M-1' });

    const app = buildApp({});
    const missing = await request(app).post('/api/users/record-withdrawal').send({});
    expect(missing.status).toBe(400);

    const specimenId = '507f1f77bcf86cd799439011';
    const ok = await request(app).post('/api/users/record-withdrawal').send({
      specimenId,
      requiredScope: 'research',
      quantity: 1,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ movementID: 'M-1' });

    const denied = await request(app).post('/api/users/record-withdrawal').send({
      specimenId,
      consentScope: 'secondary-use',
    });
    expect(denied.status).toBe(400);
    expect(denied.body.message).toBe('consent-boom');
    expect(validateAccess).toHaveBeenCalledWith(specimenId, 'research');
    expect(validateAccess).toHaveBeenCalledWith(specimenId, 'secondary-use');
  });
});


describe('user.routes item 8 MFA administrative success branches', () => {
  it('unlocks an administrator without destroying MFA enrolment', async () => {
    const rbacAssignment = require('../../src/services/rbac-assignment.service');
    const auditLogger = require('../../src/utils/auditLogger');
    vi.spyOn(rbacAssignment, 'isAdministrator').mockResolvedValue(true);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const log = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const user = { _id: 'admin-1', mfaEnabled: true, mfaLocked: true, mfaFailedAttempts: 5 };
    const app = buildApp({ collection: () => ({ findOne: vi.fn().mockResolvedValue(user), updateOne }) });

    const res = await request(app).post('/api/users/admin-1/reset-mfa');

    expect(res.status).toBe(200);
    expect(res.body.unlockedOnly).toBe(true);
    expect(updateOne.mock.calls[0][1].$set).toEqual(expect.objectContaining({
      mfaFailedAttempts: 0,
      mfaLocked: false,
    }));
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty('mfaEnabled');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MFA',
      severity: 'info',
      payload: expect.objectContaining({ operation: 'unlock', sessionsRevoked: false }),
    }));
  });

  it('fully resets MFA for a non-administrator and revokes sessions', async () => {
    const rbacAssignment = require('../../src/services/rbac-assignment.service');
    const sessionService = require('../../src/services/session.service');
    const auditLogger = require('../../src/utils/auditLogger');
    vi.spyOn(rbacAssignment, 'isAdministrator').mockResolvedValue(false);
    const invalidate = vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const log = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const user = { _id: 'user-2', mfaEnabled: true, mfaSecretCiphertext: 'cipher' };
    const app = buildApp({ collection: () => ({ findOne: vi.fn().mockResolvedValue(user), updateOne }) });

    const res = await request(app).post('/api/users/user-2/reset-mfa');

    expect(res.status).toBe(200);
    expect(updateOne.mock.calls[0][1].$set).toEqual(expect.objectContaining({
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      mfaActivationDate: null,
      mfaFailedAttempts: 0,
      mfaLocked: false,
      lastLogin: null,
    }));
    expect(invalidate).toHaveBeenCalledWith(expect.anything(), 'user-2', 'admin_action', 'caller-1');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'critical',
      payload: expect.objectContaining({ operation: 'reset', sessionsRevoked: true }),
    }));
  });

  it('forces password reset and records the explicit UPDATE audit event', async () => {
    const auditLogger = require('../../src/utils/auditLogger');
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const log = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const app = buildApp({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue({ _id: 'user-3' }),
        updateOne,
      }),
    });

    const res = await request(app).post('/api/users/user-3/force-password-reset');

    expect(res.status).toBe(200);
    expect(updateOne.mock.calls[0][1].$set.forceReset).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE',
      resourceType: 'User',
      resourceId: 'user-3',
      payload: { operation: 'forcePasswordReset', fieldsSet: ['forceReset'] },
    }));
  });

  it('disables MFA for an administrator target while preserving the secret', async () => {
    const rbacAssignment = require('../../src/services/rbac-assignment.service');
    const auditLogger = require('../../src/utils/auditLogger');
    vi.spyOn(rbacAssignment, 'isAdministrator')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const log = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const app = buildApp({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue({ _id: 'admin-2', mfaSecretCiphertext: 'preserve-me' }),
        updateOne,
      }),
    });

    const res = await request(app).post('/api/users/admin-2/disable-mfa');

    expect(res.status).toBe(200);
    expect(updateOne.mock.calls[0][1].$set).toEqual(expect.objectContaining({
      mfaEnabled: false,
      mfaFailedAttempts: 0,
      mfaLocked: false,
    }));
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty('mfaSecretCiphertext');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'critical',
      payload: expect.objectContaining({ operation: 'disable', enrolmentPreserved: true }),
    }));
  });
});
