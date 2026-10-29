// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1374, v2.0.0 RULE-026 (Legacy StorageAssignment): a new write is
// rejected; only historical reads and the controlled migration into the
// normalized physical assignment chain are accepted. The three readers
// below are exactly that: legacyPlacementChain.service.js reads an open
// row as the placement fallback, storageAssignmentChainMigration.service.js
// migrates rows into the chain, and graph-projection-reconcile.js reads
// open rows to reconcile the graph. None of them writes the collection.
//
// This test fails the day a file outside that list names the collection,
// the day any file writes it, or the day anything requires the
// StorageAssignment model, whose open/closeFields are the only row
// builders.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const { readStripped, stripComments } = require('./helpers/strip-comments');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const SCANNED_DIRS = ['src', 'scripts'].map((dir) => path.join(BACKEND_ROOT, dir));

// Relative to api/backend. See the header for what each one reads.
const ALLOWED_READERS = [
  'src/services/legacyPlacementChain.service.js',
  'src/services/storageAssignmentChainMigration.service.js',
  'scripts/graph-projection-reconcile.js',
];

const WRITE = 'insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany'
  + '|findOneAndUpdate|findOneAndReplace|findOneAndDelete|bulkWrite|drop|rename'
  + '|createIndex|createIndexes';

const COLLECTION_LITERAL = /(['"`])storageAssignments\1/;
const DIRECT_WRITE = new RegExp(
  `\\b(?:collection|getCollection)\\s*\\([^)]*?(['"\`])storageAssignments\\1[^)]*\\)\\s*\\.\\s*(?:${WRITE})\\s*\\(`,
);
const HANDLE_BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[\w$.]*?\b(?:collection|getCollection)\s*\(([^)]*)\)/g;
const MODEL_REQUIRE = /\brequire\s*\(\s*(['"`])[^'"`]*models\/StorageAssignment(?:\.js)?\1\s*\)/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const relative = (file) => path.relative(BACKEND_ROOT, file).split(path.sep).join('/');
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sources() {
  return SCANNED_DIRS.flatMap((dir) => walk(dir))
    .map((file) => ({ file: relative(file), text: readStripped(fs, file) }));
}

// The writes a piece of stripped source makes on storageAssignments, as
// the matched text: a write chained straight onto the collection call, or
// a write through a handle bound to it.
function legacyWrites(text) {
  const writes = [];
  const direct = text.match(DIRECT_WRITE);
  if (direct) writes.push(direct[0]);
  for (const [, name, args] of text.matchAll(HANDLE_BINDING)) {
    if (!COLLECTION_LITERAL.test(args)) continue;
    const handleWrite = text.match(new RegExp(`(?<![\\w$])${escapeRegExp(name)}\\s*\\.\\s*(?:${WRITE})\\s*\\(`));
    if (handleWrite) writes.push(handleWrite[0]);
  }
  return writes;
}

function readers() {
  return sources().filter(({ text }) => COLLECTION_LITERAL.test(text)).map(({ file }) => file).sort();
}

test('only the allowed historical readers and the migration name storageAssignments (RULE-026)', () => {
  const unexpected = readers().filter((file) => !ALLOWED_READERS.includes(file));
  assert.deepEqual(unexpected, [], `${unexpected.join(', ')} names storageAssignments: RULE-026 allows only ${ALLOWED_READERS.join(', ')} (#1374)`);
});

test('no backend code writes storageAssignments (RULE-026)', () => {
  const violations = sources()
    .filter(({ text }) => COLLECTION_LITERAL.test(text))
    .flatMap(({ file, text }) => legacyWrites(text).map((write) => `${file}: ${write}`));
  assert.deepEqual(violations, [], `legacy StorageAssignment write, rejected by RULE-026 (#1374):\n${violations.join('\n')}`);
});

test('nothing requires the StorageAssignment model, the only row builder (RULE-026)', () => {
  const requirers = sources().filter(({ text }) => MODEL_REQUIRE.test(text)).map(({ file }) => file).sort();
  assert.deepEqual(requirers, [], `${requirers.join(', ')} requires models/StorageAssignment: RULE-026 rejects a new row (#1374)`);
});

// Controls: the matchers flag a write and pass a read or a comment, and the
// reader scan really sees an allowed reader, so an empty violation list
// above is not a matcher that sees nothing.
test('control: a write on storageAssignments is flagged, a read or a comment is not', () => {
  assert.equal(legacyWrites("db.collection('storageAssignments').insertOne(x)").length, 1);
  assert.equal(legacyWrites('const sa = db.collection("storageAssignments");\nawait sa.updateOne(f, u)').length, 1);
  assert.deepEqual(legacyWrites("const sa = await getCollection(db, 'storageAssignments'); sa.find({})"), []);
  assert.deepEqual(legacyWrites(stripComments("// db.collection('storageAssignments').insertOne(x)")), []);
  assert.ok(MODEL_REQUIRE.test("require('../models/StorageAssignment')"));
});

test('control: the reader scan sees legacyPlacementChain.service.js', () => {
  assert.ok(readers().includes('src/services/legacyPlacementChain.service.js'));
});
