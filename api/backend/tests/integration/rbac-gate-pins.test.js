import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const { PERMISSION_CATALOG } = require('../../src/services/rbac-catalog-seed.service');

// #1342: proves every row of tests/rbac-pins/*.pins.js against the REAL
// requirePermission/requireRole middleware, through the mounted app. A row is
// pinned only when both halves hold:
//
// - a caller who lacks exactly what the row names gets that gate's own 403.
//   For a permission row that caller holds every OTHER catalog code at the
//   top hierarchy level, so the refusal can only come from this code; for a
//   role row it holds every code at each level the row leaves out.
// - a caller who holds it gets past that gate: any response but that gate's
//   403 (the handler then runs against an empty mock store, so its status is
//   not asserted).
//
// The two gates answer with different messages, which is what separates a
// gate's 403 from any other 403 a route returns (org scope, ownership).
// rbac-pinned-sites.arch.test.js checks each row against the route file's
// declared gate, so a row cannot pin a gate the route does not carry.

const PIN_DIR = path.resolve(__dirname, '../rbac-pins');
const TABLES = fs.readdirSync(PIN_DIR)
  .filter((name) => name.endsWith('.pins.js'))
  .sort()
  .map((name) => ({ name, ...require(path.join(PIN_DIR, name)) }));

const GATE_MESSAGE = {
  permission: 'Você não tem permissão para esta ação',
  roles: 'Você não tem permissão para acessar este recurso',
};
const ALL_CODES = Object.keys(PERMISSION_CATALOG);
const LEVELS = [1, 2, 3, 4];
const PARAM_VALUE = '507f1f77bcf86cd799439011';
const USER = 'pin-user';
const ORG = 'test-org-default';

function urlFor(mount, routePath) {
  const joined = routePath === '/' ? mount : `${mount}${routePath}`;
  return joined.replace(/:[A-Za-z_$][\w$]*/g, PARAM_VALUE);
}

function token() {
  return jwt.sign(
    { userID: USER, accessType: 4, roleName: 'Administrador', name: 'Pin', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// A permission caller: one test-only role at hierarchy 4, so every role gate
// on the route lets it through and only the permission decides.
function permissionCaller(codes) {
  const role = { roleCode: 'pin-role', hierarchyLevel: 4, permissions: codes };
  return createDbMock(buildRbacCollections([{ userAccountId: USER, roleCodes: ['pin-role'], organizationId: ORG }], [role]));
}

// A role caller: the seeded role for `level`, plus a level-less role holding
// every code, so every permission gate lets it through and only the level
// decides.
function roleCaller(level) {
  const role = { roleCode: 'pin-all', hierarchyLevel: null, permissions: ALL_CODES };
  return createDbMock(buildRbacCollections([{ userAccountId: USER, accessType: level, roleCodes: ['pin-all'], organizationId: ORG }], [role]));
}

async function send(db, method, url) {
  app.locals.db = db;
  const call = request(app)[method.toLowerCase()](url).set('Authorization', `Bearer ${token()}`);
  return ['POST', 'PUT', 'PATCH'].includes(method) ? call.send({}) : call;
}

function isGateRefusal(res, kind) {
  return res.status === 403 && res.body && res.body.message === GATE_MESSAGE[kind];
}

function describeRow(row) {
  const target = row.use ? `router.use (probe ${row.probe.method} ${row.probe.path})` : `${row.method} ${row.path}`;
  return row.permission ? `${target} requires permission ${row.permission}` : `${target} requires role ${row.roles.join('|')}`;
}

beforeEach(() => {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-pin' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-pin' });
});
afterEach(() => { vi.restoreAllMocks(); });

it('#1342: the pin directory holds at least one table', () => {
  expect(TABLES.length).toBeGreaterThan(0);
});

for (const table of TABLES) {
  describe(`${table.name} (${table.file} at ${table.mount})`, () => {
    for (const row of table.pins) {
      const method = row.use ? row.probe.method : row.method;
      const url = urlFor(table.mount, row.use ? row.probe.path : row.path);

      if (row.permission) {
        it(`${describeRow(row)}: refused without it, through with it`, async () => {
          const without = await send(permissionCaller(ALL_CODES.filter((c) => c !== row.permission)), method, url);
          expect(isGateRefusal(without, 'permission'), `without ${row.permission}: ${without.status} ${JSON.stringify(without.body)}`).toBe(true);
          const holding = await send(permissionCaller(ALL_CODES), method, url);
          expect(isGateRefusal(holding, 'permission'), `holding every code: ${holding.status} ${JSON.stringify(holding.body)}`).toBe(false);
        });
      } else {
        it(`${describeRow(row)}: refused at every other level, through at each listed one`, async () => {
          for (const level of LEVELS) {
            const res = await send(roleCaller(level), method, url);
            const refused = isGateRefusal(res, 'roles');
            expect(refused, `level ${level}: ${res.status} ${JSON.stringify(res.body)}`).toBe(!row.roles.includes(level));
          }
        });
      }
    }
  });
}
