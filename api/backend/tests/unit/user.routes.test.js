import { describe, it, expect } from 'vitest';
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
    // One entry per requirePermission-gated registration -- all 11 of them,
    // confirmed against user.routes.js line-by-line before writing this
    // table: :40, :124, :215, :526, :604, :632, :714, :757, :795, :851,
    // :919. Each pins the exact permission code (and, for the three
    // two-argument calls -- withdrawSample/UPDATE, resetMFA/UPDATE,
    // forcePasswordReset/UPDATE -- the explicit action) the route hands
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
      // :795 -- note this is a Temperature code (viewTemperature) on a User
      // router, pinned as-is; whether it is the *right* code is #888's
      // question, not this slice's.
      { label: 'POST /register-sensor (viewTemperature) :795', method: 'post', path: '/register-sensor', expectedArgs: ['viewTemperature'] },
      { label: 'POST /:id/reset-mfa (resetMFA, UPDATE) :851', method: 'post', path: '/u1/reset-mfa', expectedArgs: ['resetMFA', 'UPDATE'] },
      { label: 'POST /:id/force-password-reset (forcePasswordReset, UPDATE) :919', method: 'post', path: '/u1/force-password-reset', expectedArgs: ['forcePasswordReset', 'UPDATE'] },
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
  it('GET /logs is shadowed by GET /:id (user.routes.js registration order) -- pinned pending investigation', async () => {
    const { router } = loadRoute();
    // GET /:id's handler queries db.collection('users').findOne(...) and
    // returns 404 when nothing matches -- distinct from GET /logs's own
    // handler, which would call logService.getLogs and either succeed (200)
    // or fail differently (500), never with this 404/'users.notFound' shape.
    const usersCollectionStub = { findOne: async () => null };
    const app = buildApp(router, {
      db: { collection: () => usersCollectionStub },
    });

    const res = await request(app).get('/api/users/logs');

    // If GET /logs's own registration (line 823, logService.getLogs) were
    // actually reached, this would not be a 404 with 'users.notFound' --
    // it would be a 200 (or a differently-shaped 500). It is 404/
    // 'users.notFound' instead, because GET /:id (line 172) matches first
    // and treats 'logs' as the target user id.
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('users.notFound');
  });
});
