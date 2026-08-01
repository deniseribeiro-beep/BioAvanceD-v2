// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const archDir = __dirname;

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('no tests/architecture file imports from vitest (#393: this exact swap caused #375)', () => {
  const siblings = fs
    .readdirSync(archDir)
    .filter((name) => name.endsWith('.arch.test.js') && name !== path.basename(__filename));

  for (const name of siblings) {
    const contents = read(path.join(archDir, name));
    assert.doesNotMatch(
      contents,
      /from\s+['"]vitest['"]|require\(['"]vitest['"]\)/,
      `${name} imports from vitest — this directory is node:test-only per #393/#375`
    );
  }
});
