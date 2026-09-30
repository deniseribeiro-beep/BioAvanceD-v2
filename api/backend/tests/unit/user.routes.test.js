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
      // #1020: RF003 AC#5's administrator session revoke.
      { label: 'POST /:id/revoke-sessions (revokeSessions, UPDATE)', method: 'post', path: '/u1/revoke-sessions', expectedArgs: ['revokeSessions', 'UPDATE'] },
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
