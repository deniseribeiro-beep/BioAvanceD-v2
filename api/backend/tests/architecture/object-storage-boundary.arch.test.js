// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// RNF028 C1 (#1574): objects are kept apart from the canonical write. A
// DataFile binary reaches the object store through
// src/infrastructure/objectStorage/index.js (getFileObjectStore), the one
// door to its adapters. Every file outside that directory that requires one
// of its modules directly, and every file that names a local disk root
// (STORAGE_BASE, UPLOADS_BASE, UPLOAD_ROOT from src/config/uploadConfig.js),
// is listed below with why, so a new direct disk writer or adapter user fails
// this test until it is reviewed and listed. A regression guard over the
// import forms listed at SPECIFIER and the three root names, not a proof that
// no other route to the disk exists. The layer list is in
// docs/decisions/2026-11-17-rnf028-layer-boundaries.md.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const { stripComments } = require('./helpers/strip-comments');

const backendRoot = path.resolve(__dirname, '..', '..');
const srcDir = path.join(backendRoot, 'src');
const STORE_DIR = path.join(srcDir, 'infrastructure', 'objectStorage');
const STORE_INDEX = path.join(STORE_DIR, 'index');
const ENTRY_FILES = ['server.js', 'app.js'].map((f) => path.join(backendRoot, f));

// Files outside the object-store directory that require one of its modules
// other than index.js, and why.
const ADAPTER_USERS = {
  'src/services/backup-offsite.service.js': 'signs its off-site backup upload with awsSigV4; backups stay out of the DataFile store (docs/decisions/2026-10-30-backup-files-outside-object-store.md)',
  'src/services/fileBinaryRewrite.service.js': 'reads the object URI patterns only; its store comes from getFileObjectStore',
};

// Files that name a local disk root, and why. The roots are defined in
// src/config/uploadConfig.js, and the object store's filesystem adapter is
// inside STORE_DIR; neither is listed.
const DISK_ROOT_USERS = {
  'src/controllers/createLinkedFileController.js': 'multer stages the upload under STORAGE_BASE; the binary then goes through getFileObjectStore().putObject',
  'src/controllers/import-async.controller.js': 'temp directory for an uploaded import file (UPLOADS_BASE/temp)',
  'src/controllers/import-batch.controller.js': 'temp directory for an uploaded import file (UPLOADS_BASE/temp)',
  'src/controllers/import-lgpd.controller.js': 'temp directory for an uploaded import file (UPLOADS_BASE/temp)',
  'src/controllers/import.controller.js': 'temp directory for an uploaded import file (UPLOADS_BASE/temp)',
  'src/controllers/sample-file.controller.js': 'multer stages the upload under STORAGE_BASE; the binary then goes through getFileObjectStore().putObject',
  'src/controllers/upload.controller.js': 'analysis-file uploads under UPLOAD_ROOT, paths kept relative to UPLOADS_BASE',
  'src/interface/routes/referenceImportsTestSupport.routes.js': 'test support only: reads a preserved reference asset under STORAGE_BASE',
  'src/interface/routes/result.routes.js': 'legacy: result files written to STORAGE_BASE/results, outside the object store',
  'src/reference-data/reference-imports/pipeline.js': 'the reference release asset root, STORAGE_BASE by default',
  'src/services/consentEvidence.service.js': 'legacy: consent evidence files written to STORAGE_BASE/consents under an objstore:// URI, not through getFileObjectStore',
  'src/services/legacyFileMigration.service.js': 'the migration of legacy disk binaries into the object store (docs/decisions/2026-10-30-data-file-legacy-disk-rows-migration.md)',
  'src/services/staging-import.service.js': 'staging-import upload directory (UPLOADS_BASE/staging-imports)',
};

const DISK_ROOT = /\b(?:STORAGE_BASE|UPLOADS_BASE|UPLOAD_ROOT)\b/;
const NOT_SCANNED_FOR_ROOTS = new Set(['src/config/uploadConfig.js']);

// A module specifier in require(...), import(...), import ... from '...',
// export ... from '...' or a bare import '...', in quotes or a template
// literal without a substitution (the form redis-transient-only reads).
const SPECIFIER =
  /\brequire\s*\(\s*(['"`])([^'"`$]+)\1\s*\)|\bimport\s*\(\s*(['"`])([^'"`$]+)\3\s*\)|\bfrom\s*(['"`])([^'"`$]+)\5|\bimport\s*(['"`])([^'"`$]+)\7/g;

function specifiers(content) {
  return [...content.matchAll(SPECIFIER)].map((m) => m[2] || m[4] || m[6] || m[8]);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(c|m)?js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file) => path.relative(backendRoot, file).split(path.sep).join('/');
const insideStoreDir = (file) => !path.relative(STORE_DIR, file).startsWith('..');

function reachesAdapter(file, content) {
  return specifiers(content).some((spec) => {
    if (!spec.startsWith('.')) return false;
    const resolved = path.resolve(path.dirname(file), spec).replace(/\.(c|m)?js$/, '');
    if (resolved === STORE_DIR || resolved === STORE_INDEX) return false;
    return !path.relative(STORE_DIR, resolved).startsWith('..');
  });
}

const read = (file) => stripComments(fs.readFileSync(file, 'utf8'));
const scanned = () => [...walk(srcDir), ...ENTRY_FILES.filter((f) => fs.existsSync(f))].filter((f) => !insideStoreDir(f));

function adapterUsers() {
  return scanned().filter((f) => reachesAdapter(f, read(f))).map(rel).sort();
}

function diskRootUsers() {
  return scanned().map((f) => [rel(f), f]).filter(([r, f]) => !NOT_SCANNED_FOR_ROOTS.has(r) && DISK_ROOT.test(read(f))).map(([r]) => r).sort();
}

test('RNF028 C1: only the listed files reach an object-store adapter around getFileObjectStore', () => {
  assert.deepStrictEqual(adapterUsers(), Object.keys(ADAPTER_USERS).sort());
});

test('RNF028 C1: only the listed files name a local disk root', () => {
  assert.deepStrictEqual(diskRootUsers(), Object.keys(DISK_ROOT_USERS).sort());
});

test('RNF028 C1: the scan reads every listed form (control rows)', () => {
  const file = path.join(srcDir, 'services', 'probe.js');
  for (const text of [
    "require('../infrastructure/objectStorage/s3ObjectStore')",
    "require ('../infrastructure/objectStorage/filesystemObjectStore.js')",
    "import('../infrastructure/objectStorage/awsSigV4')",
    "import { x } from '../infrastructure/objectStorage/s3ObjectStore';",
    "export { y } from '../infrastructure/objectStorage/s3ObjectStore';",
    'require(`../infrastructure/objectStorage/s3ObjectStore`)',
  ]) assert.equal(reachesAdapter(file, text), true, text);
  assert.equal(reachesAdapter(file, "require('../infrastructure/objectStorage')"), false);
  assert.equal(reachesAdapter(file, "require('../infrastructure/objectStorage/index.js')"), false);
  assert.equal(DISK_ROOT.test('const { STORAGE_BASE } = require(x)'), true);
  assert.equal(DISK_ROOT.test('MY_STORAGE_BASE_DIR'), false);
});
