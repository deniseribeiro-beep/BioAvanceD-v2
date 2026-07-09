const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.join(repoRoot, 'src');
const scriptsRoot = path.join(repoRoot, 'scripts');
const essentialManifest = path.join(repoRoot, 'src', 'reference-data', 'essential', 'manifest.js');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('seed essential is not imported by startup entrypoints', () => {
  for (const file of [path.join(repoRoot, 'app.js'), path.join(repoRoot, 'server.js'), path.join(backendRoot, 'workers', 'worker.js')]) {
    assert.ok(!read(file).includes('seed-essential-reference-data'), `${file} should not import essential seed script`);
  }
});

test('large import scaffolds stay non-operational', () => {
  const scaffold = read(path.join(scriptsRoot, 'reference-imports', 'import-large-reference-dataset.js'));
  assert.match(scaffold, /not implemented until data model is finalized/);
  assert.ok(!scaffold.includes('https://'));
  assert.ok(!scaffold.includes('http://'));
});

test('essential manifest excludes large dataset keys', () => {
  const manifest = require(essentialManifest).getManifest();
  for (const blocked of ['hpo', 'orpha', 'cid', 'omim', 'mondo']) {
    assert.ok(!manifest.some((entry) => String(entry.key).toLowerCase().includes(blocked)));
  }
});

test('seed scripts do not require network access', () => {
  const seedScript = read(path.join(scriptsRoot, 'seed-essential-reference-data.js'));
  assert.ok(!seedScript.includes('https://'));
  assert.ok(!seedScript.includes('http://'));
});
