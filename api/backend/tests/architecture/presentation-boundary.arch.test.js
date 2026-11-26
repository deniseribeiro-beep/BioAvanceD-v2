// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// RNF028 C1 (#1574): presentation is kept apart from the backend and its
// stores. The frontend reaches the backend only over HTTP: no frontend source
// file imports a backend module or a store client package, the frontend
// declares no store client package, and no backend file imports a frontend
// module or renders a view. A regression guard over the import forms listed
// at SPECIFIER and the package names listed at STORE_PACKAGE, not a proof that
// no other route exists. The layer list is in
// docs/decisions/2026-11-17-rnf028-layer-boundaries.md.

const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const { stripComments } = require('./helpers/strip-comments');

const backendRoot = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(backendRoot, '..', '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');
const FRONTEND_SRC = path.join(FRONTEND_DIR, 'src');

// The frontend is not in the backend-unit-runner image (#1190's class).
const IN_REPO_TREE = fs.existsSync(path.join(REPO_ROOT, 'api', 'backend', 'package.json')) && fs.existsSync(FRONTEND_SRC);
const test = IN_REPO_TREE
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: 'repo tree not reachable (expected inside backend-unit-runner)' }, fn);

// A store client package: MongoDB, Neo4j, Redis and its queues, InfluxDB,
// an S3 client, a SQL driver.
const STORE_PACKAGE = /^(?:mongoose|mongodb|neo4j-driver|redis|ioredis|@redis\/[^/]+|bull|bullmq|@influxdata\/[^/]+|@aws-sdk\/[^/]+|pg|mysql2?)(?:\/|$)/;

// A module specifier in require(...), import(...), import ... from '...',
// export ... from '...' or a bare import '...', in quotes or a template
// literal without a substitution (the form redis-transient-only reads).
const SPECIFIER =
  /\brequire\s*\(\s*(['"`])([^'"`$]+)\1\s*\)|\bimport\s*\(\s*(['"`])([^'"`$]+)\3\s*\)|\bfrom\s*(['"`])([^'"`$]+)\5|\bimport\s*(['"`])([^'"`$]+)\7/g;

function specifiers(content) {
  return [...content.matchAll(SPECIFIER)].map((m) => m[2] || m[4] || m[6] || m[8]);
}

// A test file may import a backend module to pin a wire contract both sides
// share (src/api/timingReporter.test.ts); shipped code may not.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function walk(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
      walk(full, ext, out);
    } else if (ext.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file) => path.relative(REPO_ROOT, file).split(path.sep).join('/');
const inside = (dir, file) => {
  const r = path.relative(dir, file);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

function frontendOffences(file, content) {
  const out = [];
  for (const spec of specifiers(content)) {
    if (STORE_PACKAGE.test(spec)) out.push(`${rel(file)} imports ${spec}`);
    else if (spec.startsWith('.') && !inside(FRONTEND_DIR, path.resolve(path.dirname(file), spec))) out.push(`${rel(file)} imports ${spec}`);
  }
  return out;
}

function backendOffences(file, content) {
  const out = [];
  for (const spec of specifiers(content)) {
    if (spec.startsWith('.') && inside(FRONTEND_DIR, path.resolve(path.dirname(file), spec))) out.push(`${rel(file)} imports ${spec}`);
  }
  if (/\bres\s*\.\s*render\s*\(/.test(content)) out.push(`${rel(file)} renders a view`);
  return out;
}

const read = (file) => stripComments(fs.readFileSync(file, 'utf8'));

test('RNF028 C1: no shipped frontend file imports a backend module or a store client', () => {
  const files = walk(FRONTEND_SRC, /\.[cm]?[jt]sx?$/).filter((f) => !TEST_FILE.test(f));
  assert.ok(files.length > 0, 'the scan read no frontend file');
  const offences = files.flatMap((f) => frontendOffences(f, read(f)));
  assert.deepStrictEqual(offences, []);
});

test('RNF028 C1: the frontend declares no store client package', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(FRONTEND_DIR, 'package.json'), 'utf8'));
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies });
  assert.ok(names.length > 0, 'the frontend package.json lists no dependency');
  assert.deepStrictEqual(names.filter((n) => STORE_PACKAGE.test(n)), []);
});

test('RNF028 C1: no backend file imports a frontend module or renders a view', () => {
  const files = [...walk(path.join(backendRoot, 'src'), /\.(c|m)?js$/), ...['app.js', 'server.js'].map((f) => path.join(backendRoot, f)).filter((f) => fs.existsSync(f))];
  const offences = files.flatMap((f) => backendOffences(f, read(f)));
  assert.deepStrictEqual(offences, []);
});

test('RNF028 C1: the scan reads every listed form (control rows)', () => {
  const fe = path.join(FRONTEND_SRC, 'views', 'probe.tsx');
  for (const text of [
    "import x from '../../../api/backend/src/app';",
    "import '../../../api/backend/src/app';",
    "const m = await import('../../../api/backend/src/app');",
    "export { y } from '../../../api/backend/src/app';",
    "const z = require(`mongoose`);",
    "import { Driver } from 'neo4j-driver';",
    "import { S3Client } from '@aws-sdk/client-s3';",
  ]) assert.equal(frontendOffences(fe, text).length, 1, text);
  assert.deepStrictEqual(frontendOffences(fe, "import { apiClient } from '../api/client'; import axios from 'axios';"), []);
  const be = path.join(backendRoot, 'src', 'routes', 'probe.js');
  assert.equal(backendOffences(be, "require('../../../../frontend/src/App')").length, 1);
  assert.equal(backendOffences(be, "res.render('index')").length, 1);
  assert.deepStrictEqual(backendOffences(be, "require('../config/env')"), []);
});
