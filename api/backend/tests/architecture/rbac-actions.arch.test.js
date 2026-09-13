// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here), same as this directory's other guards.
//
// #921 finding 2: a test that claims an audit it does not perform.
//
// `tests/unit/services/rbac-catalog-seed.service.test.js` carries, above a
// 22-row `it.each` table:
//
//   // #630: allowedActions audited against every real requirePermission()
//   // call site in src/interface/routes/ — these are the corrected sets
//
// **[ran it]** That file reads no route file:
// `grep -nE "readFileSync|readdirSync|glob|require\(.*routes"` over it
// returns nothing. It is a hardcoded snapshot taken by hand during #630,
// so it cannot detect the drift its comment claims to prevent — a new or
// changed `requirePermission()` call site whose derived action falls
// outside its code's `allowedActions` passes unnoticed. #929 is the
// worked example: both storage codes were absent from that table entirely.
//
// This file is that audit, done for real: it derives every call site from
// source and checks each one's action against the catalog. The unit table
// is not replaced — it pins *specific* expected sets, which is a different
// and still-useful assertion. What it stops claiming is completeness.
//
// Scope, stated rather than implied: this guard checks the
// **action-vs-allowedActions** half of #921 (finding 2). Finding 1 —
// whether each gate is *pinned by a test at all* — is a different
// question over a different population and is not attempted here.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const BACKEND_SRC = path.resolve(__dirname, '../../src');
const ROUTE_DIRS = [
  path.resolve(BACKEND_SRC, 'routes'),
  path.resolve(BACKEND_SRC, 'interface/routes'),
];

const { PERMISSION_CATALOG } = require('../../src/services/rbac-catalog-seed.service');

// Mirrors rbac.js's own map. Duplicated deliberately rather than imported:
// requiring the middleware pulls in the mongo client and the whole rbac
// service graph, and a guard should not need a database handle to read
// source text. If the two ever diverge, the divergence is itself the bug
// this guard should report — so it is asserted below rather than assumed.
const METHOD_TO_ACTION = {
  GET: 'READ',
  HEAD: 'READ',
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

// `router.get(`, `router.post(` ... — the start of a route registration.
// Everything up to the next one belongs to it, which is what lets a
// `requirePermission` sitting three lines below its verb be attributed
// correctly. Multi-line route registrations are the normal shape in this
// repo (sample.routes.js, import.routes.js), so a line-scoped regex would
// silently attribute almost nothing.
const ROUTE_START = /\brouter\.(get|post|put|patch|delete|head)\s*\(/gi;

// `router.use(...)` — a router-level gate, applying to EVERY verb
// registered under it rather than to one route. These are the widest gates
// in the codebase and the ones a call-site-scoped analysis is least able to
// see: `backup.routes.js:20` puts every backup route behind one
// `requirePermission('manageBackup')`, so that code's allowedActions must
// cover every verb in the file, not one.
const ROUTER_USE = /\brouter\.use\s*\(/g;

// A `router.use` whose verbs live in another file — it mounts a sub-router
// rather than registering routes itself. Static analysis stops at the file
// boundary, so these are named explicitly instead of being silently
// attributed to whatever verbs happen to follow them (there are none) and
// passing vacuously. Keyed by `file:line` so a moved gate re-surfaces here
// rather than inheriting the exemption.
const SUBROUTER_MOUNT_GATES = new Set([
  // `router.use(authenticate, requirePermission('createSample'),
  //  intakeGovernanceResponseGuard, intakeWizardRouter)` — the verbs are on
  //  intakeWizardRouter, in src/routes/intakeWizard.js.
  'interface/routes/intakeWizard.routes.js:203',
]);

// `requirePermission('code')` or `requirePermission('code', 'ACTION')`.
// Only string literals — a computed code cannot be checked statically and
// is reported separately rather than skipped silently.
const REQUIRE_PERMISSION = /requirePermission\(\s*(['"])([^'"]+)\1\s*(?:,\s*(['"])([^'"]+)\3\s*)?\)/g;
const REQUIRE_PERMISSION_ANY = /requirePermission\(/g;

function routeFiles() {
  const files = [];
  for (const dir of ROUTE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /\.js$/.test(entry.name)) files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function relative(file) {
  return path.relative(BACKEND_SRC, file).split(path.sep).join('/');
}

/**
 * Every `requirePermission` call site in one file, attributed to the HTTP
 * verb of the `router.<verb>(` registration it sits inside.
 */
function callSitesIn(content, file) {
  const starts = [];
  ROUTE_START.lastIndex = 0;
  for (const match of content.matchAll(ROUTE_START)) {
    starts.push({ index: match.index, method: match[1].toUpperCase() });
  }

  const methodAt = (index) => {
    let current = null;
    for (const start of starts) {
      if (start.index <= index) current = start.method;
      else break;
    }
    return current;
  };

  // Every `router.use(` opening index, so a requirePermission can be told
  // apart from a per-route one.
  const useStarts = [];
  ROUTER_USE.lastIndex = 0;
  for (const match of content.matchAll(ROUTER_USE)) useStarts.push(match.index);

  // A gate belongs to a `router.use` when the nearest preceding `router.*`
  // construct is a `use` rather than a verb.
  const isRouterUse = (index) => {
    const lastUse = Math.max(...useStarts.filter((i) => i <= index), -1);
    const lastVerb = Math.max(...starts.filter((s) => s.index <= index).map((s) => s.index), -1);
    return lastUse > lastVerb;
  };

  // The verbs a router-level gate actually covers: everything registered
  // after it in this file.
  const verbsAfter = (index) => [
    ...new Set(starts.filter((s) => s.index > index).map((s) => s.method)),
  ];

  const sites = [];
  REQUIRE_PERMISSION.lastIndex = 0;
  for (const match of content.matchAll(REQUIRE_PERMISSION)) {
    const line = content.slice(0, match.index).split('\n').length;
    const routerLevel = isRouterUse(match.index);
    sites.push({
      file: relative(file),
      line,
      code: match[2],
      explicitAction: match[4] || null,
      routerLevel,
      // A per-route gate has one method; a router-level one covers many.
      method: routerLevel ? null : methodAt(match.index),
      coveredMethods: routerLevel ? verbsAfter(match.index) : null,
    });
  }
  return sites;
}

function sweep() {
  const sites = [];
  let literalCalls = 0;
  let allCalls = 0;

  for (const file of routeFiles()) {
    const content = fs.readFileSync(file, 'utf8');
    const found = callSitesIn(content, file);
    sites.push(...found);
    literalCalls += found.length;
    REQUIRE_PERMISSION_ANY.lastIndex = 0;
    allCalls += (content.match(REQUIRE_PERMISSION_ANY) || []).length;
  }

  return { sites, literalCalls, allCalls };
}

test('#921/#630: the derivation actually reads route files and finds call sites', () => {
  const { sites, literalCalls, allCalls } = sweep();

  // The failure mode of any source-sweeping guard is under-collection: a
  // regex that stops matching makes every assertion below pass vacuously.
  // #630's table is the cautionary case — it asserted an audit over a
  // population it never read.
  assert.ok(routeFiles().length >= 20, `expected to find route files, found ${routeFiles().length}`);
  assert.ok(sites.length >= 100, `expected 100+ requirePermission call sites, found ${sites.length}`);

  // Every call site must resolve to at least one verb — per-route via its
  // own registration, router-level via the verbs it covers. An unresolved
  // one is a parse failure, not a pass. The sub-router mounts are the one
  // named exception, and naming them is the point.
  const unattributed = sites.filter((site) => {
    if (SUBROUTER_MOUNT_GATES.has(`${site.file}:${site.line}`)) return false;
    if (site.routerLevel) return (site.coveredMethods || []).length === 0;
    return !site.method;
  });
  assert.deepEqual(
    unattributed.map((s) => `${s.file}:${s.line} ${s.code}`),
    [],
    'requirePermission call sites not attributable to any router.<verb>() registration'
  );

  // The allowlist must not rot: an entry that no longer names a real
  // router-level gate is stale, and silently keeps something exempt.
  const routerLevelKeys = new Set(
    sites.filter((s) => s.routerLevel).map((s) => `${s.file}:${s.line}`)
  );
  assert.deepEqual(
    [...SUBROUTER_MOUNT_GATES].filter((key) => !routerLevelKeys.has(key)),
    [],
    'SUBROUTER_MOUNT_GATES names a site that is no longer a router.use gate — move or drop it'
  );

  // Any call site whose permission code is not a plain string literal
  // cannot be checked statically. Zero today; if one appears, this guard
  // must be told about it rather than quietly ignoring it.
  assert.equal(
    allCalls,
    literalCalls,
    `${allCalls - literalCalls} requirePermission() call site(s) use a non-literal permission code and are unchecked`
  );
});

test('#630 audit, for real: every gate action is inside its code allowedActions', () => {
  const { sites } = sweep();
  const offenders = [];

  for (const site of sites) {
    const entry = PERMISSION_CATALOG[site.code];
    if (!entry) {
      offenders.push(
        `${site.file}:${site.line} gates on '${site.code}', which is not in PERMISSION_CATALOG`
      );
      continue;
    }

    // A router-level gate covers every verb registered under it, so its
    // code's allowedActions must cover all of them — one uncovered verb is
    // a route that always 403s.
    if (site.routerLevel) {
      if (SUBROUTER_MOUNT_GATES.has(`${site.file}:${site.line}`)) continue;
      const methods = site.coveredMethods || [];
      const missing = methods
        .map((method) => site.explicitAction || METHOD_TO_ACTION[method])
        .filter((action) => action && !entry.allowedActions.includes(action));
      if (missing.length > 0) {
        offenders.push(
          `${site.file}:${site.line} router.use gates ${methods.join('/')} on '${site.code}', `
            + `but allowedActions [${entry.allowedActions.join(', ')}] is missing `
            + `[${[...new Set(missing)].join(', ')}]`
        );
      }
      continue;
    }

    const action = site.explicitAction || METHOD_TO_ACTION[site.method];
    if (!action) {
      offenders.push(`${site.file}:${site.line} '${site.code}' — no action derivable from ${site.method}`);
      continue;
    }

    if (!entry.allowedActions.includes(action)) {
      offenders.push(
        `${site.file}:${site.line} ${site.method} gates on '${site.code}' -> action ${action}, `
          + `but allowedActions is [${entry.allowedActions.join(', ')}]`
      );
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'requirePermission enforces the derived action against the code\'s allowedActions at runtime '
      + '(rbac.js), so a call site outside that set is a route that always 403s:\n  '
      + offenders.join('\n  ')
  );
});

test('#921: METHOD_TO_ACTION here still matches the one rbac.js enforces', () => {
  // This guard duplicates the map rather than importing the middleware (see
  // the comment on the constant). That is only safe while the two agree, so
  // the agreement is checked against rbac.js's source text rather than
  // assumed.
  const rbacSource = fs.readFileSync(
    path.resolve(BACKEND_SRC, 'infrastructure/middleware/rbac.js'),
    'utf8'
  );
  const block = rbacSource.match(/const METHOD_TO_ACTION\s*=\s*\{([^}]*)\}/);
  assert.ok(block, 'could not find METHOD_TO_ACTION in rbac.js — this guard has gone stale');

  const parsed = {};
  for (const line of block[1].split('\n')) {
    const entry = line.match(/([A-Z]+)\s*:\s*'([A-Z]+)'/);
    if (entry) parsed[entry[1]] = entry[2];
  }

  assert.deepEqual(parsed, METHOD_TO_ACTION, 'rbac.js METHOD_TO_ACTION drifted from this guard\'s copy');
});
