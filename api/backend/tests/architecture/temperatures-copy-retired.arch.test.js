// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1391, RF009 AC1: InfluxDB is a temperature reading's only store. The
// Mongo `temperatures` copy is retired: no backend code writes it, reads it
// or counts it as an organization reference. The existing collection is
// left in place and nothing names it (see
// docs/decisions/2026-10-21-telemetry-temperatures-copy-retired.md).
//
// This test fails the day a file names the collection in a collection call
// or as a `name:` entry such as an ORGANIZATION_REFERENCES row.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const { readStripped, stripComments } = require('./helpers/strip-comments');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const SCANNED_DIRS = ['src', 'scripts'].map((dir) => path.join(BACKEND_ROOT, dir));

const COLLECTION_CALL = /\b(?:collection|getCollection)\s*\([^)]*?(['"`])temperatures\1/g;
const NAME_ENTRY = /\bname\s*:\s*(['"`])temperatures\1/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const relative = (file) => path.relative(BACKEND_ROOT, file).split(path.sep).join('/');

function sources() {
  return SCANNED_DIRS.flatMap((dir) => walk(dir))
    .map((file) => ({ file: relative(file), text: readStripped(fs, file) }));
}

// The places a piece of stripped source names the temperatures copy, as the
// matched text.
function copyUses(text) {
  return [...text.matchAll(COLLECTION_CALL), ...text.matchAll(NAME_ENTRY)].map((match) => match[0]);
}

test('no backend code writes or reads the Mongo temperatures copy (RF009 AC1)', () => {
  const violations = sources()
    .flatMap(({ file, text }) => copyUses(text).map((use) => `${file}: ${use}`));
  assert.deepEqual(violations, [], `the temperatures copy is retired, InfluxDB is the reading's only store (RF009 AC1, #1391):\n${violations.join('\n')}`);
});

// Control: the matchers flag the collection named in a call or a `name:`
// entry, and pass a row key, a property, a longer name or a comment, so an
// empty violation list above is not a matcher that sees nothing.
test('control: a temperatures collection call or name entry is flagged, other uses are not', () => {
  assert.equal(copyUses("db.collection('temperatures').insertOne(x)").length, 1);
  assert.equal(copyUses('const t = await getCollection(db, "temperatures");').length, 1);
  assert.equal(copyUses("{ label: 'temperatures', name: 'temperatures' }").length, 1);
  assert.deepEqual(copyUses("rowKey: 'temperatures'"), []);
  assert.deepEqual(copyUses('return result.temperatures;'), []);
  assert.deepEqual(copyUses("db.collection('temperaturePolicies').find({})"), []);
  assert.deepEqual(copyUses(stripComments("// db.collection('temperatures')")), []);
});
