import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

// Same one-time-require pattern as storage.routes.test.js (see that file's
// own comment, confirmed against source before copying it here):
// patient.routes.js destructures `{ authenticate }` from auth and
// `{ requirePermission, requireOrganizationScope }` from rbac AT
// REQUIRE-TIME, so a proxy has to be installed on each module's exports
// BEFORE the single require() of the route file below, or the route would
// freeze on whatever the real implementation was at that moment and no
// later swap would ever be observed.
const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/interface/routes/patient.routes.js');
const patientControllerPath = require.resolve('../../src/controllers/paciente.controller');
const consentControllerPath = require.resolve('../../src/controllers/consent.controller');

let currentAuth = defaultAuth;
// Default no-op passthroughs; individual tests swap these in via loadRoute().
let currentRequirePermission = () => (req, res, next) => next();
let currentRequireOrganizationScope = (req, res, next) => next();

function defaultAuth(req, res, next) {
  req.user = { userID: 'user-1', roleName: 'Administrador' };
  req.t = (key) => key;
  next();
}

const authModule = require(authPath);
authModule.authenticate = (req, res, next) => currentAuth(req, res, next);

const rbacModule = require(rbacPath);
// requirePermission is a FACTORY: patient.routes.js calls e.g.
// requirePermission('createPatient') exactly ONCE per route, at
// registration time, baking that route's args into the closure below
// forever (correctly -- that IS the route's permanent declaration). The
// returned middleware re-invokes `currentRequirePermission(...args)` on
// every REQUEST though, which is what lets a test swap the FACTORY
// behaviour (denying vs. passthrough) after the route is already loaded,
// while still observing the exact args that specific route registered
// with.
rbacModule.requirePermission = (...args) => (req, res, next) =>
  currentRequirePermission(...args)(req, res, next);
// requireOrganizationScope is used directly as middleware (not called as a
// factory) at each call site, so there are no "arguments" to pin here --
// only whether the route wires it in at all. The proxy below dispatches
// through the closure variable per REQUEST, same swappability reasoning.
rbacModule.requireOrganizationScope = (req, res, next) => currentRequireOrganizationScope(req, res, next);

const patientController = require(patientControllerPath);
const consentController = require(consentControllerPath);

// patient.routes.js does `patientController.<method>.bind(patientController)`
// inline at registration time, so -- same freezing hazard as authenticate/
// requirePermission above -- these have to be replaced BEFORE the single
// require() of the route file, not after. A flat stub (no further
// swapping needed) is enough: every gate test only cares whether the
// request reaches the controller at all, and which one, not what the
// controller actually does with real data.
const CONTROLLER_METHODS = [
  'cadastrar', 'listar', 'search', 'resendConsentNotification',
  'listBiomarkerObservations', 'createBiomarkerObservation', 'buscar',
  'reidentify', 'atualizar', 'deletar', 'validateID', 'findForEdit',
];
for (const method of CONTROLLER_METHODS) {
  patientController[method] = (req, res) => res.status(200).json({ success: true, stub: method });
}
consentController.getPatientConsent = (req, res) => res.status(200).json({ success: true, stub: 'getPatientConsent' });

// Required exactly once - see comments above.
const router = require(routePath);

function loadRoute({ authImpl, requirePermissionImpl, requireOrganizationScopeImpl } = {}) {
  currentAuth = authImpl || defaultAuth;
  currentRequirePermission = requirePermissionImpl || (() => (req, res, next) => next());
  currentRequireOrganizationScope = requireOrganizationScopeImpl || ((req, res, next) => next());
  return { router };
}

function buildApp(router) {
  const app = express();
  app.use(express.json());
  app.locals.db = {};
  app.use('/api/patients', router);
  return app;
}

// Copied from storage.routes.test.js:1174-1205 (confirmed against that file
// before use): records the arguments the middleware FACTORY was called
// with, not just that a 403 came back -- an unconditional-403 stub that
// discarded the code argument would pass identically whichever
// requirePermission code the route actually declared (issue #888).
function denyingRequirePermission() {
  const recordedCalls = [];
  const factory = (...args) => {
    recordedCalls.push(args);
    return (req, res) => res.status(403).json({ success: false, error: 'Acesso negado', gate: 'permission' });
  };
  factory.recordedCalls = recordedCalls;
  return factory;
}

// Same recording idea, adapted for requireOrganizationScope: it is not a
// factory (no args to pin), so what is pinned here is only whether the
// route's chain reaches it at all.
function denyingRequireOrganizationScope() {
  const recordedCalls = [];
  const impl = (req, res, next) => {
    recordedCalls.push(true);
    return res.status(403).json({ success: false, error: 'Sem organização atribuída', gate: 'orgScope' });
  };
  impl.recordedCalls = recordedCalls;
  return impl;
}

describe('patient.routes authorization gates (issue #921)', () => {
  describe('requirePermission argument pinning', () => {
    // One entry per requirePermission-gated registration (7 of the file's
    // 12 gated routes carry requirePermission). Each pins the exact
    // permission code (and, for reidentify, the explicit action) the route
    // hands the gate factory.
    const CASES = [
      { label: 'POST / (createPatient)', method: 'post', path: '/', expectedArgs: ['createPatient'] },
      { label: 'POST /:id/consent/resend (createPatient)', method: 'post', path: '/p1/consent/resend', expectedArgs: ['createPatient'] },
      { label: 'POST /:id/observations (createPatient)', method: 'post', path: '/p1/observations', expectedArgs: ['createPatient'] },
      // The only two-argument requirePermission call in the file.
      { label: 'POST /:id/reidentify (reidentifyParticipant, READ)', method: 'post', path: '/p1/reidentify', expectedArgs: ['reidentifyParticipant', 'READ'] },
      { label: 'PUT /:id (createPatient)', method: 'put', path: '/p1', expectedArgs: ['createPatient'] },
      { label: 'DELETE /:id (createPatient)', method: 'delete', path: '/p1', expectedArgs: ['createPatient'] },
      { label: 'POST /find-for-edit (createPatient)', method: 'post', path: '/find-for-edit', expectedArgs: ['createPatient'] },
    ];

    for (const { label, method, path, expectedArgs } of CASES) {
      it(`pins requirePermission(${JSON.stringify(expectedArgs)}) for ${label}`, async () => {
        const requirePermissionImpl = denyingRequirePermission();
        const { router } = loadRoute({ requirePermissionImpl });
        const app = buildApp(router);

        const res = await request(app)[method](`/api/patients${path}`).send({});

        expect(res.status).toBe(403);
        expect(res.body.gate).toBe('permission');
        // The load-bearing assertion: a stub that discarded its arguments
        // would answer 403 identically no matter what code the route
        // actually declared.
        expect(requirePermissionImpl.recordedCalls).toEqual([expectedArgs]);
      });
    }
  });

  describe('requireOrganizationScope presence pinning', () => {
    // Ten of the twelve gated registrations wire in requireOrganizationScope.
    const GATED_CASES = [
      { label: 'GET /', method: 'get', path: '/' },
      { label: 'GET /search', method: 'get', path: '/search' },
      { label: 'POST /:id/consent/resend', method: 'post', path: '/p1/consent/resend' },
      { label: 'GET /:id/observations', method: 'get', path: '/p1/observations' },
      { label: 'POST /:id/observations', method: 'post', path: '/p1/observations' },
      { label: 'GET /:id', method: 'get', path: '/p1' },
      { label: 'POST /:id/reidentify', method: 'post', path: '/p1/reidentify' },
      { label: 'PUT /:id', method: 'put', path: '/p1' },
      { label: 'DELETE /:id', method: 'delete', path: '/p1' },
    ];

    for (const { label, method, path } of GATED_CASES) {
      it(`applies requireOrganizationScope on ${label}`, async () => {
        const requireOrganizationScopeImpl = denyingRequireOrganizationScope();
        // requirePermission left as the default passthrough: any
        // requirePermission this registration also carries must not be
        // what stops the request, so a 403 here can only be attributed to
        // requireOrganizationScope.
        const { router } = loadRoute({ requireOrganizationScopeImpl });
        const app = buildApp(router);

        const res = await request(app)[method](`/api/patients${path}`).send({});

        expect(res.status).toBe(403);
        expect(res.body.gate).toBe('orgScope');
        expect(requireOrganizationScopeImpl.recordedCalls).toEqual([true]);
      });
    }

    // GET /:id/observations sits behind requireOrganizationScope AND
    // ahead of GET /:id in file order -- included above via its own path
    // shape so it can't collide with GET /:id's registration.

    // Two of the twelve gated registrations (POST / and POST
    // /find-for-edit) carry requirePermission but explicitly do NOT wire
    // in requireOrganizationScope -- confirmed against
    // patient.routes.js:9 and :46. A denying requireOrganizationScope
    // stub must therefore never fire on these; the request should sail
    // through to the (stubbed) controller instead.
    const UNGATED_CASES = [
      { label: 'POST /', method: 'post', path: '/', expectedStub: 'cadastrar' },
      { label: 'POST /find-for-edit', method: 'post', path: '/find-for-edit', expectedStub: 'findForEdit' },
    ];

    for (const { label, method, path, expectedStub } of UNGATED_CASES) {
      it(`does not apply requireOrganizationScope on ${label}`, async () => {
        const requireOrganizationScopeImpl = denyingRequireOrganizationScope();
        const { router } = loadRoute({ requireOrganizationScopeImpl });
        const app = buildApp(router);

        const res = await request(app)[method](`/api/patients${path}`).send({});

        // Not the 403/orgScope shape the denying stub would answer with if
        // it had actually been reached.
        expect(res.status).toBe(200);
        expect(res.body.stub).toBe(expectedStub);
        expect(requireOrganizationScopeImpl.recordedCalls).toEqual([]);
      });
    }
  });

  // GET /operational (patient.routes.js:49) is registered AFTER GET /:id
  // (patient.routes.js:31), and both are plain single-segment GET routes
  // under the router root. Express matches router.METHOD registrations in
  // registration order, not by literal-vs-param specificity, so a request
  // to /api/patients/operational actually falls through GET /:id (id =
  // 'operational') first and never reaches line 49's own registration.
  // Both routes happen to carry requireOrganizationScope and no
  // requirePermission, so this does not change which GATE runs -- but it
  // does mean GET /operational's own registration is unreachable, and the
  // wrong controller method (buscar, not listar) answers a real request
  // to that path. Pinned here as observed; not fixed (out of this file's
  // boundary) -- see the report for the suggested follow-up issue.
  it('GET /operational reaches its own registration, not GET /:id (#926)', async () => {
    const { router } = loadRoute();
    const app = buildApp(router);

    const res = await request(app).get('/api/patients/operational');

    expect(res.status).toBe(200);
    // #926: this asserted 'buscar' when it was written -- GET /operational was
    // registered below GET /:id, so the parameterised route matched first with
    // id='operational' and the operational endpoint was dead code. The
    // registration moved above GET /:id; 'listar' is the endpoint's own
    // controller method and this assertion is what will catch it moving back.
    expect(res.body.stub).toBe('listar');
  });
});
