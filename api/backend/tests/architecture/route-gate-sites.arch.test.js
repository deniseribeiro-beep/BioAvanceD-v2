// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1342: the shared gate-site extractor (helpers/route-gate-sites.js). A
// guard built on it passes vacuously if it stops matching, so these pin
// what it must find on the real tree and on a known snippet.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { gateSites, gateSitesIn, routeFiles } = require('./helpers/route-gate-sites');
const { stripComments } = require('./helpers/strip-comments');

test('it reads the route tree and resolves every site', () => {
  const sites = gateSites();
  assert.ok(routeFiles().length >= 20, `expected 20+ route files, found ${routeFiles().length}`);
  const permission = sites.filter((s) => s.kind === 'requirePermission');
  const role = sites.filter((s) => s.kind === 'requireRole');
  assert.ok(permission.length >= 100, `expected 100+ requirePermission sites, found ${permission.length}`);
  assert.ok(role.length >= 40, `expected 40+ requireRole sites, found ${role.length}`);

  // A per-route site with no path, or a role list that did not parse, is
  // an extraction failure a later guard would read as "nothing to check".
  assert.deepEqual(sites.filter((s) => !s.routerLevel && s.routePath === null).map((s) => `${s.file}:${s.line}`), []);
  assert.deepEqual(role.filter((s) => s.roles === null).map((s) => `${s.file}:${s.line} ${s.rawArgs}`), []);
});

test('control: a known snippet yields its sites, attributed, and a commented gate is not one', () => {
  const source = stripComments([
    "router.use(authenticate, requirePermission('manageBackup'));",
    "router.get('/a', authenticate,",
    "  requireRole(3, 4), handler);",
    "// router.post('/b', requirePermission('createUser'), handler);",
    "router.post('/c', requirePermission('editSample', 'UPDATE'), handler);",
  ].join('\n'));

  const sites = gateSitesIn(source, 'snippet.js');

  assert.equal(sites.length, 3);
  assert.deepEqual(
    sites.map((s) => [s.line, s.kind, s.routerLevel, s.method, s.routePath]),
    [
      [1, 'requirePermission', true, null, null],
      [3, 'requireRole', false, 'GET', '/a'],
      [5, 'requirePermission', false, 'POST', '/c'],
    ]
  );
  assert.deepEqual(sites[0].coveredMethods, ['GET', 'POST']);
  assert.deepEqual(sites[1].roles, [3, 4]);
  assert.equal(sites[2].code, 'editSample');
  assert.equal(sites[2].explicitAction, 'UPDATE');
});
