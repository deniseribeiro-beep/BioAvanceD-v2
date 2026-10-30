import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
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
// #1384: requireOrganizationScope is a plain middleware, destructured at
// require-time like requirePermission, so it is proxied the same way. The
// default resolves a global scope, so every handler below runs as the
// Administrador it runs as today.
let currentRequireOrganizationScope = defaultRequireOrganizationScope;
function defaultRequireOrganizationScope(req, res, next) {
  req.organizationScope = { scope: 'global', organizationIds: [] };
  next();
}
rbacModule.requireOrganizationScope = (req, res, next) => currentRequireOrganizationScope(req, res, next);

// Required exactly once - see comments above. Every requirePermission-gated
// route's own handler body (db access, service calls, etc.) is never
// reached in the gate-pinning tests below, because the denying stub
// answers 403 before the route callback runs -- so unlike
// patient.routes.test.js, no controller/service stubbing is needed here.
const router = require(routePath);

// #1389: the first require of log.service costs about half a second
// synchronously (exceljs, audit-v2.service, ...), so it is loaded here, at
// import time, rather than inside a case's timeout. The GET /logs route reads
// getLogs and isAuditReader off these exports at request time, so a per-case
// vi.spyOn on them is still observed.
const rbacService = require(require.resolve('../../src/services/rbac-assignment.service'));
const logService = require(require.resolve('../../src/services/log.service'));

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
    // One entry per requirePermission-gated registration -- all 16 of them
    // (#1010 added the 12th, #1020 the 13th, #1241 the 14th and 15th, #1013 the 16th), confirmed
    // with `grep -n "requirePermission(" user.routes.js`.
    // The per-case line numbers in the labels below have drifted since #921
    // wrote them and are indicative, not authoritative -- re-derive with
    // git grep rather than trusting them. Each pins the exact permission
    // code (and, for the four
    // two-argument calls -- withdrawSample/UPDATE, resetMFA/UPDATE,
    // forcePasswordReset/UPDATE, disableMFA/UPDATE -- the explicit action) the route hands
    // the gate factory.
    const CASES = [
      { label: 'POST /register (createUser) :40', method: 'post', path: '/register', expectedArgs: ['createUser'] },
      { label: 'GET / (readUser) :124', method: 'get', path: '/', expectedArgs: ['readUser'] },
      { label: 'PUT /:id (updateUser) :215', method: 'put', path: '/u1', expectedArgs: ['updateUser'] },
      { label: 'DELETE /:id (deleteUser) :526', method: 'delete', path: '/u1', expectedArgs: ['deleteUser'] },
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
      // #1020: RF003 AC#5's administrator session revoke.
      { label: 'POST /:id/revoke-sessions (revokeSessions, UPDATE)', method: 'post', path: '/u1/revoke-sessions', expectedArgs: ['revokeSessions', 'UPDATE'] },
      // #1241: GET /:id had authenticate only, so any account could read any
      // other user's record. It now carries the list's own gate.
      // #1229: the account verbs split createUser into four codes; each
      // user-account route takes the one its verb needs.
      { label: 'GET /:id (readUser)', method: 'get', path: '/u1', expectedArgs: ['readUser'] },
      // #1241: likewise answered "does this id exist, and is it active" for
      // any id to any account. Its one caller is the System Management screen.
      { label: 'GET /:id/validate-status (readUser)', method: 'get', path: '/u1/validate-status', expectedArgs: ['readUser'] },
      // #1013: the administrator's password set, off PUT /:id.
      { label: 'POST /:id/set-password (setUserPassword, UPDATE)', method: 'post', path: '/u1/set-password', expectedArgs: ['setUserPassword', 'UPDATE'] },
    ];

    // #1008: POST /register now carries a SECOND gate, assignRole, after
    // createUser. The denying stub above stops at the first gate, so it
    // cannot see the second; this stub passes createUser and denies the rest.
    it('pins the second gate on POST /register: createUser, then assignRole', async () => {
      const recordedCalls = [];
      const requirePermissionImpl = (...args) => {
        recordedCalls.push(args);
        return (req, res, next) => (args[0] === 'createUser'
          ? next()
          : res.status(403).json({ success: false, gate: 'permission' }));
      };
      const { router } = loadRoute({ requirePermissionImpl });
      const app = buildApp(router);

      const res = await request(app).post('/api/users/register').send({});

      expect(res.status).toBe(403);
      expect(recordedCalls).toEqual([['createUser'], ['assignRole']]);
    });

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

  // #1020: POST /:id/revoke-sessions -- 'risk' is the P1X-0267 member that had
  // no writer; only admin_action and risk are the administrator's to claim.
  describe('POST /:id/revoke-sessions', () => {
    const sessionServicePath = require.resolve('../../src/services/session.service');

    function appWithUser(user) {
      const { router } = loadRoute();
      return buildApp(router, { db: { collection: () => ({ findOne: async () => user }) } });
    }

    it.each([
      [undefined, 'admin_action'],
      ['risk', 'risk'],
    ])('reason %s revokes every active session with reason %s, actor = the admin', async (sent, expected) => {
      const sessionService = require(sessionServicePath);
      const spy = vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue(2);
      try {
        const body = sent === undefined ? {} : { reason: sent };
        const res = await request(appWithUser({ _id: 'target-1' })).post('/api/users/target-1/revoke-sessions').send(body);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ revoked: 2, reason: expected });
        expect(spy).toHaveBeenCalledWith(expect.anything(), 'target-1', expected, 'user-1', { req: expect.anything() });
      } finally {
        spy.mockRestore();
      }
    });

    it.each(['user_request', 'password_change', 'expiration', 'hacked'])('refuses reason %s with 422 before any write', async (reason) => {
      const sessionService = require(sessionServicePath);
      const spy = vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue(0);
      try {
        const res = await request(appWithUser({ _id: 'target-1' })).post('/api/users/target-1/revoke-sessions').send({ reason });
        expect(res.status).toBe(422);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('404 for an unknown user', async () => {
      const res = await request(appWithUser(null)).post('/api/users/nobody/revoke-sessions').send({});
      expect(res.status).toBe(404);
    });
  });

  // #1384: this pinned the gate's absence until user.routes.js joined the
  // organization-scope sweep. Every registration but GET /logs (the audit
  // trail, read across organizations as /api/logs reads it) now carries it.
  it('applies requireOrganizationScope on every registration but GET /logs (#1384)', () => {
    const gated = (layer) => layer.route.stack.some((entry) => entry.handle === rbacModule.requireOrganizationScope);
    const routes = router.stack.filter((layer) => layer.route);
    const key = (layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`;

    expect(routes).toHaveLength(20);
    expect(routes.filter((layer) => !gated(layer)).map(key)).toEqual(['GET /logs']);
  });

  // GET /logs (user.routes.js:823) is registered AFTER GET /:id
  // (user.routes.js:172), and both are plain single-segment GET routes
  // under the router root. Express matches router.METHOD registrations in
  // registration order, not by literal-vs-param specificity, so a request
  // to /api/users/logs actually falls through GET /:id (id = 'logs') first
  // and never reaches line 823's own registration. GET /:id carried no
  // requirePermission gate at all then (only authenticate; #1241 added
  // createUser), so this is not a
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

  // #1241: once #926 made GET /logs reachable, it served the `logs`
  // collection -- the RNF009 audit trail -- to any authenticated account,
  // while /api/logs gates the same collection on isAuditReader (#1056).
  describe('GET /logs follows the audit-reader rule (#1241)', () => {
    async function getLogsAs(auditReader) {
      const readerSpy = vi.spyOn(rbacService, 'isAuditReader').mockResolvedValue(auditReader);
      const logsSpy = vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: [], total: 0 });
      try {
        const { router } = loadRoute();
        const res = await request(buildApp(router)).get('/api/users/logs');
        // Copied out before mockRestore() in finally, which clears mock.calls.
        return { res, readerCalls: [...readerSpy.mock.calls], logsCalls: logsSpy.mock.calls.length };
      } finally {
        readerSpy.mockRestore();
        logsSpy.mockRestore();
      }
    }

    it('refuses an account that is not an audit reader, before reading any log', async () => {
      const { res, readerCalls, logsCalls } = await getLogsAs(false);
      expect(res.status).toBe(403);
      expect(readerCalls).toEqual([[expect.anything(), 'user-1']]);
      expect(logsCalls).toBe(0);
    });

    it('control: an audit reader gets the logs', async () => {
      const { res, logsCalls } = await getLogsAs(true);
      expect(res.status).toBe(200);
      expect(logsCalls).toBe(1);
    });
  });
});

// #1337: the arms of user.routes.js no case above or in the integration
// suites asserted. Every service the handlers reach is spied on its module
// object (the handlers require them lazily, so a spy is observed), never
// vi.mock'ed. A path an existing case already asserts is not repeated here.
describe('user.routes paths (#1337)', () => {
  const { createCollectionMock, createDbMock } = require('../factories/db.factory');
  const { buildRbacCollections } = require('../factories/rbac.factory');
  const authService = require(require.resolve('../../src/services/auth.service'));
  const sessionService = require(require.resolve('../../src/services/session.service'));
  const auditLogger = require(require.resolve('../../src/utils/auditLogger'));
  const patientService = require(require.resolve('../../src/services/patient.service'));
  const sensorService = require(require.resolve('../../src/services/sensor.service'));
  const sampleService = require(require.resolve('../../src/services/sample.service'));
  const consentValidator = require(require.resolve('../../src/services/consent.validator'));
  const RegisterSampleUseCase = require(require.resolve('../../src/core/use-cases/RegisterSampleUseCase'));

  const TARGET = { _id: 'u1', name: 'Alvo', email: 'alvo@example.com', username: 'alvo', accountStatus: 'active' };

  let auditLog;
  beforeEach(() => {
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    auditLog = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logUpdate').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logPermissionChange').mockResolvedValue(undefined);
    vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    currentRequireOrganizationScope = defaultRequireOrganizationScope;
    loadRoute();
  });

  function asScope(organizationScope) {
    currentRequireOrganizationScope = (req, res, next) => {
      if (organizationScope !== undefined) req.organizationScope = organizationScope;
      next();
    };
  }

  function createResponse() {
    return {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; },
    };
  }

  function usersDb(usersOverrides = {}, extra = {}) {
    const users = createCollectionMock({
      findOne: vi.fn(async () => ({ ...TARGET })),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      ...usersOverrides,
    });
    return { users, db: createDbMock({ users, ...extra }) };
  }

  function appWith(db, options) {
    const { router } = loadRoute(options);
    return buildApp(router, { db });
  }

  describe('with no database', () => {
    const routes = router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods)
      .map((m) => [m.toUpperCase(), l.route.path, l.route.stack[l.route.stack.length - 1].handle]));

    it.each(routes)('%s %s answers 503 with no db', async (method, path, handle) => {
      const res = createResponse();
      const req = {
        body: {},
        query: {},
        headers: {},
        params: { id: 'u1', organizationId: 'o1' },
        user: { userID: 'user-1', roleName: 'Administrador' },
        organizationScope: { scope: 'global', organizationIds: [] },
        t: (k) => k,
        app: { locals: { db: null } },
      };

      await handle(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.payload.success).toBe(false);
    });
  });

  describe('the caller-scope check', () => {
    // u1 is a Técnico holding org-a.
    function scopedDb() {
      return usersDb({}, buildRbacCollections([{ userAccountId: 'u1', accessType: 2, organizationId: 'org-a' }])).db;
    }

    it('refuses a /:id read when no organization scope was resolved', async () => {
      asScope(undefined);
      const res = await request(appWith(scopedDb())).get('/api/users/u1');
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Este usuário pertence a outra organização');
    });

    it('refuses an organization caller with no organizationIds a target in an organization, and reads it once it holds that one', async () => {
      asScope({ scope: 'organization' });
      const refused = await request(appWith(scopedDb())).get('/api/users/u1');
      expect(refused.status).toBe(403);

      asScope({ scope: 'organization', organizationIds: ['org-a'] });
      const read = await request(appWith(scopedDb())).get('/api/users/u1');
      expect(read.status).toBe(200);
      expect(read.body.data.email).toBe('alvo@example.com');
    });
  });

  describe('POST /register', () => {
    let registerUser;
    beforeEach(() => {
      registerUser = vi.spyOn(authService, 'registerUser').mockResolvedValue({ _id: 'new-1', username: 'novo' });
    });

    it.each([
      ['a phone of punctuation only', { phone: '(--)' }, { phone: null }],
      ['a null phone', { phone: null }, { phone: null }],
      ['an empty organizationId', { organizationId: '' }, { organizationId: null }],
    ])('passes %s on as null', async (_label, sent, expected) => {
      const res = await request(appWith({})).post('/api/users/register').send({ username: 'novo', ...sent });
      expect(res.status).toBe(201);
      expect(registerUser).toHaveBeenCalledWith({}, expect.objectContaining(expected), 'user-1');
    });

    it('writes no audit row when the request carries no user', async () => {
      const authImpl = (req, res, next) => { req.t = (key) => key; next(); };
      const res = await request(appWith({}, { authImpl })).post('/api/users/register').send({ username: 'novo' });
      expect(res.status).toBe(201);
      expect(registerUser).toHaveBeenCalledWith({}, expect.anything(), undefined);
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('audits a created user that carries only an id under that id', async () => {
      registerUser.mockResolvedValue({ id: 'plain-id' });
      const res = await request(appWith({})).post('/api/users/register').send({ username: 'novo' });
      expect(res.status).toBe(201);
      expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', resourceId: 'plain-id' }));
    });
  });

  it('GET / fills roleName, id and auditorRole for a row stored with no status, no roleName and no id', async () => {
    vi.spyOn(rbacService, 'resolveRoleDisplayName').mockResolvedValue('Técnico');
    vi.spyOn(rbacService, 'getActiveRoleCodes').mockResolvedValue(['auditor']);
    const { db } = usersDb({ find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ _id: 'u9', email: 'u9@example.com' }]) })) });

    const res = await request(appWith(db)).get('/api/users');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ _id: 'u9', id: 'u9', email: 'u9@example.com', roleName: 'Técnico', auditorRole: true }]);
    expect(rbacService.resolveRoleDisplayName).toHaveBeenCalledWith(db, 'u9');
  });

  it('GET /:id answers 404 users.notFound for an unknown user', async () => {
    const { db } = usersDb({ findOne: vi.fn().mockResolvedValue(null) });
    const res = await request(appWith(db)).get('/api/users/nobody');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('users.notFound');
  });

  describe('PUT /:id', () => {
    beforeEach(() => {
      vi.spyOn(rbacService, 'isAdministrator').mockResolvedValue(false);
      vi.spyOn(rbacService, 'userHasPermission').mockResolvedValue(true);
      vi.spyOn(rbacService, 'resolveRoleDisplayName').mockResolvedValue('Técnico');
      vi.spyOn(rbacService, 'getActiveRoleCodes').mockResolvedValue([]);
    });

    it('answers 404 for an unknown target and writes nothing', async () => {
      const { db, users } = usersDb({ findOne: vi.fn().mockResolvedValue(null) });
      const res = await request(appWith(db)).put('/api/users/nobody').send({ name: 'X' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('users.notFound');
      expect(users.updateOne).not.toHaveBeenCalled();
    });

    it('answers 422 with the validation errors for an invalid body and writes nothing', async () => {
      const { db, users } = usersDb();
      const res = await request(appWith(db)).put('/api/users/u1').send({ email: 'not-an-email' });
      expect(res.status).toBe(422);
      expect(res.body.details).toEqual(['email é obrigatório e deve ser um email válido']);
      expect(users.updateOne).not.toHaveBeenCalled();
    });

    it('stores a Portuguese status in English, and a blank or punctuation phone and a blank organizationId as null', async () => {
      const { db, users } = usersDb();
      const res = await request(appWith(db)).put('/api/users/u1').send({ status: 'Suspenso', phone: '(--)', organizationId: '' });
      expect(res.status).toBe(200);
      expect(users.updateOne.mock.calls[0][1].$set).toMatchObject({ accountStatus: 'suspended', phone: null, organizationId: null });

      const blank = await request(appWith(db)).put('/api/users/u1').send({ phone: '' });
      expect(blank.status).toBe(200);
      expect(users.updateOne.mock.calls[1][1].$set.phone).toBeNull();
    });

    // A blank '' never gets here: UserModel.validate refuses it (Invalid Date)
    // with 422, so a cleared validity date arrives as null.
    it('stores a null roleValidFrom as null and a roleValidUntil string as a Date', async () => {
      const { db, users } = usersDb();
      const res = await request(appWith(db)).put('/api/users/u1').send({ roleValidFrom: null, roleValidUntil: '2027-01-01T00:00:00.000Z' });
      expect(res.status).toBe(200);
      const { $set } = users.updateOne.mock.calls[0][1];
      expect($set.roleValidFrom).toBeNull();
      expect($set.roleValidUntil).toEqual(new Date('2027-01-01T00:00:00.000Z'));
    });

    it('answers 404 when the update matches no document', async () => {
      const { db } = usersDb({ updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }) });
      const res = await request(appWith(db)).put('/api/users/u1').send({ name: 'Novo' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Usuário não encontrado');
    });

    it('answers 404 users.updateNotFound when the updated user cannot be read back', async () => {
      const findOne = vi.fn().mockResolvedValueOnce({ ...TARGET }).mockResolvedValueOnce(null);
      const { db } = usersDb({ findOne });
      const res = await request(appWith(db)).put('/api/users/u1').send({ name: 'Novo' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('users.updateNotFound');
    });
  });

  describe('/:id/organizations', () => {
    it('GET answers 404 for an unknown user', async () => {
      const { db } = usersDb({ findOne: vi.fn().mockResolvedValue(null) });
      const res = await request(appWith(db)).get('/api/users/nobody/organizations');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('users.notFound');
    });

    it('POST passes a non-string organizationId on as sent', async () => {
      const grant = vi.spyOn(rbacService, 'grantOrganizationScope').mockResolvedValue({ created: false });
      vi.spyOn(rbacService, 'listOrganizationScopes').mockResolvedValue({ global: false, organizationIds: ['org-a'] });
      const { db } = usersDb();
      const res = await request(appWith(db)).post('/api/users/u1/organizations').send({ organizationId: 42 });
      expect(res.status).toBe(200);
      expect(grant).toHaveBeenCalledWith(db, { userAccountId: 'u1', organizationId: 42, grantedBy: 'user-1' });
    });

    it('POST answers 500 for an error with no statusCode and no "não encontrado"', async () => {
      vi.spyOn(rbacService, 'grantOrganizationScope').mockRejectedValue(new Error('boom'));
      const { db } = usersDb();
      const res = await request(appWith(db)).post('/api/users/u1/organizations').send({ organizationId: 'org-b' });
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('boom');
    });

    it('DELETE answers 500 for an error with no statusCode', async () => {
      vi.spyOn(rbacService, 'revokeOrganizationScope').mockRejectedValue(new Error('boom'));
      const { db } = usersDb();
      const res = await request(appWith(db)).delete('/api/users/u1/organizations/org-b');
      expect(res.status).toBe(500);
      expect(res.body.message).toBe('boom');
    });
  });

  describe('GET /:id/validate-status', () => {
    it('answers 404 for an unknown user', async () => {
      const { db } = usersDb({ findOne: vi.fn().mockResolvedValue(null) });
      const res = await request(appWith(db)).get('/api/users/nobody/validate-status');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('users.notFound');
    });

    it('validate-status answers inactive for a user with no accountStatus', async () => {
      const { db } = usersDb({ findOne: vi.fn().mockResolvedValue({ _id: 'u1' }) });
      const res = await request(appWith(db)).get('/api/users/u1/validate-status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { status: 'inactive' } });
    });
  });

  describe('POST /register-patient', () => {
    it('stamps an organization caller\'s own organization as the clinical unit', async () => {
      asScope({ scope: 'organization', organizationIds: ['org-a'] });
      const createPatient = vi.spyOn(patientService, 'createPatient').mockResolvedValue({ _id: 'p1' });
      const res = await request(appWith({})).post('/api/users/register-patient').send({ clinicalUnitId: 'org-b' });
      expect(res.status).toBe(201);
      expect(createPatient).toHaveBeenCalledWith({}, expect.objectContaining({ clinicalUnitId: 'org-a' }));
    });

    it.each([[403, 403], [422, 422], [undefined, 400]])('maps an error with statusCode %s to %s', async (statusCode, expected) => {
      vi.spyOn(patientService, 'createPatient').mockRejectedValue(Object.assign(new Error('falhou'), { statusCode }));
      const res = await request(appWith({})).post('/api/users/register-patient').send({});
      expect(res.status).toBe(expected);
      expect(res.body.message).toBe('falhou');
    });
  });

  describe('POST /register-sample', () => {
    const handle = router.stack.find((l) => l.route?.path === '/register-sample').route.stack.at(-1).handle;

    async function call(req) {
      const res = createResponse();
      await handle({
        body: {},
        headers: {},
        organizationScope: { scope: 'global', organizationIds: [] },
        t: (k) => k,
        app: { locals: { db: createDbMock({}) } },
        ...req,
      }, res);
      return res;
    }

    it.each([
      ['only an _id', { _id: 'mongo-1' }, { userId: 'mongo-1', userName: null, userRole: null }],
      ['only a username and role', { username: 'jdoe', role: 'Técnico' }, { userId: null, userName: 'jdoe', userRole: 'Técnico' }],
    ])('takes the actor from a user with %s, the forwarded address and no user agent', async (_label, user, expected) => {
      const execute = vi.spyOn(RegisterSampleUseCase.prototype, 'execute').mockResolvedValue({ sample: { _id: 's1' } });
      const res = await call({ user, headers: { 'x-forwarded-for': '10.0.0.7' } });
      expect(res.statusCode).toBe(201);
      expect(execute.mock.calls[0][0].actor).toEqual({ ...expected, ipAddress: '10.0.0.7', userAgent: null });
    });

    it('answers 403 STRICT_MODE_BLOCKED for an error coded so whose message does not say it', async () => {
      vi.spyOn(RegisterSampleUseCase.prototype, 'execute').mockRejectedValue(Object.assign(new Error('linhagem obrigatória'), { code: 'STRICT_MODE_BLOCKED' }));
      const res = await call({ user: { userID: 'user-1' } });
      expect(res.statusCode).toBe(403);
      expect(res.payload).toEqual({ success: false, error: 'STRICT_MODE_BLOCKED', message: 'linhagem obrigatória' });
    });
  });

  describe('POST /record-withdrawal', () => {
    const SAMPLE_ID = '507f1f77bcf86cd799439013';

    it('checks consent against consentScope when no requiredScope is sent', async () => {
      vi.spyOn(sampleService, 'getSample').mockResolvedValue({ _id: SAMPLE_ID });
      const validateAccess = vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
      const withdraw = vi.spyOn(sampleService, 'withdrawSample').mockResolvedValue({ withdrawn: true });
      const res = await request(appWith({})).post('/api/users/record-withdrawal').send({ sampleID: SAMPLE_ID, consentScope: 'research' });
      expect(res.status).toBe(200);
      expect(validateAccess).toHaveBeenCalledWith(SAMPLE_ID, 'research');
      expect(withdraw.mock.calls[0][2]).toEqual({ consentScope: 'research' });
    });

    it('answers 400 users.sampleIDRequired with no sampleID and withdraws nothing', async () => {
      vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
      const withdraw = vi.spyOn(sampleService, 'withdrawSample').mockResolvedValue({});
      const res = await request(appWith({})).post('/api/users/record-withdrawal').send({ reason: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('users.sampleIDRequired');
      expect(withdraw).not.toHaveBeenCalled();
    });
  });

  it.each([[403, 403], [422, 422], [undefined, 400]])('POST /register-sensor maps an error with statusCode %s to %s', async (statusCode, expected) => {
    vi.spyOn(sensorService, 'createSensor').mockRejectedValue(Object.assign(new Error('falhou'), { statusCode }));
    const res = await request(appWith({})).post('/api/users/register-sensor').send({});
    expect(res.status).toBe(expected);
    expect(res.body.message).toBe('falhou');
  });

  it('POST /:id/reset-mfa answers 404 for an unknown target and writes nothing', async () => {
    const { db, users } = usersDb({ findOne: vi.fn().mockResolvedValue(null) });
    const res = await request(appWith(db)).post('/api/users/nobody/reset-mfa').send({});
    expect(res.status).toBe(404);
    expect(users.updateOne).not.toHaveBeenCalled();
    expect(sessionService.invalidateUserSessions).not.toHaveBeenCalled();
  });
});
