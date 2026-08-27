// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #826.
//
// Guards the class of defect behind #826: a worker process that reaches a
// Mongoose model but never opens a Mongoose connection. Mongoose does not
// fail loudly there — it *buffers* the operation and rejects it after 10s,
// so the symptom is a job that fails, retries forever, and leaves its
// document at its initial status. The API process happened to work only
// because staging-import.service's upload path calls connectMongoDB() as a
// side effect, which is exactly what made this process-dependent instead of
// a startup error.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..', '..');
const srcRoot = path.join(backendRoot, 'src');

const WORKER_ENTRYPOINTS = [
  path.join(srcRoot, 'workers', 'worker.js'),
  path.join(srcRoot, 'workers', 'import-worker.js'),
  path.join(srcRoot, 'workers', 'neo4jProjection.worker.js'),
];

const REQUIRE_PATTERN = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

/** Resolve a relative require specifier to a file on disk, or null. */
function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every first-party file transitively reachable from `entry`. */
function reachableFrom(entry) {
  const seen = new Set();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    const source = read(file);
    for (const match of source.matchAll(REQUIRE_PATTERN)) {
      const resolved = resolveRelative(file, match[1]);
      if (resolved) queue.push(resolved);
    }
  }

  return seen;
}

/** A Mongoose model: registers a schema whose operations buffer without a connection. */
function isMongooseModel(file) {
  const source = read(file);
  return /require\(\s*['"]mongoose['"]\s*\)/.test(source) && /mongoose\.model\(/.test(source);
}

/** Opens (or awaits) a real Mongoose connection, rather than the native driver's. */
function opensMongooseConnection(file) {
  const source = read(file);
  return /\bconnectMongoDB\s*\(/.test(source) || /\bmongoose\s*\.connect\s*\(/.test(source);
}

for (const entry of WORKER_ENTRYPOINTS) {
  const label = toPosix(path.relative(backendRoot, entry));

  test(`${label} connects Mongoose if it can reach a Mongoose model`, () => {
    const reachable = reachableFrom(entry);

    const models = [...reachable]
      .filter(isMongooseModel)
      .map((file) => toPosix(path.relative(backendRoot, file)))
      .sort();

    if (models.length === 0) return;

    const connectors = [...reachable]
      .filter(opensMongooseConnection)
      .map((file) => toPosix(path.relative(backendRoot, file)))
      .sort();

    assert.ok(
      connectors.length > 0,
      `${label} reaches Mongoose model(s) [${models.join(', ')}] but no file in its ` +
        'require graph calls connectMongoDB()/mongoose.connect(). Every model write ' +
        'will buffer and time out after 10s in this process (#826).'
    );
  });
}
