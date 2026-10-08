// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1342 (from #921): which RBAC gate sites a test pins.
//
// A site counts as pinned only when a row in tests/rbac-pins/*.pins.js names
// it: same route file, verb and path (or `use: true` for a router.use gate),
// and the same permission code or role list the source declares.
// tests/integration/rbac-gate-pins.test.js proves every row against the real
// middleware: refused without what the row names, through with it. A test
// that mentions a route path beside a role literal is not a pin, because it
// can do so with the gate stubbed to next() (#921's finding on
// compliance.api.test.js).
//
// Every site no row pins is listed in rbac-unpinned-sites.json, which only
// shrinks: a new unpinned site fails here, and so does a listed site that is
// now pinned or gone, so the list is kept exact.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { gateSites, BACKEND_SRC } = require('./helpers/route-gate-sites');

const PIN_DIR = path.resolve(__dirname, '../rbac-pins');
const ALLOWLIST_PATH = path.resolve(__dirname, 'rbac-unpinned-sites.json');
const APP_JS = path.resolve(BACKEND_SRC, '../app.js');

function pinTables() {
  return fs.readdirSync(PIN_DIR)
    .filter((name) => name.endsWith('.pins.js'))
    .sort()
    .map((name) => ({ name, ...require(path.join(PIN_DIR, name)) }));
}

function siteKey(site) {
  const where = site.routerLevel ? 'USE *' : `${site.method} ${site.routePath}`;
  const what = site.kind === 'requirePermission' ? `permission:${site.code}` : `roles:${(site.roles || []).join('|')}`;
  return `${where} ${what}`;
}

function rowMatches(row, site) {
  const where = row.use
    ? site.routerLevel
    : !site.routerLevel && site.method === row.method && site.routePath === row.path;
  if (!where) return false;
  if (row.permission) return site.kind === 'requirePermission' && site.code === row.permission;
  return site.kind === 'requireRole' && Array.isArray(site.roles)
    && JSON.stringify([...site.roles].sort()) === JSON.stringify([...row.roles].sort());
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pins against the current tree: which sites each row matched, and the rows
// that matched none.
function resolvePins() {
  const sites = gateSites();
  const pinned = new Set();
  const stray = [];
  for (const table of pinTables()) {
    const fileSites = sites.filter((s) => s.file === table.file);
    for (const row of table.pins) {
      const hits = fileSites.filter((s) => rowMatches(row, s));
      if (hits.length === 0) stray.push(`${table.name}: ${JSON.stringify(row)}`);
      hits.forEach((s) => pinned.add(s));
    }
  }
  return { sites, pinned, stray };
}

test('#1342: every pin row matches a gate its route file declares', () => {
  const tables = pinTables();
  assert.ok(tables.length >= 4, `expected 4+ pin tables, found ${tables.length}`);
  const { stray } = resolvePins();
  assert.deepEqual(stray, [],
    'These pin rows name a gate the route file does not declare (wrong verb, path, code or role list). '
    + 'Fix the row, or the route if the row states the requirement:\n  ' + stray.join('\n  '));
});

test('#1342: every pin table names the mount app.js gives its route file', () => {
  const app = fs.readFileSync(APP_JS, 'utf8');
  const wrong = pinTables().filter((table) => {
    const requirePath = `./src/${table.file.replace(/\.js$/, '')}`;
    const mount = new RegExp(
      `app\\.use\\(\\s*["'\`]${escapeRegExp(table.mount)}["'\`]\\s*,\\s*require\\(\\s*["'\`]${escapeRegExp(requirePath)}(?:\\.js)?["'\`]`
    );
    return !mount.test(app);
  }).map((table) => `${table.name}: ${table.mount} -> ${table.file}`);
  assert.deepEqual(wrong, [], 'These tables name a mount app.js does not give their file:\n  ' + wrong.join('\n  '));
});

test('#1342: the unpinned sites are exactly rbac-unpinned-sites.json, which only shrinks', () => {
  const { sites, pinned } = resolvePins();
  const actual = {};
  for (const site of sites) {
    if (pinned.has(site)) continue;
    (actual[site.file] = actual[site.file] || []).push(siteKey(site));
  }
  const allowed = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));

  const added = [];
  const stale = [];
  for (const file of new Set([...Object.keys(actual), ...Object.keys(allowed)])) {
    const have = [...(actual[file] || [])];
    const listed = [...(allowed[file] || [])];
    for (const key of have) {
      const i = listed.indexOf(key);
      if (i === -1) added.push(`${file}: ${key}`);
      else listed.splice(i, 1);
    }
    listed.forEach((key) => stale.push(`${file}: ${key}`));
  }

  assert.deepEqual(added, [],
    'These gate sites are pinned by no row in tests/rbac-pins/. Add a row (the list below only shrinks):\n  ' + added.join('\n  '));
  assert.deepEqual(stale, [],
    'These entries in rbac-unpinned-sites.json are pinned now, or gone. Remove them:\n  ' + stale.join('\n  '));
});

test('#1342: a row matches only the site it names (known snippet)', () => {
  const site = { file: 'f.js', routerLevel: false, method: 'DELETE', routePath: '/:id', kind: 'requireRole', roles: [3, 4] };
  assert.equal(rowMatches({ method: 'DELETE', path: '/:id', roles: [4, 3] }, site), true);
  assert.equal(rowMatches({ method: 'DELETE', path: '/:id', roles: [4] }, site), false);
  assert.equal(rowMatches({ method: 'GET', path: '/:id', roles: [3, 4] }, site), false);
  assert.equal(rowMatches({ method: 'DELETE', path: '/:id', permission: 'viewReports' }, site), false);
  assert.equal(rowMatches({ use: true, roles: [3, 4] }, site), false);
});
