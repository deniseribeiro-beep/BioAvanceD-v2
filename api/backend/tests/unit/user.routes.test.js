import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

// Same one-time-require pattern as storage.routes.test.js / patient.routes.test.js
// (confirmed against both before copying it here): user.routes.js destructures
// `{ authenticate }` from auth and `{ requirePermission }` from rbac AT
// REQUIRE-TIME, so a proxy has to be installed on each module's exports
// BEFORE the single require() of the route file below, or the route would
// freeze on whatever the real implementation was at that moment and no
// later swap would ever be observed.
const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/interface/routes/user.routes.js');

let currentAuth = defaultAuth;
// Default no-op passthrough; individual tests swap this in via loadRoute().
let currentRequirePermission = () => (req, res, next) => next();

function defaultAuth(req, res, next) {
  req.user = { userID: 'user-1', roleName: 'Administrador' };
  req.t = (key) => key;
  next();
}

const authModule = require(authPath);
authModule.authenticate = (req, res, next) => currentAuth(req, res, next);

const rbacModule = require(rbacPath);
// requirePermission is a FACTORY: user.routes.js calls e.g.
// requirePermission('createUser') exactly ONCE per route, at registration
// time, baking that route's args into the closure below forever (correctly
// -- that IS the route's permanent declaration). The returned middleware
// re-invokes `currentRequirePermission(...args)` on every REQUEST though,
// which is what lets a test swap the FACTORY behaviour (denying vs.
// passthrough) after the route is already loaded, while still observing
// the exact args that specific route registered with.
rbacModule.requirePermission = (...args) => (req, res, next) =>
  currentRequirePermission(...args)(req, res, next);

// Required exactly once - see comments above. Every requirePermission-gated
// route's own handler body (db access, service calls, etc.) is never
// reached in the gate-pinning tests below, because the denying stub
// answers 403 before the route callback runs -- so unlike
// patient.routes.test.js, no controller/service stubbing is needed here.
const router = require(routePath);

function loadRoute({ authImpl, requirePermissionImpl } = {}) {
  currentAuth = authImpl || defaultAuth;
  currentRequirePermission = requirePermissionImpl || (() => (req, res, next) => next());
  return { router };
}

// Minimal stub sufficient for the routes that are NOT stopped by a denying
// requirePermission (used only by the GET /logs shadowing test below,
// where GET /:id's own handler runs to completion).
function buildApp(router, { db } = {}) {
  const app = express();
  app.use(express.json());
  app.locals.db = db !== undefined ? db : {};
  app.use('/api/users', router);
  return app;
}

// Copied from storage.routes.test.js:1174-1205 / patient.routes.test.js
// (confirmed against both before use): records the arguments the
// middleware FACTORY was called with, not just that a 403 came back -- an
// unconditional-403 stub that discarded the code argument would pass
// identically whichever requirePermission code the route actually declared
// (issue #888).
function denyingRequirePermission() {
  const recordedCalls = [];
  const factory = (...args) => {
    recordedCalls.push(args);
    return (req, res) => res.status(403).json({ success: false, error: 'Acesso negado', gate: 'permission' });
  };
  factory.recordedCalls = recordedCalls;
  return factory;
}

describe('user.routes authorization gates (issue #921)', () => {
  describe('requirePermission argument pinning', () => {
    // One entry per requirePermission-gated registration -- all 12 of them
    // (#1010 added the 12th), confirmed against user.routes.js line-by-line.
    // The per-case line numbers in the labels below have drifted since #921
    // wrote them and are indicative, not authoritative -- re-derive with
    // git grep rather than trusting them. Each pins the exact permission
    // code (and, for the four
    // two-argument calls -- withdrawSample/UPDATE, resetMFA/UPDATE,
    // forcePasswordReset/UPDATE, disableMFA/UPDATE -- the explicit action) the route hands
    // the gate factory.
    const CASES = [
      { label: 'POST /register (createUser) :40', method: 'post', path: '/register', expectedArgs: ['createUser'] },
      { label: 'GET / (createUser) :124', method: 'get', path: '/', expectedArgs: ['createUser'] },
      { label: 'PUT /:id (createUser) :215', method: 'put', path: '/u1', expectedArgs: ['createUser'] },
      { label: 'DELETE /:id (createUser) :526', method: 'delete', path: '/u1', expectedArgs: ['createUser'] },
      // :604 -- note this is a Patient code (createPatient) on a User
      // router, pinned as-is; whether it is the *right* code is #888's
      // question, not this slice's.
      { label: 'POST /register-patient (createPatient) :604', method: 'post', path: '/register-patient', expectedArgs: ['createPatient'] },
      { label: 'POST /register-sample (createSample) :632', method: 'post', path: '/register-sample', expectedArgs: ['createSample'] },
      // The first of the three two-argument requirePermission calls in this file.
      { label: 'POST /record-withdrawal (withdrawSample, UPDATE) :714', method: 'post', path: '/record-withdrawal', expectedArgs: ['withdrawSample', 'UPDATE'] },
      { label: 'POST /generate-report (viewReports) :757', method: 'post', path: '/generate-report', expectedArgs: ['viewReports'] },
      // #1073 answered the question this comment deferred: the code WAS
      // wrong. Registering a sensor is a device-lifecycle CREATE and was
      // gated on 'viewTemperature', a read permission -- the same defect
      // the sensor router's own five writes carried. Now 'manageSensor'.
      { label: 'POST /register-sensor (manageSensor) :795', method: 'post', path: '/register-sensor', expectedArgs: ['manageSensor'] },
      { label: 'POST /:id/reset-mfa (resetMFA, UPDATE) :851', method: 'post', path: '/u1/reset-mfa', expectedArgs: ['resetMFA', 'UPDATE'] },
      { label: 'POST /:id/force-password-reset (forcePasswordReset, UPDATE) :919', method: 'post', path: '/u1/force-password-reset', expectedArgs: ['forcePasswordReset', 'UPDATE'] },
      // #1010: disable-mfa had NO requirePermission gate at all -- only
      // authenticate, with an in-handler isAdministrator check that is a real
      // gate but is invisible to the RBAC catalogue, so the operation could
      // be neither granted to another role nor denied to an Administrador.
      { label: 'POST /:id/disable-mfa (disableMFA, UPDATE) :1083', method: 'post', path: '/u1/disable-mfa', expectedArgs: ['disableMFA', 'UPDATE'] },
    ];

    for (const { label, method, path, expectedArgs } of CASES) {
      it(`pins requirePermission(${JSON.stringify(expectedArgs)}) for ${label}`, async () => {
        const requirePermissionImpl = denyingRequirePermission();
        const { router } = loadRoute({ requirePermissionImpl });
        const app = buildApp(router);

        const res = await request(app)[method](`/api/users${path}`).send({});

        expect(res.status).toBe(403);
        expect(res.body.gate).toBe('permission');
        // The load-bearing assertion: a stub that discarded its arguments
        // would answer 403 identically no matter what code the route
        // actually declared -- including silently swallowing the second
        // 'UPDATE' argument on the three two-arg calls.
        expect(requirePermissionImpl.recordedCalls).toEqual([expectedArgs]);
      });
    }
  });

  it('does not apply requireOrganizationScope anywhere on this router (confirmed absent)', () => {
    // user.routes.js has no `requireOrganizationScope` seam at all -- unlike
    // patient.routes.js, there is nothing to proxy or deny. The only way to
    // pin "not applied anywhere" honestly is to assert its absence from the
    // route module's own source, so this test fails the moment someone
    // wires the middleware in without a corresponding update here.
    const source = fs.readFileSync(routePath, 'utf8');
    expect(source).not.toMatch(/requireOrganizationScope/);
  });

  // GET /logs (user.routes.js:823) is registered AFTER GET /:id
  // (user.routes.js:172), and both are plain single-segment GET routes
  // under the router root. Express matches router.METHOD registrations in
  // registration order, not by literal-vs-param specificity, so a request
  // to /api/users/logs actually falls through GET /:id (id = 'logs') first
  // and never reaches line 823's own registration. GET /:id carries no
  // requirePermission gate at all (only authenticate), so this is not a
  // gate-args question -- but it does mean GET /logs's own registration
  // (and whatever the real logService.getLogs endpoint is meant to enforce)
  // is unreachable. Pinned here as observed; not fixed (out of this file's
  // boundary) -- see the report for the suggested follow-up issue.
  it('GET /logs reaches its own registration, not GET /:id (#926)', async () => {
    const { router } = loadRoute();
    // GET /:id's handler queries db.collection('users').findOne(...) and
    // answers 404 'users.notFound' when nothing matches. GET /logs's own
    // handler never produces that shape, so the absence of it is the signal.
    const usersCollectionStub = { findOne: async () => null };
    const app = buildApp(router, {
      db: { collection: () => usersCollectionStub },
    });

    const res = await request(app).get('/api/users/logs');

    // #926: this asserted 404 / 'users.notFound' when it was written --
    // GET /logs sat at the bottom of the file, below GET /:id, so the
    // parameterised route matched first with id='logs' and the logs endpoint
    // was dead code. The registration moved above GET /:id. Asserting the
    // absence of the /:id shape rather than a specific success status keeps
    // this independent of whatever logService.getLogs does with a stub db.
    expect(res.body.error).not.toBe('users.notFound');
  });
});

describe('user.routes item 8 residual branch coverage', () => {
  it.each([
    ['post', '/register'],
    ['get', '/'],
    ['get', '/logs'],
    ['get', '/u1'],
    ['put', '/u1'],
    ['delete', '/u1'],
    ['post', '/register-patient'],
    ['post', '/register-sample'],
    ['post', '/record-withdrawal'],
    ['post', '/generate-report'],
    ['post', '/register-sensor'],
    ['post', '/u1/reset-mfa'],
    ['post', '/u1/force-password-reset'],
    ['post', '/u1/disable-mfa'],
  ])('fails closed with 503 when the database is unavailable: %s %s', async (method, routePathname) => {
    const { router } = loadRoute();
    const app = buildApp(router, { db: null });

    const res = await request(app)[method]('/api/users' + routePathname).send({});

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('normalizes optional register fields before delegating to AuthService', async () => {
    const authService = require('../../src/services/auth.service');
    const UserModel = require('../../src/models/User');
    const db = {};
    const registerSpy = vi.spyOn(authService, 'registerUser')
      .mockResolvedValue({ _id: 'new-user-1', username: 'normalized-user' });

    const authWithoutUser = (req, res, next) => {
      req.user = null;
      req.t = (key) => key;
      next();
    };
    const { router } = loadRoute({ authImpl: authWithoutUser });
    const app = buildApp(router, { db });

    const formatted = await request(app).post('/api/users/register').send({
      status: 'Ativo',
      phone: '(11) 99999-0000',
      organizationId: '   ',
    });
    const emptyPhone = await request(app).post('/api/users/register').send({
      phone: '---',
      organizationId: '',
    });
    const nullPhone = await request(app).post('/api/users/register').send({
      phone: null,
    });

    expect(formatted.status).toBe(201);
    expect(emptyPhone.status).toBe(201);
    expect(nullPhone.status).toBe(201);
    expect(registerSpy).toHaveBeenNthCalledWith(
      1,
      db,
      expect.objectContaining({
        status: UserModel.normalizeStatus('Ativo'),
        phone: '11999990000',
        organizationId: null,
      }),
      undefined
    );
    expect(registerSpy).toHaveBeenNthCalledWith(
      2,
      db,
      expect.objectContaining({ phone: null, organizationId: null }),
      undefined
    );
    expect(registerSpy).toHaveBeenNthCalledWith(
      3,
      db,
      expect.objectContaining({ phone: null }),
      undefined
    );

    registerSpy.mockRestore();
    loadRoute();
  });

  it('covers list success without optional status role or id rewrites and the list error response', async () => {
    const usersCollection = {
      find: vi.fn()
        .mockReturnValueOnce({
          toArray: vi.fn().mockResolvedValue([
            { _id: 'u1', id: 'already-present', roleName: 'Técnico', name: 'Synthetic User' },
          ]),
        })
        .mockReturnValueOnce({
          toArray: vi.fn().mockRejectedValue(new Error('list-boom')),
        }),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    const ok = await request(app).get('/api/users/');
    const failed = await request(app).get('/api/users/');

    expect(ok.status).toBe(200);
    expect(ok.body.data[0]).toEqual(expect.objectContaining({
      id: 'already-present',
      roleName: 'Técnico',
      name: 'Synthetic User',
    }));
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('list-boom');
  });

  it('covers logs success and service failure through the real logs registration', async () => {
    const logService = require('../../src/services/log.service');
    const db = {};
    const getLogs = vi.spyOn(logService, 'getLogs')
      .mockResolvedValueOnce({ logs: [], total: 0 })
      .mockRejectedValueOnce(new Error('logs-boom'));
    const { router } = loadRoute();
    const app = buildApp(router, { db });

    const ok = await request(app).get('/api/users/logs?limit=10');
    const failed = await request(app).get('/api/users/logs');

    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ logs: [], total: 0 });
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('logs-boom');
    expect(getLogs).toHaveBeenCalledTimes(2);

    getLogs.mockRestore();
  });

  it('covers GET by id not found successful no-status response and collection failure', async () => {
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'u1', id: 'u1', roleName: 'Técnico', name: 'Synthetic User' })
      .mockRejectedValueOnce(new Error('get-user-boom'));
    const db = { collection: () => ({ findOne }) };
    const { router } = loadRoute();
    const app = buildApp(router, { db });

    const missing = await request(app).get('/api/users/missing');
    const ok = await request(app).get('/api/users/u1');
    const failed = await request(app).get('/api/users/u2');

    expect(missing.status).toBe(404);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual(expect.objectContaining({ id: 'u1', roleName: 'Técnico' }));
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('get-user-boom');
  });

  it('covers PUT by id missing target without invoking update semantics', async () => {
    const usersCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn(),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    const res = await request(app).put('/api/users/missing').send({ name: 'Ignored' });

    expect(res.status).toBe(404);
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  it('covers reset MFA target lookup failure and handler catch path', async () => {
    const usersCollection = {
      findOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('reset-mfa-boom')),
      updateOne: vi.fn(),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    const missing = await request(app).post('/api/users/missing/reset-mfa');
    const failed = await request(app).post('/api/users/failing/reset-mfa');

    expect(missing.status).toBe(404);
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('reset-mfa-boom');
  });

  it('covers force password reset handler failure without changing account state', async () => {
    const usersCollection = {
      findOne: vi.fn().mockRejectedValue(new Error('force-reset-boom')),
      updateOne: vi.fn(),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    const res = await request(app).post('/api/users/u1/force-password-reset');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('force-reset-boom');
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  it('covers disable MFA caller and target denials missing target and handler failure', async () => {
    const rbacAssignment = require('../../src/services/rbac-assignment.service');
    const adminSpy = vi.spyOn(rbacAssignment, 'isAdministrator');
    const usersCollection = {
      findOne: vi.fn(),
      updateOne: vi.fn(),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    adminSpy.mockResolvedValueOnce(false);
    const callerDenied = await request(app).post('/api/users/u1/disable-mfa');
    expect(callerDenied.status).toBe(403);

    adminSpy.mockResolvedValueOnce(true);
    usersCollection.findOne.mockResolvedValueOnce(null);
    const missing = await request(app).post('/api/users/missing/disable-mfa');
    expect(missing.status).toBe(404);

    adminSpy
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    usersCollection.findOne.mockResolvedValueOnce({ _id: 'u2', mfaEnabled: true });
    const targetDenied = await request(app).post('/api/users/u2/disable-mfa');
    expect(targetDenied.status).toBe(403);

    adminSpy.mockRejectedValueOnce(new Error('disable-mfa-boom'));
    const failed = await request(app).post('/api/users/u3/disable-mfa');
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('disable-mfa-boom');

    expect(usersCollection.updateOne).not.toHaveBeenCalled();
    adminSpy.mockRestore();
  });
});

describe('user.routes item 8 PUT residual branch closure', () => {
  function installUpdateSpies() {
    const UserModel = require('../../src/models/User');
    const rbacAssignment = require('../../src/services/rbac-assignment.service');
    const auditLogger = require('../../src/utils/auditLogger');

    const validate = vi.spyOn(UserModel, 'validate').mockReturnValue({ isValid: true, errors: [] });
    const isAdministrator = vi.spyOn(rbacAssignment, 'isAdministrator').mockResolvedValue(false);
    const resolveRoleDisplayName = vi.spyOn(rbacAssignment, 'resolveRoleDisplayName').mockResolvedValue('Técnico');
    const revokeAdditionalRole = vi.spyOn(rbacAssignment, 'revokeAdditionalRole').mockResolvedValue({ revoked: true });
    const auditInit = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const auditPermission = vi.spyOn(auditLogger, 'logPermissionChange').mockResolvedValue(undefined);
    const auditUpdate = vi.spyOn(auditLogger, 'logUpdate').mockResolvedValue(undefined);

    return {
      UserModel,
      validate,
      isAdministrator,
      resolveRoleDisplayName,
      revokeAdditionalRole,
      auditInit,
      auditPermission,
      auditUpdate,
    };
  }

  it('covers PUT validation, normalization, update-result and auditor-role residual branches', async () => {
    const spies = installUpdateSpies();
    const target = {
      _id: 'u1',
      name: 'Synthetic User',
      email: 'synthetic@example.test',
      username: 'synthetic',
      status: 'inactive',
      organizationId: null,
    };
    const updatedActive = {
      ...target,
      status: 'active',
      phone: null,
      roleValidFrom: new Date('2026-01-01T00:00:00.000Z'),
      roleValidUntil: null,
    };
    const updatedDates = {
      ...target,
      phone: null,
      roleValidFrom: null,
      roleValidUntil: new Date('2027-01-01T00:00:00.000Z'),
    };
    const updatedAuditor = { ...target };

    const findOne = vi.fn()
      // invalid validation request
      .mockResolvedValueOnce(target)
      // normalized request: target + updated
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(updatedActive)
      // null-phone/date-alternative request: target + updated
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(updatedDates)
      // matchedCount=0 request: target only
      .mockResolvedValueOnce(target)
      // updated-user-missing request: target + null
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(null)
      // auditor revoke request: target + updated
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(updatedAuditor);

    const updateOne = vi.fn()
      .mockResolvedValueOnce({ matchedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1 });

    const usersCollection = { findOne, updateOne };
    const db = { collection: () => usersCollection };
    const { router } = loadRoute();
    const app = buildApp(router, { db });

    spies.validate.mockReturnValueOnce({ isValid: false, errors: ['invalid synthetic update'] });
    const invalid = await request(app).put('/api/users/u1').send({ name: 42 });
    expect(invalid.status).toBe(422);
    expect(invalid.body.message).toContain('invalid synthetic update');

    const normalized = await request(app).put('/api/users/u1').send({
      status: 'Ativo',
      phone: '---',
      roleValidFrom: '2026-01-01T00:00:00.000Z',
      roleValidUntil: '',
    });
    expect(normalized.status).toBe(200);
    const normalizedSet = updateOne.mock.calls[0][1].$set;
    expect(normalizedSet.status).toBe(spies.UserModel.normalizeStatus('Ativo'));
    expect(normalizedSet.phone).toBeNull();
    expect(normalizedSet.roleValidFrom).toBeInstanceOf(Date);
    expect(normalizedSet.roleValidUntil).toBeNull();
    expect(spies.auditPermission).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({
        status: expect.objectContaining({ from: 'inactive', to: spies.UserModel.normalizeStatus('Ativo') }),
      })
    );

    const alternateValues = await request(app).put('/api/users/u1').send({
      phone: null,
      roleValidFrom: null,
      roleValidUntil: '2027-01-01T00:00:00.000Z',
    });
    expect(alternateValues.status).toBe(200);
    const alternateSet = updateOne.mock.calls[1][1].$set;
    expect(alternateSet.phone).toBeNull();
    expect(alternateSet.roleValidFrom).toBeNull();
    expect(alternateSet.roleValidUntil).toBeInstanceOf(Date);
    expect(spies.auditUpdate).toHaveBeenCalled();

    const unmatched = await request(app).put('/api/users/u1').send({ name: 'Still Synthetic' });
    expect(unmatched.status).toBe(404);
    expect(unmatched.body.error).toBe('Usuário não encontrado');

    const missingAfterUpdate = await request(app).put('/api/users/u1').send({ name: 'Synthetic Updated' });
    expect(missingAfterUpdate.status).toBe(404);
    expect(missingAfterUpdate.body.error).toBe('users.updateNotFound');

    const auditorRevoked = await request(app).put('/api/users/u1').send({ auditorRole: false });
    expect(auditorRevoked.status).toBe(200);
    expect(spies.revokeAdditionalRole).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userAccountId: 'u1',
        roleCode: 'auditor',
        revokedBy: 'user-1',
      })
    );
    expect(spies.auditPermission).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.objectContaining({ auditorRole: false })
    );

    expect(spies.isAdministrator).toHaveBeenCalledTimes(5);
    expect(spies.resolveRoleDisplayName).toHaveBeenCalledTimes(3);

    vi.restoreAllMocks();
    loadRoute();
  });

describe('user.routes item 8 register-sample and normalization alternates', () => {
  it('uses compatible actor fallbacks and reports permissive topology quarantine as partial success', async () => {
    const RegisterSampleUseCase = require('../../src/core/use-cases/RegisterSampleUseCase');
    const execute = vi.spyOn(RegisterSampleUseCase.prototype, 'execute').mockResolvedValue({
      sample: { _id: null, id: 'legacy-sample-id', specimenId: 'SPEC-1' },
      strictMode: false,
      topology: { synced: false, fallbackQueued: true },
    });

    const authImpl = (req, _res, next) => {
      req.user = {
        _id: { toString: () => 'object-user-id' },
        username: 'synthetic-user',
        role: 'Técnico',
      };
      req.t = () => '';
      Object.defineProperty(req, 'ip', { configurable: true, value: undefined });
      next();
    };

    const { router } = loadRoute({ authImpl });
    const app = buildApp(router, { db: {} });

    const res = await request(app)
      .post('/api/users/register-sample')
      .set('x-forwarded-for', '203.0.113.10')
      .set('user-agent', 'item8-agent')
      .send({ sampleType: 'PLASMA' });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      success: true,
      partialSuccess: true,
      data: {
        sampleID: 'legacy-sample-id',
        operationMode: 'PERMISSIVE',
        topology: { synced: false, fallbackQueued: true },
      },
    });
    expect(res.body.message).toContain('integração topológica em quarentena');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({
        userId: 'object-user-id',
        userName: 'synthetic-user',
        userRole: 'Técnico',
        ipAddress: '203.0.113.10',
        userAgent: 'item8-agent',
      }),
    }));

    execute.mockRestore();
    loadRoute();
  });

  it('returns normal 201 success for strict mode with synchronized topology and userID/name/roleName actor fields', async () => {
    const RegisterSampleUseCase = require('../../src/core/use-cases/RegisterSampleUseCase');
    const execute = vi.spyOn(RegisterSampleUseCase.prototype, 'execute').mockResolvedValue({
      sample: { _id: { toString: () => 'sample-object-id' }, specimenId: 'SPEC-2' },
      strictMode: true,
      topology: { synced: true, fallbackQueued: false },
    });

    const authImpl = (req, _res, next) => {
      req.user = {
        userID: 'user-id-fallback',
        name: 'Synthetic Name',
        roleName: 'Administrador',
      };
      req.t = (key) => key;
      next();
    };

    const { router } = loadRoute({ authImpl });
    const app = buildApp(router, { db: {} });
    const res = await request(app)
      .post('/api/users/register-sample')
      .send({ sampleType: 'PLASMA' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      partialSuccess: false,
      message: 'users.registerSampleSuccess',
      data: {
        sampleID: 'sample-object-id',
        operationMode: 'STRICT',
        topology: { synced: true, fallbackQueued: false },
      },
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({
        userId: 'user-id-fallback',
        userName: 'Synthetic Name',
        userRole: 'Administrador',
      }),
    }));

    execute.mockRestore();
    loadRoute();
  });

  it.each([
    [Object.assign(new Error('blocked by policy'), { statusCode: 403 })],
    [Object.assign(new Error('blocked by code'), { code: 'STRICT_MODE_BLOCKED' })],
    [new Error('STRICT_MODE_BLOCKED: topology unavailable')],
  ])('maps strict-mode governance failures to HTTP 403', async (failure) => {
    const RegisterSampleUseCase = require('../../src/core/use-cases/RegisterSampleUseCase');
    const execute = vi.spyOn(RegisterSampleUseCase.prototype, 'execute').mockRejectedValue(failure);

    const { router } = loadRoute();
    const app = buildApp(router, { db: {} });
    const res = await request(app)
      .post('/api/users/register-sample')
      .send({ sampleType: 'PLASMA' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('STRICT_MODE_BLOCKED');

    execute.mockRestore();
    loadRoute();
  });

  it('keeps malformed optional register phone/organization inputs for model validation instead of coercing them as strings', async () => {
    const authService = require('../../src/services/auth.service');
    const register = vi.spyOn(authService, 'registerUser').mockResolvedValue({
      _id: null,
      id: 'fallback-user-id',
      username: 'synthetic',
    });

    const authWithoutUser = (req, _res, next) => {
      req.user = null;
      req.t = (key) => key;
      next();
    };
    const { router } = loadRoute({ authImpl: authWithoutUser });
    const app = buildApp(router, { db: {} });

    const res = await request(app)
      .post('/api/users/register')
      .send({ phone: 5511999999999, organizationId: 123 });

    expect(res.status).toBe(201);
    expect(register).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ phone: 5511999999999, organizationId: 123 }),
      undefined
    );

    register.mockRestore();
    loadRoute();
  });
});


describe('user.routes item 8 administrative security success paths', () => {
  it('reset-mfa unlocks an Administrator without destroying enrollment or revoking sessions', async () => {
    const rbacAssignment = require('../../src/services/rbac-assignment.service');
    const auditLogger = require('../../src/utils/auditLogger');
    const sessionService = require('../../src/services/session.service');

    const admin = vi.spyOn(rbacAssignment, 'isAdministrator').mockResolvedValue(true);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const audit = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const invalidate = vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue(undefined);

    const target = {
      _id: { toString: () => 'admin-target' },
      mfaEnabled: true,
      mfaSecretCiphertext: 'ciphertext',
      mfaLocked: true,
      mfaFailedAttempts: 5,
    };
    const usersCollection = {
      findOne: vi.fn().mockResolvedValue(target),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    const res = await request(app).post('/api/users/admin-target/reset-mfa');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, unlockedOnly: true });
    expect(usersCollection.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({
        mfaFailedAttempts: 0,
        mfaLocked: false,
      }) }
    );
    expect(invalidate).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MFA',
      payload: expect.objectContaining({
        operation: 'unlock',
        enrolmentPreserved: true,
        secondFactorActive: true,
        sessionsRevoked: false,
      }),
    }));

    admin.mockRestore();
    loadRoute();
  });

  it('reset-mfa removes a non-admin enrollment and revokes that target account sessions', async () => {
    const rbacAssignment = require('../../src/services/rbac-assignment.service');
    const auditLogger = require('../../src/utils/auditLogger');
    const sessionService = require('../../src/services/session.service');

    const admin = vi.spyOn(rbacAssignment, 'isAdministrator').mockResolvedValue(false);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const audit = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const invalidate = vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue(undefined);

    const target = {
      _id: { toString: () => 'tech-target' },
      mfaEnabled: true,
      mfaSecretCiphertext: 'ciphertext',
    };
    const usersCollection = {
      findOne: vi.fn().mockResolvedValue(target),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    const res = await request(app).post('/api/users/tech-target/reset-mfa');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(usersCollection.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({
        mfaEnabled: false,
        mfaSecretCiphertext: null,
        mfaLocked: false,
        lastLogin: null,
      }) }
    );
    expect(invalidate).toHaveBeenCalledWith(
      expect.anything(),
      'tech-target',
      'admin_action',
      'user-1'
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MFA',
      payload: expect.objectContaining({
        operation: 'reset',
        enrolmentPreserved: false,
        secondFactorActive: false,
        sessionsRevoked: true,
      }),
    }));

    admin.mockRestore();
    loadRoute();
  });

  it('force-password-reset sets forceReset and writes an explicit UPDATE audit event', async () => {
    const auditLogger = require('../../src/utils/auditLogger');
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const audit = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const target = { _id: { toString: () => 'user-force-reset' } };
    const usersCollection = {
      findOne: vi.fn().mockResolvedValue(target),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    const res = await request(app).post('/api/users/user-force-reset/force-password-reset');

    expect(res.status).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      { $set: expect.objectContaining({ forceReset: true }) }
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE',
      resourceType: 'User',
      resourceId: 'user-force-reset',
      payload: { operation: 'forcePasswordReset', fieldsSet: ['forceReset'] },
    }));

    loadRoute();
  });

  it('disable-mfa succeeds only after both caller and target Administrator checks and preserves the secret', async () => {
    const rbacAssignment = require('../../src/services/rbac-assignment.service');
    const auditLogger = require('../../src/utils/auditLogger');

    const admin = vi.spyOn(rbacAssignment, 'isAdministrator')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const audit = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const target = {
      _id: { toString: () => 'admin-2' },
      mfaEnabled: true,
      mfaSecretCiphertext: 'preserved-secret',
    };
    const usersCollection = {
      findOne: vi.fn().mockResolvedValue(target),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    const res = await request(app).post('/api/users/admin-2/disable-mfa');

    expect(res.status).toBe(200);
    const update = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(update).toMatchObject({ mfaEnabled: false, mfaFailedAttempts: 0, mfaLocked: false });
    expect(update).not.toHaveProperty('mfaSecretCiphertext');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MFA',
      payload: expect.objectContaining({
        operation: 'disable',
        enrolmentPreserved: true,
        secondFactorActive: false,
      }),
    }));

    admin.mockRestore();
    loadRoute();
  });
});


describe('user.routes item 8 operational route branches', () => {
  it('deletes an existing user and records the canonical delete audit event', async () => {
    const auditLogger = require('../../src/utils/auditLogger');
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logDelete = vi.spyOn(auditLogger, 'logDelete').mockResolvedValue(undefined);
    const usersCollection = {
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    const db = { collection: vi.fn(() => usersCollection) };
    const { router } = loadRoute();
    const app = buildApp(router, { db });

    const res = await request(app).delete('/api/users/user-delete');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(logDelete).toHaveBeenCalledWith(expect.anything(), 'User', 'user-delete');

    vi.restoreAllMocks();
    loadRoute();
  });

  it('returns the default inactive status for a legacy user with no explicit status', async () => {
    const usersCollection = {
      findOne: vi.fn().mockResolvedValue({ _id: 'u-status' }),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    const res = await request(app).get('/api/users/u-status/validate-status');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('inactive');
  });

  it('covers validate-status missing-user and database failure responses', async () => {
    const usersCollection = {
      findOne: vi.fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('status lookup failed')),
    };
    const { router } = loadRoute();
    const app = buildApp(router, { db: { collection: () => usersCollection } });

    const missing = await request(app).get('/api/users/missing-status/validate-status');
    const failed = await request(app).get('/api/users/failing-status/validate-status');

    expect(missing.status).toBe(404);
    expect(failed.status).toBe(500);
    expect(failed.body.message).toBe('status lookup failed');
  });

  it('delegates patient registration and maps service rejection without changing the route contract', async () => {
    const patientService = require('../../src/services/patient.service');
    const create = vi.spyOn(patientService, 'createPatient')
      .mockResolvedValueOnce({ participantId: '12345678' })
      .mockRejectedValueOnce(new Error('patient rejected'));
    const db = {};
    const { router } = loadRoute();
    const app = buildApp(router, { db });

    const ok = await request(app)
      .post('/api/users/register-patient')
      .send({ participantId: '12345678' });
    const failed = await request(app)
      .post('/api/users/register-patient')
      .send({ participantId: '87654321' });

    expect(ok.status).toBe(201);
    expect(ok.body.data.participantId).toBe('12345678');
    expect(failed.status).toBe(400);
    expect(failed.body.message).toBe('patient rejected');
    expect(create).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
    loadRoute();
  });

  it('requires sampleID only after consent validation and records a valid withdrawal through SampleService', async () => {
    const sampleService = require('../../src/services/sample.service');
    const consent = vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
    const withdraw = vi.spyOn(sampleService, 'withdrawSample').mockResolvedValue({
      movementID: 'MOV-1',
      withdrawnQuantity: 1,
    });
    const db = {};
    const { router } = loadRoute();
    const app = buildApp(router, { db });

    const missing = await request(app)
      .post('/api/users/record-withdrawal')
      .send({ requiredScope: 'research' });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe('users.sampleIDRequired');

    const sampleID = '507f1f77bcf86cd799439011';
    const ok = await request(app)
      .post('/api/users/record-withdrawal')
      .send({
        sampleID,
        consentScope: 'research',
        withdrawalType: 'Total',
        withdrawalResponsible: 'Synthetic User',
      });

    expect(ok.status).toBe(200);
    expect(consent).toHaveBeenCalledWith(sampleID, 'research');
    expect(withdraw).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ toString: expect.any(Function) }),
      expect.objectContaining({ withdrawalType: 'Total' })
    );

    vi.restoreAllMocks();
    loadRoute();
  });

  it('maps consent or withdrawal failures to the established 400 response', async () => {
    vi.spyOn(consentValidator, 'init').mockImplementation(() => {});
    vi.spyOn(consentValidator, 'validateAccess').mockRejectedValue(new Error('consent denied'));
    const sampleService = require('../../src/services/sample.service');
    const withdraw = vi.spyOn(sampleService, 'withdrawSample');
    const { router } = loadRoute();
    const app = buildApp(router, { db: {} });

    const res = await request(app)
      .post('/api/users/record-withdrawal')
      .send({ sampleID: '507f1f77bcf86cd799439011' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('consent denied');
    expect(withdraw).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    loadRoute();
  });

  it('creates a pending report and preserves generatedBy from the authenticated user', async () => {
    const ReportsModel = require('../../src/models/Reports');
    const create = vi.spyOn(ReportsModel, 'create').mockImplementation((payload) => ({
      reportID: 1,
      ...payload,
    }));
    const reportsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'report-object-id' }),
    };
    const db = { collection: vi.fn(() => reportsCollection) };
    const { router } = loadRoute();
    const app = buildApp(router, { db });

    const res = await request(app)
      .post('/api/users/generate-report')
      .send({ reportType: 'samples', filters: { status: 'AVAILABLE' } });

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      reportType: 'samples',
      filters: { status: 'AVAILABLE' },
      generatedBy: 'user-1',
      status: 'pending',
    }));
    expect(reportsCollection.insertOne).toHaveBeenCalled();

    vi.restoreAllMocks();
    loadRoute();
  });

  it('uses an empty filter object and null generatedBy when optional report request context is absent', async () => {
    const ReportsModel = require('../../src/models/Reports');
    const create = vi.spyOn(ReportsModel, 'create').mockImplementation((payload) => payload);
    const reportsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'report-2' }),
    };
    const authWithoutUser = (req, _res, next) => {
      req.user = null;
      req.t = (key) => key;
      next();
    };
    const { router } = loadRoute({ authImpl: authWithoutUser });
    const app = buildApp(router, { db: { collection: () => reportsCollection } });

    const res = await request(app)
      .post('/api/users/generate-report')
      .send({ reportType: 'samples' });

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      filters: {},
      generatedBy: null,
    }));

    vi.restoreAllMocks();
    loadRoute();
  });

  it('delegates sensor registration and maps service failure to 400', async () => {
    const sensorService = require('../../src/services/sensor.service');
    const create = vi.spyOn(sensorService, 'createSensor')
      .mockResolvedValueOnce({ sensorID: 'SENSOR-1' })
      .mockRejectedValueOnce(new Error('sensor rejected'));
    const db = {};
    const { router } = loadRoute();
    const app = buildApp(router, { db });

    const ok = await request(app)
      .post('/api/users/register-sensor')
      .send({ sensorID: 'SENSOR-1' });
    const failed = await request(app)
      .post('/api/users/register-sensor')
      .send({ sensorID: 'SENSOR-2' });

    expect(ok.status).toBe(201);
    expect(ok.body.data.sensorID).toBe('SENSOR-1');
    expect(failed.status).toBe(400);
    expect(failed.body.message).toBe('sensor rejected');

    vi.restoreAllMocks();
    loadRoute();
  });
});

});