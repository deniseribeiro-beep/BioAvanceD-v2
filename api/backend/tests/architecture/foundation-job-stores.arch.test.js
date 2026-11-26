// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// RF022 AC8, RNF031 C7 (#1571): the Foundation job creates no telemetry and
// no files. Its zero-operational-data gate counts the Mongo collections that
// hold telemetry and file metadata before and after apply; the InfluxDB
// readings and the DataFile binaries live outside Mongo, so this test shows
// the job cannot write either: every module the job requires, followed
// transitively from scripts/seed-essential-reference-data.js, lazy requires
// included, needs only the packages in ALLOWED_PACKAGES and reaches no module
// under STORE_DIRS. A regression guard over the forms it reads (a
// require('<string literal>') call, after comments are blanked; any other
// require( argument fails the test), not a proof that no other route to a
// store exists. A resolved .js or .cjs file is read, a .json file has no
// requires, and any other file (an .mjs, whose imports this test does not
// read) counts as one it cannot follow.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const { stripComments } = require('./helpers/strip-comments');

const backendRoot = path.resolve(__dirname, '..', '..');
const ENTRY = path.join(backendRoot, 'scripts', 'seed-essential-reference-data.js');

// Node built-ins and packages the job may load. None of them writes to
// InfluxDB, an object store, the network or the local disk.
const ALLOWED_PACKAGES = ['async_hooks', 'crypto', 'dotenv', 'mongodb', 'os', 'path', 'util'];

// The directories holding the InfluxDB client and write path and the
// DataFile object store.
const STORE_DIRS = [
  path.join('src', 'infrastructure', 'database', 'influxdb'),
  path.join('src', 'infrastructure', 'persistence', 'influxdb'),
  path.join('src', 'infrastructure', 'objectStorage'),
];

const REQUIRE_CALL = /\brequire\s*\(/g;
const LITERAL_REQUIRE = /^\s*(['"])([^'"\n]+)\1\s*\)/;

const diskIo = {
  read: (file) => fs.readFileSync(file, 'utf8'),
  isFile: (file) => fs.existsSync(file) && fs.statSync(file).isFile(),
};

// A directory holding a package.json may name another main than index.js,
// so it resolves to nothing and counts as a require this test cannot follow.
function resolveLocal(from, specifier, io) {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.json`]) {
    if (io.isFile(candidate)) return candidate;
  }
  if (io.isFile(path.join(base, 'package.json'))) return null;
  const index = path.join(base, 'index.js');
  return io.isFile(index) ? index : null;
}

function packageOf(specifier) {
  const bare = specifier.replace(/^node:/, '');
  const parts = bare.split('/');
  return bare.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function closure(entry, io = diskIo) {
  const files = new Set([entry]);
  const packages = new Set();
  const unreadable = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    const where = path.relative(backendRoot, file).split(path.sep).join('/');
    if (file.endsWith('.json')) continue;
    if (!file.endsWith('.js') && !file.endsWith('.cjs')) {
      unreadable.push(where);
      continue;
    }
    const source = stripComments(io.read(file));
    for (const match of source.matchAll(REQUIRE_CALL)) {
      const literal = source.slice(match.index + match[0].length).match(LITERAL_REQUIRE);
      if (!literal) {
        unreadable.push(where);
        continue;
      }
      const specifier = literal[2];
      if (!specifier.startsWith('.')) {
        packages.add(packageOf(specifier));
        continue;
      }
      const resolved = resolveLocal(file, specifier, io);
      if (!resolved) {
        unreadable.push(`${where} -> ${specifier}`);
        continue;
      }
      if (!files.has(resolved)) {
        files.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return { files, packages, unreadable };
}

const job = closure(ENTRY);

test('every require in the Foundation job closure names a string literal it can follow', () => {
  assert.ok(job.files.size > 1);
  assert.deepStrictEqual(job.unreadable, []);
});

test('the Foundation job needs no package that can write telemetry, files or the network', () => {
  const extra = [...job.packages].filter((name) => !ALLOWED_PACKAGES.includes(name)).sort();
  assert.deepStrictEqual(extra, []);
});

test('the Foundation job reaches neither the InfluxDB write path nor the object store', () => {
  const reached = [...job.files]
    .map((file) => path.relative(backendRoot, file))
    .filter((rel) => STORE_DIRS.some((dir) => rel === dir || rel.startsWith(dir + path.sep)))
    .map((rel) => rel.split(path.sep).join('/'));
  assert.deepStrictEqual(reached, []);
});

// The closure walk itself, over an in-memory tree: a module reached through
// a .cjs or .mjs require is followed or fails closed, never skipped.
function memoryIo(tree) {
  const byPath = new Map(Object.entries(tree).map(([rel, text]) => [path.join(backendRoot, rel), text]));
  return { read: (file) => byPath.get(file), isFile: (file) => byPath.has(file) };
}

test('the closure reads a required .cjs module and sees its own requires', () => {
  const io = memoryIo({
    'scripts/entry.js': "const lib = require('./lib.cjs');",
    'scripts/lib.cjs': "const fs = require('fs'); require('../src/infrastructure/objectStorage');",
    'src/infrastructure/objectStorage/index.js': 'module.exports = {};',
  });
  const walked = closure(path.join(backendRoot, 'scripts', 'entry.js'), io);
  assert.deepStrictEqual([...walked.packages], ['fs']);
  assert.ok(walked.files.has(path.join(backendRoot, 'src', 'infrastructure', 'objectStorage', 'index.js')));
  assert.deepStrictEqual(walked.unreadable, []);
});

test('the closure counts a required .mjs module as one it cannot follow', () => {
  const io = memoryIo({
    'scripts/entry.js': "const lib = require('./lib.mjs');",
    'scripts/lib.mjs': "import fs from 'node:fs';",
  });
  const walked = closure(path.join(backendRoot, 'scripts', 'entry.js'), io);
  assert.deepStrictEqual(walked.unreadable, ['scripts/lib.mjs']);
});

test('the closure counts a required directory holding a package.json as one it cannot follow', () => {
  const io = memoryIo({
    'scripts/entry.js': "require('./dir');",
    'scripts/dir/package.json': '{"main":"impl.js"}',
    'scripts/dir/index.js': 'module.exports = {};',
    'scripts/dir/impl.js': "require('fs');",
  });
  const walked = closure(path.join(backendRoot, 'scripts', 'entry.js'), io);
  assert.deepStrictEqual(walked.unreadable, ['scripts/entry.js -> ./dir']);
  assert.ok(!walked.files.has(path.join(backendRoot, 'scripts', 'dir', 'index.js')));
});
