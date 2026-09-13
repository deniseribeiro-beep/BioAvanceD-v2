// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.join(repoRoot, 'src');
const scriptsRoot = path.join(repoRoot, 'scripts');
const essentialManifest = path.join(repoRoot, 'src', 'reference-data', 'essential', 'manifest.js');

const { stripComments } = require('./helpers/strip-comments');

// #945: these guards ask whether a file *imports* something, or *reaches the
// network*. A comment naming either is neither, so prose is blanked before
// matching. String literals survive, so the `https://` checks below still see
// a real URL constant.
function read(file) {
  return stripComments(fs.readFileSync(file, 'utf8'));
}

test('seed essential is not imported by startup entrypoints', () => {
  for (const file of [path.join(repoRoot, 'app.js'), path.join(repoRoot, 'server.js'), path.join(backendRoot, 'workers', 'worker.js')]) {
    assert.strictEqual(read(file).includes('seed-essential-reference-data'), false);
  }
});

test('large import scaffolds stay non-operational', () => {
  const scaffold = read(path.join(scriptsRoot, 'reference-imports', 'import-large-reference-dataset.js'));
  assert.match(scaffold, /not implemented until data model is finalized/);
  assert.strictEqual(scaffold.includes('https://'), false);
  assert.strictEqual(scaffold.includes('http://'), false);
});

test('essential manifest excludes large dataset keys', () => {
  const manifest = require(essentialManifest).getManifest();
  for (const blocked of ['hpo', 'orpha', 'cid', 'omim', 'mondo']) {
    assert.strictEqual(manifest.some((entry) => String(entry.key).toLowerCase().includes(blocked)), false);
  }
});

test('seed scripts do not require network access', () => {
  const seedScript = read(path.join(scriptsRoot, 'seed-essential-reference-data.js'));
  assert.strictEqual(seedScript.includes('https://'), false);
  assert.strictEqual(seedScript.includes('http://'), false);
});
