// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect. History: #926.
//
// Express matches `router.METHOD` registrations in file order, with NO
// static-over-parameter priority. So a literal route registered after a
// parameterised one that can match the same path is dead code: the request
// is served by the earlier handler with the literal segment bound as the
// parameter, and the later registration never runs.
//
// This is silent. The shadowed endpoint does not error — it answers with
// whatever the parameterised handler makes of a nonsense id, which reads as
// a data problem rather than a routing one. #926 found two instances:
//
//   patient.routes.js  GET /operational  behind GET /:id  -> served by
//     patientController.buscar with id='operational' instead of listar
//   user.routes.js     GET /logs         behind GET /:id  -> answered 404
//     users.notFound instead of reaching logService.getLogs
//
// Both were introduced the ordinary way: a new literal route appended to the
// bottom of a file that already had `/:id` near the top.
//
// Only routes with the SAME method and the SAME path-segment count can
// collide, which is why three routers checked by hand during #921 were clean
// — accessRequest.js's GET /:id/access-check sits at a different depth from
// GET /:id, and eConsent.js registers /consent-templates/current before
// /consent-templates/:id, which is the correct order.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

// Both routes directories. A census that stops at interface/routes misses
// ~23% of this repo's route surface — the blind spot #921 measured.
const ROUTE_DIRS = [
  path.join(repoRoot, 'src', 'interface', 'routes'),
  path.join(repoRoot, 'src', 'routes'),
];

const REGISTRATION = /^\s*router\.(get|post|put|patch|delete|all)\(\s*['"]([^'"]+)['"]/;

function collectRegistrations(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line, index) => {
      const match = REGISTRATION.exec(line);
      if (!match) return null;
      const route = match[2];
      return {
        line: index + 1,
        method: match[1],
        route,
        segments: route.split('/').filter(Boolean),
      };
    })
    .filter(Boolean);
}

// `earlier` shadows `later` when every segment of `earlier` either is a
// parameter (matches anything) or is literally equal to `later`'s segment at
// the same position. Equal routes are excluded — a genuine duplicate
// registration is a different defect and not this guard's business.
function shadows(earlier, later) {
  if (earlier.method !== later.method) return false;
  if (earlier.segments.length !== later.segments.length) return false;
  if (earlier.route === later.route) return false;
  return earlier.segments.every(
    (segment, i) => segment.startsWith(':') || segment === later.segments[i]
  );
}

function findShadowedRoutes() {
  const found = [];
  for (const dir of ROUTE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.js')) continue;
      const file = path.join(dir, name);
      const registrations = collectRegistrations(file);
      for (let i = 0; i < registrations.length; i += 1) {
        for (let j = 0; j < i; j += 1) {
          if (shadows(registrations[j], registrations[i])) {
            found.push(
              `${name}: ${registrations[i].method.toUpperCase()} ${registrations[i].route} ` +
                `(line ${registrations[i].line}) is unreachable — ` +
                `${registrations[j].route} (line ${registrations[j].line}) matches first. ` +
                `Move it above line ${registrations[j].line}.`
            );
          }
        }
      }
    }
  }
  return found;
}

test('#926: no route registration is shadowed by an earlier parameterised one', () => {
  assert.deepStrictEqual(
    findShadowedRoutes(),
    [],
    'A literal route registered after a parameterised route that matches the ' +
      'same path shape is dead code — Express matches in registration order.'
  );
});

// Without this, the guard above would pass just as happily on a matcher that
// can never fire, which is the failure mode #921 measured three separate
// mechanisms of. This exercises the same `shadows` predicate the sweep uses,
// against the exact shapes #926 found and the exact shapes that are fine.
test('#926: the shadowing predicate itself detects and clears the known cases', () => {
  const reg = (method, route, line) => ({
    method,
    route,
    line,
    segments: route.split('/').filter(Boolean),
  });

  // The two real instances, as they stood before #926.
  assert.strictEqual(shadows(reg('get', '/:id', 31), reg('get', '/operational', 49)), true);
  assert.strictEqual(shadows(reg('get', '/:id', 172), reg('get', '/logs', 823)), true);

  // Correct order is not a finding — the guard is about order, not existence.
  assert.strictEqual(shadows(reg('get', '/operational', 25), reg('get', '/:id', 38)), false);

  // Different depth cannot collide (accessRequest.js's real shape).
  assert.strictEqual(shadows(reg('get', '/:id', 19), reg('get', '/:id/access-check', 18)), false);

  // Different method cannot collide.
  assert.strictEqual(shadows(reg('get', '/:id', 10), reg('post', '/logs', 20)), false);

  // A deeper literal behind a deeper parameterised one still collides.
  assert.strictEqual(shadows(reg('get', '/:id/files', 10), reg('get', '/batch/files', 20)), true);
});
