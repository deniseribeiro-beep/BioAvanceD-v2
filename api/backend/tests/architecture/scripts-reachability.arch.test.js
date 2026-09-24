// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect.
//
// #1125: a script under src/scripts/ that is neither an npm script nor invoked
// by a boot path or compose service never runs on any stack (#933). Twelve of
// nineteen were in that state, cited to an unrelated closed issue, and one of
// them (seedDiseaseValidationRules.js) carried a defect nobody could hit
// because nothing could run it (#1199).
//
// Every src/scripts/*.js must be an npm script's target, or be listed in
// HAND_RUN with the reason it is deliberately not one. Reads only
// api/backend, so it runs unchanged inside backend-unit-runner.

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '../..');
const SCRIPTS_DIR = path.join(BACKEND, 'src', 'scripts');

const HAND_RUN = new Map([
  [
    'seedRbacCatalog.js',
    'server.js re-seeds the RBAC catalog on every boot (#916, #922); this is a manual escape hatch, and its header says why it has no npm entry',
  ],
]);

function scriptFiles() {
  return fs.readdirSync(SCRIPTS_DIR).filter((name) => name.endsWith('.js')).sort();
}

function npmTargets() {
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  const targets = new Set();
  for (const command of Object.values(pkg.scripts || {})) {
    for (const match of command.matchAll(/src\/scripts\/([\w.-]+\.js)/g)) {
      targets.add(match[1]);
    }
  }
  return targets;
}

test('#1125: every src/scripts/*.js is an npm script target or a recorded hand-run exception', () => {
  const targets = npmTargets();
  const unreachable = scriptFiles().filter((name) => !targets.has(name) && !HAND_RUN.has(name));

  assert.deepEqual(
    unreachable,
    [],
    'These scripts have no npm entry, so no stack can run them. Add an npm script, '
      + 'or add the file to HAND_RUN with the reason it is deliberately manual:\n  '
      + unreachable.join('\n  ')
  );
});

test('#1125: every HAND_RUN entry names an existing script that has no npm entry', () => {
  const files = new Set(scriptFiles());
  const targets = npmTargets();
  const stale = [...HAND_RUN.keys()].filter((name) => !files.has(name) || targets.has(name));

  assert.deepEqual(stale, [], `Stale HAND_RUN entries (deleted, or now wired): ${stale.join(', ')}`);
});

test('#1125: the npm-target parser finds the known wirings (guards the guard)', () => {
  const targets = npmTargets();
  assert.ok(targets.has('createFirstAdmin.js'), 'admin:create-first should be parsed');
  assert.ok(targets.has('backfillLocationStorage.js'), 'migrate:location-storage should be parsed');
});
