'use strict';

/**
 * #1115 — every /api path app.js mounts must resolve to a real resourceType
 * on the automatic audit row, or be declared entity-less.
 *
 * app.js mounts audit.middleware's auditRequest globally, so determineEntity
 * decides resourceType (dict-02 P1X-0326, "Tipo da entidade afetada", 1..1
 * Core, RNF009) for every request that does not audit itself explicitly.
 * Before #1115 its map covered 14 of 59 mounted prefixes and the other 45 --
 * security, legal-holds, retention-policies, e-consent, backup and audit
 * among them -- silently recorded the catch-all 'Sistema'.
 *
 * The map is hand-maintained and app.js gains routers steadily, so the real
 * defect was drift, not the missing entries. This test is what makes the
 * drift impossible to reintroduce silently: mount a new router without
 * deciding its entity and it fails here, naming the path.
 *
 * The mount pattern deliberately allows MULTIPLE segments. A first draft
 * matched a single segment and was blind to /api/v1/patients, which was a
 * live instance of exactly the defect under repair -- a pattern that cannot
 * match the shape it hunts returns a confident, wrong number.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

const {
  determineEntity,
  ENTITY_MAP,
  NO_ENTITY_ROUTES
} = require(path.join(BACKEND_ROOT, 'src/infrastructure/middleware/audit.middleware'));

/**
 * Read the mounted paths off app.js itself rather than from a list kept
 * here — a list here would be the very thing this test exists to prevent.
 * Returns the part after '/api/', e.g. 'patients', 'v1/patients'.
 */
function mountedApiPaths() {
  const appSource = fs.readFileSync(path.join(BACKEND_ROOT, 'app.js'), 'utf8');
  const matches = appSource.match(/["']\/api\/[a-zA-Z0-9\-/]+["']/g) || [];
  return [...new Set(
    matches.map((raw) => raw.slice(1, -1).replace('/api/', '').replace(/\/$/, ''))
  )].sort();
}

const firstSegment = (mountPath) => mountPath.split('/')[0];

test('app.js mounts at least the routes this check is meant to cover', () => {
  const paths = mountedApiPaths();
  // Guards the pattern above: if it silently stops matching, every assertion
  // below passes vacuously over an empty set (#797).
  assert.ok(
    paths.length >= 50,
    `expected to find the mounted /api paths in app.js, found ${paths.length}`
  );
});

test('the mount pattern sees multi-segment mounts, not just the first segment', () => {
  // Pins the blindness that hid /api/v1/patients from the first draft.
  const paths = mountedApiPaths();
  assert.ok(
    paths.some((mountPath) => mountPath.includes('/')),
    'expected at least one multi-segment mount (e.g. v1/patients); the pattern has gone single-segment again'
  );
});

test('every mounted /api path resolves to a real entity or is declared entity-less', () => {
  const unmapped = mountedApiPaths().filter(
    (mountPath) =>
      determineEntity(`/api/${mountPath}`) === 'Sistema' &&
      !NO_ENTITY_ROUTES.includes(firstSegment(mountPath))
  );

  assert.deepStrictEqual(
    unmapped,
    [],
    'These /api paths record resourceType "Sistema" on every automatic audit row. ' +
      'Add each to ENTITY_MAP in audit.middleware.js, or to NO_ENTITY_ROUTES if the ' +
      `route genuinely affects no entity: ${unmapped.join(', ')}`
  );
});

test('NO_ENTITY_ROUTES only names prefixes that are actually mounted', () => {
  const mounted = new Set(mountedApiPaths().map(firstSegment));
  const stale = NO_ENTITY_ROUTES.filter((prefix) => !mounted.has(prefix));

  assert.deepStrictEqual(
    stale,
    [],
    `NO_ENTITY_ROUTES names prefixes app.js no longer mounts: ${stale.join(', ')}`
  );
});

test('no prefix is both mapped to an entity and declared entity-less', () => {
  const contradictory = NO_ENTITY_ROUTES.filter((prefix) =>
    Object.prototype.hasOwnProperty.call(ENTITY_MAP, prefix)
  );

  assert.deepStrictEqual(
    contradictory,
    [],
    `declared entity-less while also mapped to an entity: ${contradictory.join(', ')}`
  );
});

test('the ID-shaped guard still wins over the map', () => {
  // The check that was always load-bearing: an ObjectId or long numeric id in
  // the resource position must never become a resourceType.
  assert.strictEqual(determineEntity('/api/507f1f77bcf86cd799439011'), 'Sistema');
  assert.strictEqual(determineEntity('/api/12345678'), 'Sistema');
  // ...and it recurses into the next segment when there is one.
  assert.strictEqual(determineEntity('/api/507f1f77bcf86cd799439011/patients'), 'Patient');
});

test('a version segment resolves to the entity in its sub-path', () => {
  assert.strictEqual(determineEntity('/api/v1/patients'), 'Patient');
  // A version segment with nothing after it has no entity to find.
  assert.strictEqual(determineEntity('/api/v1'), 'Sistema');
});
