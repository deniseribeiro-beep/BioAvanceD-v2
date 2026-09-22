// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect.
//
// #1153: generate-env-docker-secrets.sh writes far fewer variables than
// .env.docker.example declares, so the example -- the file a human reads to
// learn what the stack takes -- is documentation nothing produces. Drift in it
// is invisible until something fails at runtime, which is the shape #1060,
// #981 and #754 all reached from different directions.
//
// [ran it] 2026-09-22, before the fix: a fresh generate wrote 31 of the 80
// declared variables, and the 49 it omitted included REDIS_URL, REDIS_HOST and
// REDIS_PORT. compose.dev.yml supplies none of those -- its backend service
// has env_file: .env.docker plus an `environment:` block holding only the two
// CHOKIDAR variables -- so a freshly generated dev stack had no Redis
// configuration at all. validateRedisEnv errors on that, and because the
// generated file sets NODE_ENV=development, validateRedisOnly's development
// escape hatch logs "Redis não será inicializado" and lets the boot continue.
// The result was an import queue that silently did nothing. ALLOWED_ORIGINS
// and FRONTEND_URL were missing on the same terms.
//
// This guard turns that class into a test failure. It runs on CI: the pipeline
// is ubuntu-latest and already invokes `npm --prefix api/backend run
// test:architecture`, so bash, openssl and python3 are all present.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GENERATOR = path.resolve(REPO_ROOT, 'generate-env-docker-secrets.sh');
const EXAMPLE = path.resolve(REPO_ROOT, '.env.docker.example');

// The digit-bearing class is mandatory, not stylistic: ^[A-Z_]+= silently
// drops every name containing a digit (NEO4J_*, INFLUXDB_*, AUDIT_RFC3161_*,
// S3_*) and returns a confident wrong count. Same trap as #477/#837, and it
// cost a wrong number in #1153's own sitting before being caught.
const DECLARATION = /^([A-Z0-9_]+)=/;

function declaredIn(file) {
  return new Set(
    fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(DECLARATION))
      .filter(Boolean)
      .map((match) => match[1])
  );
}

test('a fresh generate covers every variable .env.docker.example declares (#1153)', () => {
  assert.ok(fs.existsSync(GENERATOR), `generator not found at ${GENERATOR}`);
  assert.ok(fs.existsSync(EXAMPLE), `example not found at ${EXAMPLE}`);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-generator-arch-'));
  const outFile = path.join(outDir, '.env.docker');
  try {
    // bash explicitly rather than relying on the executable bit, which does not
    // survive every checkout on every platform.
    execFileSync('bash', [GENERATOR, outFile], { cwd: REPO_ROOT, stdio: 'pipe' });

    const declared = declaredIn(EXAMPLE);
    const generated = declaredIn(outFile);
    const missing = [...declared].filter((name) => !generated.has(name)).sort();

    assert.deepEqual(
      missing,
      [],
      `${missing.length} of ${declared.size} declared variables are absent from a fresh generate: ${missing.join(', ')}`
    );
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

// The generator's own values must win where the two disagree. #1153 recorded
// one such divergence -- AUDIT_RFC3161_MODE is `remote` in the example and
// `disabled` from the generator -- and which is intended is #962's open call,
// not this test's. Pinning the precedence means filling the gaps from the
// example can never silently re-decide it.
test('syncing from the example does not overwrite a value the generator chose (#1153, #962)', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-generator-arch-'));
  const outFile = path.join(outDir, '.env.docker');
  try {
    execFileSync('bash', [GENERATOR, outFile], { cwd: REPO_ROOT, stdio: 'pipe' });

    const generated = fs.readFileSync(outFile, 'utf8');
    const modeLines = generated
      .split(/\r?\n/)
      .filter((line) => line.startsWith('AUDIT_RFC3161_MODE='));

    assert.equal(modeLines.length, 1, 'AUDIT_RFC3161_MODE must appear exactly once');
    assert.equal(modeLines[0], 'AUDIT_RFC3161_MODE=disabled');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
