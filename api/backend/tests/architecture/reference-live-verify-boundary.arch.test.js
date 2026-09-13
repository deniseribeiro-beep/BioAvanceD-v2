// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const importDir = path.join(repoRoot, 'src', 'reference-data', 'reference-imports');
const liveVerifyDir = path.join(repoRoot, 'scripts', 'reference-imports', 'live-verify');
const workflowsDir = path.resolve(repoRoot, '..', '..', '.github', 'workflows');

const networkCallPatterns = [/\bfetch\(/, /require\(['"]https?['"]\)/, /require\(['"]axios['"]\)/, /\baxios\./, /XMLHttpRequest/];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function listJsFilesRecursive(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFilesRecursive(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// #555 (RF028/#550 foundational piece): the "no live network calls"
// guarantee reference-import-boundary.arch.test.js checks per-source is
// re-asserted here directory-wide, so it holds for every current and future
// file under src/reference-data/reference-imports/ without needing a new
// per-source line each time — the fixture-only operational pipeline stays
// provably untouched by #556/#557's live-verify work.
test('no file under src/reference-data/reference-imports/ contains a live network call', () => {
  for (const file of listJsFilesRecursive(importDir)) {
    const contents = read(file);
    for (const pattern of networkCallPatterns) {
      assert.doesNotMatch(contents, pattern, `${path.relative(repoRoot, file)} matched ${pattern}`);
    }
  }
});

// Inverse of the above: the live-verify module is the one deliberate
// exception (#555) and must actually contain the network calls it exists
// for — an empty/no-op module here would silently defeat #556/#557's point
// without tripping any "boundary" assertion.
test('the live-verify module (the deliberate network exception) does contain a live fetch call', () => {
  const contents = read(path.join(liveVerifyDir, 'fetchLiveRelease.js'));
  assert.match(contents, /\bfetch\(/, 'fetchLiveRelease.js should call fetch() — it is the live-verify exception module');
});

test('the verify-live-release CLI actually uses the live-fetch module rather than a no-op', () => {
  const contents = read(path.join(liveVerifyDir, 'verify-live-release.js'));
  assert.match(contents, /require\(['"]\.\/fetchLiveRelease['"]\)/);
});

test('the live-verify module lives outside src/reference-data/reference-imports/', () => {
  assert.strictEqual(liveVerifyDir.startsWith(importDir), false);
});

// #584: backend-unit-runner's Docker build context is `./api/backend` only
// — `.github/` is never inside it, so this repo-root-relative check can
// never pass there. It already runs natively with full checkout access via
// ci-pipeline.yml's separate "Backend architecture tests" step (`npm run
// test:architecture`, no Docker involved), so skipping it here when
// `.github/workflows/` isn't reachable doesn't lose coverage.
test('the reference-data-live-verify workflow only ever runs on workflow_dispatch, never push/pull_request', {
  skip: fs.existsSync(workflowsDir)
    ? false
    : `.github/workflows/ not reachable from ${workflowsDir} (expected when running inside a container whose build context excludes it) — this check runs natively in CI's own "Backend architecture tests" step instead`
}, () => {
  const workflowPath = path.join(workflowsDir, 'reference-data-live-verify.yml');
  const contents = read(workflowPath);
  assert.match(contents, /workflow_dispatch:/);
  assert.doesNotMatch(contents, /^\s*push:\s*$/m);
  assert.doesNotMatch(contents, /^\s*pull_request:\s*$/m);
});
