import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

// Same one-time-require pattern as storage.routes.test.js / patient.routes.test.js /
// user.routes.test.js (confirmed against all three before copying it here):
// accessRequest.js destructures `{ authenticate }` from auth and
// `{ requirePermission }` from rbac AT REQUIRE-TIME, so a proxy has to be
// installed on each module's exports BEFORE the single require() of the
// route file below, or the route would freeze on whatever the real
// implementation was at that moment and no later swap would ever be
// observed.
//
// Note the directory: this router lives under src/routes/, not
// src/interface/routes/ like patient.routes.js and user.routes.js -- it is
// the "second routes directory" issue #921 slice 3 calls out. It requires
// the SAME auth.js / rbac.js modules under src/infrastructure/middleware/
// though (confirmed against accessRequest.js:3-4), so the proxy targets are
// unchanged from the other two test files.
const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/routes/accessRequest.js');

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
// requirePermission is a FACTORY: accessRequest.js calls e.g.
// requirePermission('manageAccessRequests') exactly ONCE per route, at
// registration time, baking that route's args into the closure below
// forever (correctly -- that IS the route's permanent declaration). The
// returned middleware re-invokes `currentRequirePermission(...args)` on
// every REQUEST though, which is what lets a test swap the FACTORY
// behaviour (denying vs. passthrough) after the route is already loaded,
// while still observing the exact args that specific route registered
// with.
rbacModule.requirePermission = (...args) => (req, res, next) =>
  currentRequirePermission(...args)(req, res, next);

// Required exactly once - see comments above. Every requirePermission-gated
// route's own handler body (db access, service calls, etc.) is never
// reached in the gate-pinning tests below, because the denying stub
// answers 403 before the route callback runs -- so, like
// user.routes.test.js and unlike patient.routes.test.js, no controller
// stubbing is needed here.
const router = require(routePath);

function loadRoute({ authImpl, requirePermissionImpl } = {}) {
  currentAuth = authImpl || defaultAuth;
  currentRequirePermission = requirePermissionImpl || (() => (req, res, next) => next());
  return { router };
}

function buildApp(router) {
  const app = express();
  app.use(express.json());
  app.locals.db = {};
  app.use('/api/access-requests', router);
  return app;
}

// Copied from storage.routes.test.js:1174-1205 / patient.routes.test.js /
// user.routes.test.js (confirmed against all three before use): records the
// arguments the middleware FACTORY was called with, not just that a 403
// came back -- an unconditional-403 stub that discarded the code argument
// would pass identically whichever requirePermission code the route
// actually declared (issue #888).
function denyingRequirePermission() {
  const recordedCalls = [];
  const factory = (...args) => {
    recordedCalls.push(args);
    return (req, res) => res.status(403).json({ success: false, error: 'Acesso negado', gate: 'permission' });
  };
  factory.recordedCalls = recordedCalls;
  return factory;
}

describe('accessRequest.routes authorization gates (issue #921)', () => {
  describe('requirePermission argument pinning', () => {
    // One entry per requirePermission-gated registration -- all 8 of the
    // file's routes, confirmed against accessRequest.js line-by-line before
    // writing this table: :13-:20. Every single one is gated behind
    // 'manageAccessRequests' (see the file's own RF024 comment for why),
    // but four of the eight (:14-:17, the mutating id-scoped actions) pass
    // an explicit 'UPDATE' second argument while the other four (:13, :18,
    // :19, :20) pass only the permission code. That single-vs-two-argument
    // split is invisible to a status-only test and is what this table
    // exists to pin.
    const CASES = [
      { label: 'POST / (createAccessRequest) :13', method: 'post', path: '/', expectedArgs: ['manageAccessRequests'] },
      { label: 'POST /:id/evaluate (evaluateCompatibility) :14', method: 'post', path: '/ar1/evaluate', expectedArgs: ['manageAccessRequests', 'UPDATE'] },
      { label: 'POST /:id/decision (recordDecision) :15', method: 'post', path: '/ar1/decision', expectedArgs: ['manageAccessRequests', 'UPDATE'] },
      { label: 'POST /:id/distribute (distribute) :16', method: 'post', path: '/ar1/distribute', expectedArgs: ['manageAccessRequests', 'UPDATE'] },
      { label: 'POST /:id/revoke (revoke) :17', method: 'post', path: '/ar1/revoke', expectedArgs: ['manageAccessRequests', 'UPDATE'] },
      { label: 'GET /:id/access-check (getAccessCheck) :18', method: 'get', path: '/ar1/access-check', expectedArgs: ['manageAccessRequests'] },
      { label: 'GET /:id (getById) :19', method: 'get', path: '/ar1', expectedArgs: ['manageAccessRequests'] },
      { label: 'GET / (getAll) :20', method: 'get', path: '/', expectedArgs: ['manageAccessRequests'] },
    ];

    for (const { label, method, path, expectedArgs } of CASES) {
      it(`pins requirePermission(${JSON.stringify(expectedArgs)}) for ${label}`, async () => {
        const requirePermissionImpl = denyingRequirePermission();
        const { router } = loadRoute({ requirePermissionImpl });
        const app = buildApp(router);

        const res = await request(app)[method](`/api/access-requests${path}`).send({});

        expect(res.status).toBe(403);
        expect(res.body.gate).toBe('permission');
        // The load-bearing assertion: a stub that discarded its arguments
        // would answer 403 identically no matter what code the route
        // actually declared -- including silently swallowing the second
        // 'UPDATE' argument on the four two-arg calls (:14-:17).
        expect(requirePermissionImpl.recordedCalls).toEqual([expectedArgs]);
      });
    }
  });

  it('does not apply requireOrganizationScope anywhere on this router (confirmed absent)', () => {
    // accessRequest.js has no `requireOrganizationScope` seam at all --
    // confirmed by reading the full file before writing this test: it only
    // imports `authenticate` and `requirePermission`, never
    // requireOrganizationScope. RF024 gates distribution and revocation of
    // biobank material to external requesters behind a single flat
    // permission check with no organization-scope filtering at all -- worth
    // recording explicitly (per the brief) rather than leaving as an
    // absence nobody wrote down. The only way to pin "not applied anywhere"
    // honestly is to assert its absence from the route module's own source,
    // so this test fails the moment someone wires the middleware in
    // without a corresponding update here.
    const source = fs.readFileSync(routePath, 'utf8');
    expect(source).not.toMatch(/requireOrganizationScope/);
  });

  // Route shadowing check (accessRequest.js:13-20): Express matches
  // router.METHOD registrations in file order with no static-over-parameter
  // priority, so a literal path registered after a same-depth `/:param`
  // path on the same method is dead (two confirmed cases elsewhere this
  // session: patient.routes.js GET /operational behind GET /:id, and
  // user.routes.js GET /logs behind GET /:id).
  //
  // Checked every same-method pair in this file by path SEGMENT COUNT
  // (Express only routes a URL through the patterns matching its own
  // segment count):
  //   POST: '/' (0 segs), '/:id/evaluate', '/:id/decision',
  //         '/:id/distribute', '/:id/revoke' (2 segs each, distinct
  //         literal suffixes) -- no two POST registrations share both a
  //         segment count and a literal suffix, so none can shadow another
  //         regardless of order.
  //   GET:  '/:id/access-check' (2 segs), '/:id' (1 seg), '/' (0 segs) --
  //         three different segment counts, so none can shadow another
  //         either, regardless of order.
  // Unlike patient.routes.js's GET /operational vs GET /:id (both 1-segment
  // GETs, genuinely colliding), no pair in this router can collide by
  // construction -- confirmed by reading the file, not assumed. No
  // shadowing found in this router.
  //
  // The specific pair the brief calls out -- GET /:id/access-check (:18)
  // registered before GET /:id (:19) -- is doubly safe: it is registration
  // order AND segment count both working in its favour. The test below
  // still exercises it directly: since no other GET pattern in this router
  // matches a 2-segment path, a 403/'permission' response to
  // GET /:id/access-check can only have been produced by line 18's own
  // registration (a shadowing GET /:id would have to match a 1-segment
  // path and simply would not match this URL at all).
  it('GET /:id/access-check (:18) is reached directly, not shadowed by GET /:id (:19) -- confirmed by segment count', async () => {
    const requirePermissionImpl = denyingRequirePermission();
    const { router } = loadRoute({ requirePermissionImpl });
    const app = buildApp(router);

    const res = await request(app).get('/api/access-requests/ar1/access-check').send({});

    expect(res.status).toBe(403);
    expect(res.body.gate).toBe('permission');
    expect(requirePermissionImpl.recordedCalls).toEqual([['manageAccessRequests']]);
  });
});
