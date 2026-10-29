// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1103: utils/encryptedFieldRegistry.js is the one inventory of fields
// encrypted at rest, and the key-rotation rewrite (npm run
// encryption:rewrite) re-encrypts only what it lists. A field written with
// encryptValue somewhere the registry does not name is left under the old
// key, and emptying the previous slot then loses it silently. #1101's
// hand-kept list drifted from four call sites to six in one sitting, which
// is why this is a test and not a comment.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const { readStripped } = require('./helpers/strip-comments');

const BACKEND_SRC = path.resolve(__dirname, '../../src');
// The definition, and the rewrite, which re-encrypts only registry fields.
const NOT_WRITERS = new Set(['utils/fieldEncryption.js', 'scripts/rewriteEncryptedFields.js']);
const { ENCRYPTED_FIELD_REGISTRY } = require(path.join(BACKEND_SRC, 'utils/encryptedFieldRegistry'));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const relative = (file) => path.relative(BACKEND_SRC, file).split(path.sep).join('/');
const CALLS_ENCRYPT = /\bencryptValue\s*\(/;

function encryptValueCallers() {
  return walk(BACKEND_SRC)
    .filter((file) => !NOT_WRITERS.has(relative(file)))
    .filter((file) => CALLS_ENCRYPT.test(readStripped(fs, file)))
    .map(relative)
    .sort();
}

test('every module that calls encryptValue has a registry entry', () => {
  const writers = new Set(ENCRYPTED_FIELD_REGISTRY.map((entry) => entry.writer));
  const missing = encryptValueCallers().filter((file) => !writers.has(file));
  assert.deepEqual(missing, [], `encryptValue called outside the registry: ${missing.join(', ')}`);
});

test('every registry writer exists and calls encryptValue', () => {
  for (const entry of ENCRYPTED_FIELD_REGISTRY) {
    const file = path.join(BACKEND_SRC, entry.writer);
    assert.ok(fs.existsSync(file), `${entry.writer} does not exist`);
    assert.ok(CALLS_ENCRYPT.test(readStripped(fs, file)), `${entry.writer} does not call encryptValue`);
  }
});

test("each ciphertext field is spelled in its writer, or the writer reads its map from the registry", () => {
  for (const entry of ENCRYPTED_FIELD_REGISTRY) {
    const source = readStripped(fs, path.join(BACKEND_SRC, entry.writer));
    if (/\bfieldMapFor\s*\(/.test(source)) continue;
    for (const field of Object.values(entry.fields)) {
      assert.ok(new RegExp(`\\b${field}\\b`).test(source), `${entry.writer} does not write ${field}`);
    }
  }
});

test('each entry names its collection one way', () => {
  for (const entry of ENCRYPTED_FIELD_REGISTRY) {
    assert.equal(Boolean(entry.collectionKey) !== Boolean(entry.collectionName), true, JSON.stringify(entry));
  }
});

// Control: the matcher sees a call the registry would have to cover, and
// not a mention in a comment.
test('control: the caller matcher reads code, not comments', () => {
  assert.ok(CALLS_ENCRYPT.test(require('./helpers/strip-comments').stripComments('const x = encryptValue(v);')));
  assert.ok(!CALLS_ENCRYPT.test(require('./helpers/strip-comments').stripComments('// encryptValue(v)')));
});
