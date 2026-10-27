// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect. History: #1325.
//
// RNF006 C2 asks for the APIs to be documented. docs/api/openapi.json is that
// documentation for the mounts it lists in `x-covered-mounts`, and a spec
// written by hand drifts from the routes the moment a registration is added,
// renamed or removed. This guard keeps the two equal, in both directions:
//
//   - every operation the spec documents is a registration under its app.js
//     mount, so the spec never promises a route that 404s;
//   - every registration under a covered mount is in the spec, so a new
//     route on a documented mount cannot ship undocumented.
//
// It READS the code, never requires it: app.js and the route files load the
// database, queue and config modules at require time. The mounts come from
// app.js's `app.use("<prefix>", require("<module>"))` calls; a limiter
// mounted on a prefix (`app.use("/api/auth", authLimiter)`) registers no
// route and is not a mount. A prefix mounted more than once takes the union
// of its files' registrations.
//
// The second claim holds only because the guard fails closed: a shape that
// could add a route under a covered mount but that the extraction does not
// read (a router.route() chain, router.all, a sub-router, a second router,
// a non-literal or middleware-prefixed mount, a mount below a covered
// prefix, a route registered on app itself) is refused with its file and
// line, rather than passed as if it registered nothing.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const { readStripped } = require('./helpers/strip-comments');

const backendRoot = path.resolve(__dirname, '..', '..');
const APP_JS = path.join(backendRoot, 'app.js');
const SPEC = path.resolve(backendRoot, '..', '..', 'docs', 'api', 'openapi.json');

const MOUNT = /\bapp\.use\(\s*(['"])([^'"]+)\1\s*,\s*require\(\s*(['"])([^'"]+)\3\s*\)\s*\)/g;
// The shape of route-gate-sites.js's ROUTE_START, copied: the helper does not
// export it. Multi-line safe, and a registration with no literal path still
// matches, with group 3 undefined.
const ROUTE_START = /\brouter\.(get|post|put|patch|delete|head)\s*\(\s*(?:(['"`])([^'"`]*)\2)?/gi;
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

// Middleware app.js mounts on a covered prefix that registers no route.
const KNOWN_LIMITERS = new Set(['authLimiter']);

const APP_CALL = /\bapp\.(use|get|post|put|patch|delete|all|options|head|route)\s*\(/g;
const ROUTER_PATH_SHAPE = /\brouter\.(route|all|options|use)\s*\(\s*['"`]/g;
const ROUTER_USE = /\brouter\.use\s*\(/g;
const ROUTER_DECLARATION = /\b(?:const|let|var)\s+router\s*=\s*express\.Router\s*\(/;
const ANY_ROUTER = /\bRouter\s*\(/g;
const OTHER_RECEIVER = /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|head|all|options|route|use)\s*\(\s*['"`]\//g;

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

// The top-level arguments of the call whose `(` is at `open`, as source text.
function callArgs(source, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < source.length; i += 1) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i += 1; i < source.length && source[i] !== c; i += 1) if (source[i] === '\\') i += 1;
    } else if ('([{'.includes(c)) {
      depth += 1;
    } else if (')]}'.includes(c)) {
      if (depth === 0) {
        args.push(source.slice(start, i).trim());
        break;
      }
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args.filter((arg) => arg !== '');
}

function literalOf(arg) {
  const quoted = /^(['"])([^'"]*)\1$/.exec(arg);
  if (quoted) return quoted[2];
  const template = /^`([^`$]*)`$/.exec(arg);
  return template ? template[1] : null;
}

const isUnder = (route, prefix) => route === prefix || route.startsWith(`${prefix}/`);

// app.js calls the mount extraction cannot vouch for under a covered prefix.
function appRefusals(source, label, covered) {
  const refusals = [];
  for (const match of source.matchAll(APP_CALL)) {
    const method = match[1];
    const args = callArgs(source, match.index + match[0].length - 1);
    const at = `${label}:${lineOf(source, match.index)} app.${method}(`;
    const prefix = literalOf(args[0] || '');
    if (prefix === null) {
      if (args.length > 1) refusals.push(`${at}: its prefix is not a string literal, so it may fall under a covered mount`);
      continue;
    }
    const mount = covered.find((p) => isUnder(prefix, p));
    if (!mount) continue;
    if (method !== 'use') {
      refusals.push(`${at}"${prefix}": a route registered on app itself under ${mount}`);
    } else if (prefix !== mount) {
      refusals.push(`${at}"${prefix}": a mount below the covered ${mount}; cover the mount itself or move the routes`);
    } else if (!(args.length === 2 && (/^require\(\s*(['"])[^'"]+\1\s*\)$/.test(args[1]) || KNOWN_LIMITERS.has(args[1])))) {
      refusals.push(`${at}"${prefix}", ...): neither app.use(prefix, require(module)) nor a known limiter`);
    }
  }
  return refusals;
}

// Shapes in a covered route file that could register a route the
// ROUTE_START extraction does not read.
function routeFileRefusals(source, label) {
  const refusals = [];
  const at = (index) => `${label}:${lineOf(source, index)}`;
  for (const match of source.matchAll(ROUTE_START)) {
    if (match[3] === undefined) refusals.push(`${at(match.index)} router.${match[1]}( has no literal path`);
  }
  for (const match of source.matchAll(ROUTER_PATH_SHAPE)) {
    refusals.push(`${at(match.index)} router.${match[1]}('<path>' is a shape the extraction does not read`);
  }
  for (const match of source.matchAll(ROUTER_USE)) {
    for (const arg of callArgs(source, match.index + match[0].length - 1)) {
      const required = arg.includes('require(') || (/^[A-Za-z_$][\w$]*$/.test(arg) &&
        new RegExp(`\\b(?:const|let|var)\\s+${arg.replace(/[$]/g, '\\$&')}\\s*=\\s*require\\s*\\(`).test(source));
      if (required) refusals.push(`${at(match.index)} router.use(${arg}) mounts a required module, maybe a sub-router`);
    }
  }
  const routers = [...source.matchAll(ANY_ROUTER)];
  if (routers.length !== 1 || !ROUTER_DECLARATION.test(source)) {
    refusals.push(`${label}: expected exactly one Router(), as const router = express.Router(); found ${routers.length}`);
  }
  for (const match of source.matchAll(OTHER_RECEIVER)) {
    if (match[1] !== 'router') refusals.push(`${at(match.index)} ${match[1]}.${match[2]}('/...' registers on a receiver other than router`);
  }
  return refusals;
}

function resolveModule(request) {
  const base = path.resolve(backendRoot, request);
  return [base, `${base}.js`, path.join(base, 'index.js')].find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
}

function collectMounts() {
  const mounts = new Map();
  const source = readStripped(fs, APP_JS);
  for (const match of source.matchAll(MOUNT)) {
    const prefix = match[2];
    const file = resolveModule(match[4]);
    if (!mounts.has(prefix)) mounts.set(prefix, new Set());
    if (file) mounts.get(prefix).add(file);
  }
  return mounts;
}

function joinPath(prefix, route) {
  const templated = route.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  if (templated === '/' || templated === '') return prefix;
  return `${prefix.replace(/\/$/, '')}/${templated.replace(/^\//, '')}`;
}

// `METHOD /prefix/path` for every literal-path registration in the files
// mounted at `prefix`.
function collectOperations(prefix, files) {
  const operations = new Set();
  for (const file of files) {
    for (const match of readStripped(fs, file).matchAll(ROUTE_START)) {
      if (match[3] !== undefined) operations.add(`${match[1].toUpperCase()} ${joinPath(prefix, match[3])}`);
    }
  }
  return operations;
}

function readSpec() {
  return JSON.parse(fs.readFileSync(SPEC, 'utf8'));
}

function specOperations(spec) {
  const operations = [];
  for (const [route, item] of Object.entries(spec.paths || {})) {
    for (const key of Object.keys(item)) {
      if (HTTP_METHODS.has(key)) operations.push({ route, method: key, key: `${key.toUpperCase()} ${route}` });
    }
  }
  return operations;
}

test('RNF006: every operation the OpenAPI spec documents is registered under its app.js mount', () => {
  const spec = readSpec();
  const covered = spec['x-covered-mounts'] || [];
  const mounts = collectMounts();
  const misses = [];
  for (const operation of specOperations(spec)) {
    const prefix = covered.find((p) => isUnder(operation.route, p));
    if (!prefix) {
      misses.push(`${operation.key}: its path is under no x-covered-mounts prefix`);
      continue;
    }
    if (!collectOperations(prefix, mounts.get(prefix) || []).has(operation.key)) {
      misses.push(`${operation.key}: no such registration under ${prefix} in app.js`);
    }
  }
  assert.deepStrictEqual(misses, [], `The spec documents operations the code does not register:\n${misses.join('\n')}`);
});

test('RNF006: every operation registered under a covered mount is documented', () => {
  const spec = readSpec();
  const covered = spec['x-covered-mounts'] || [];
  const documented = new Set(specOperations(spec).map((operation) => operation.key));
  const mounts = collectMounts();
  const misses = appRefusals(readStripped(fs, APP_JS), 'app.js', covered);
  for (const prefix of covered) {
    const files = mounts.get(prefix);
    if (!files || files.size === 0) {
      misses.push(`${prefix}: not mounted with require() in app.js`);
      continue;
    }
    for (const file of files) misses.push(...routeFileRefusals(readStripped(fs, file), path.relative(backendRoot, file)));
    const operations = collectOperations(prefix, files);
    if (operations.size === 0) misses.push(`${prefix}: its route files register no operation`);
    for (const key of operations) {
      if (!documented.has(key)) misses.push(`${key}: registered but not in docs/api/openapi.json`);
    }
  }
  assert.deepStrictEqual(misses, [], `Operations under a covered mount are not documented, or cannot be read:\n${misses.join('\n')}`);
});

test('RNF006: the spec is OpenAPI 3.0 and every path template parameter is declared', () => {
  const spec = readSpec();
  assert.match(String(spec.openapi), /^3\.0\.\d+$/);
  assert.ok(
    Array.isArray(spec['x-covered-mounts']) && spec['x-covered-mounts'].length > 0,
    'x-covered-mounts must be a non-empty array'
  );
  const misses = [];
  for (const [route, item] of Object.entries(spec.paths || {})) {
    const template = [...route.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    const pathLevel = (item.parameters || []).filter((p) => p.in === 'path').map((p) => p.name);
    for (const method of Object.keys(item).filter((key) => HTTP_METHODS.has(key))) {
      const declared = new Set([
        ...pathLevel,
        ...(item[method].parameters || []).filter((p) => p.in === 'path').map((p) => p.name),
      ]);
      for (const name of template) {
        if (!declared.has(name)) misses.push(`${method.toUpperCase()} ${route}: {${name}} is not a declared path parameter`);
      }
      for (const name of declared) {
        if (!template.includes(name)) misses.push(`${method.toUpperCase()} ${route}: path parameter ${name} is not in the template`);
      }
    }
  }
  assert.deepStrictEqual(misses, [], misses.join('\n'));
});

// Without this, the refusals above would pass just as happily if they could
// never fire, since no covered file holds such a shape today. Each shape is
// one the extraction cannot read; each must be refused, and the clean
// sources, written in the covered files' own shapes, must not be.
test('RNF006: the guard refuses each route shape it cannot read', () => {
  const covered = ['/api/auth', '/api/backup'];
  const sub = 'require("./src/interface/routes/sub.routes")';
  const app = [
    'app.use(globalLimiter);',
    'app.use("/api/auth", authLimiter);',
    'app.use("/api/backup", require("./src/interface/routes/backup.routes"));',
    'app.use("/api/backup", require("./src/interface/routes/backup.routes"));',
    'app.use(\n  cors({ origin: (origin, callback) => callback(null, true) })\n);',
    'app.use("/api/patients", require("./src/interface/routes/patient.routes"));',
    'app.get("/api/health", async (req, res) => { res.status(200).json({ ok: true }); });',
  ].join('\n');
  const route = [
    "const express = require('express');",
    'const router = express.Router();',
    "const { authenticate } = require('../../infrastructure/middleware/auth');",
    'router.use(authenticate);',
    "router.use(requirePermission('manageBackup'));",
    "router.get('/list', async (req, res) => res.status(200).json({ ok: req.get('x-request-id') }));",
    'router.post(\n  "/restore/:fileName",\n  handler\n);',
    'module.exports = router;',
  ].join('\n');

  assert.deepStrictEqual(appRefusals(app, 'app.js', covered), []);
  assert.deepStrictEqual(routeFileRefusals(route, 'backup.routes.js'), []);

  const appShapes = {
    'a template-literal prefix': `app.use(\`\${API}/backup\`, ${sub});`,
    'a concatenated prefix': `app.use(API + "/backup", ${sub});`,
    'an identifier prefix': `app.use(BP, ${sub});`,
    'middleware before the require': `app.use("/api/backup", authenticate, ${sub});`,
    'a variable-held router': `const extra = ${sub};\napp.use("/api/backup", extra);`,
    'a mount below a covered prefix': `app.use("/api/backup/deep", ${sub});`,
    'app.get under a covered prefix': 'app.get("/api/backup/direct", handler);',
    'app.route under a covered prefix': 'app.route("/api/backup/r").get(handler);',
  };
  const routeShapes = {
    'a router.route chain': "router.route('/chained').get(handler).post(handler);",
    'router.all': "router.all('/anything', handler);",
    'router.options': "router.options('/opt', handler);",
    'router.use with a path': "router.use('/sub', authenticate);",
    'router.use of a required module': "router.use(require('./sub.routes'));",
    'router.use of a required identifier': "const sub = require('./sub.routes');\nrouter.use(sub);",
    'a second router': 'const r2 = express.Router();\nrouter.use(r2);',
    'an aliased router': "const r = router;\nr.get('/alias', handler);",
    'a registration with no literal path': 'router.get(paths.list, handler);',
  };
  const unrefused = [
    ...Object.entries(appShapes).filter(([, text]) => appRefusals(`${app}\n${text}`, 'app.js', covered).length === 0),
    ...Object.entries(routeShapes).filter(([, text]) => routeFileRefusals(`${route}\n${text}`, 'backup.routes.js').length === 0),
  ].map(([name]) => name);
  assert.deepStrictEqual(unrefused, [], `These shapes pass unrefused: ${unrefused.join(', ')}`);
});
