import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';

const require = createRequire(import.meta.url);

// Same one-time-require pattern as user.routes.test.js: access.routes.js
// destructures `{ authenticate }` and `{ requirePermission }` AT REQUIRE-TIME,
// so the proxies go onto each module's exports BEFORE the single require() of
// the route file below.
const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/interface/routes/access.routes.js');

let currentRequirePermission = () => (req, res, next) => next();

const authModule = require(authPath);
authModule.authenticate = (req, res, next) => {
  req.user = { userID: 'user-1', roleName: 'Tecnico' };
  req.t = (key) => key;
  next();
};

const rbacModule = require(rbacPath);
rbacModule.requirePermission = (...args) => (req, res, next) =>
  currentRequirePermission(...args)(req, res, next);

const router = require(routePath);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.locals.db = {};
  app.use('/api/access', router);
  return app;
}

// Records the factory's arguments, so a stub that answered 403 regardless of
// the declared code could not pass (#888).
function denyingRequirePermission() {
  const recordedCalls = [];
  const factory = (...args) => {
    recordedCalls.push(args);
    return (req, res) => res.status(403).json({ success: false, error: 'Acesso negado', gate: 'permission' });
  };
  factory.recordedCalls = recordedCalls;
  return factory;
}

describe('access.routes authorization gates', () => {
  // #1202: GET / and GET /:id were authenticate-only, so any logged-in user
  // could list every access grant. They now share the writes' gate, the same
  // code GET /api/users reads under.
  const CASES = [
    { label: 'GET /', method: 'get', path: '' },
    { label: 'GET /:id', method: 'get', path: '/a1' },
    { label: 'POST /', method: 'post', path: '' },
    { label: 'PUT /:id', method: 'put', path: '/a1' },
    { label: 'DELETE /:id', method: 'delete', path: '/a1' },
  ];

  for (const { label, method, path } of CASES) {
    it(`pins requirePermission('createUser') for ${label}`, async () => {
      const requirePermissionImpl = denyingRequirePermission();
      currentRequirePermission = requirePermissionImpl;

      const res = await request(buildApp())[method](`/api/access${path}`).send({});

      expect(res.status).toBe(403);
      expect(res.body.gate).toBe('permission');
      expect(requirePermissionImpl.recordedCalls).toEqual([['createUser']]);
    });
  }
});
