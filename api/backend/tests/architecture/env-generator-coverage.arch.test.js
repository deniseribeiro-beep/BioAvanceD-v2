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
// This guard turns that class into a test failure. It does NOT run on CI,
// and skips there by design (#1190): CI runs test:architecture inside
// backend-unit-runner, whose image holds only api/backend and is
// node:22-alpine (no bash, openssl or python3). It runs natively.

const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GENERATOR = path.resolve(REPO_ROOT, 'generate-env-docker-secrets.sh');
const EXAMPLE = path.resolve(REPO_ROOT, '.env.docker.example');

// #1190, #1059's class: in backend-unit-runner REPO_ROOT clamps at `/`.
// Keyed on the repo tree, not the generator, so the existsSync asserts below
// still fail natively on a deleted or renamed generator.
const IN_REPO_TREE = fs.existsSync(path.join(REPO_ROOT, 'api', 'backend', 'package.json'));
const test = IN_REPO_TREE
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: '#1190: repo tree not reachable (expected inside backend-unit-runner)' }, fn);

// The digit-bearing class is mandatory, not stylistic: ^[A-Z_]+= silently
// drops every name containing a digit (NEO4J_*, INFLUXDB_*, AUDIT_RFC3161_*,
// S3_*) and returns a confident wrong count. Same trap as #477/#837, and it
// cost a wrong number in #1153's own sitting before being caught.
const DECLARATION = /^([A-Z0-9_]+)=/;

// WSL's `bash` (WindowsApps) rewrites a bare `C:\...` argv into `C:Users...`
// and fails; Git Bash accepts `C:/...`. Same rewrite as env-generator-behaviour.
function toBashPath(winPath) {
  if (process.platform !== 'win32') return winPath;
  const resolved = path.resolve(winPath);
  const uname = spawnSync('bash', ['-c', 'uname -s'], { encoding: 'utf8' });
  const kind = String(uname.stdout || '');
  if (/MINGW|MSYS/i.test(kind)) return resolved.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):(.*)$/.exec(resolved);
  if (drive) return `/mnt/${drive[1].toLowerCase()}${drive[2].replace(/\\/g, '/')}`;
  return resolved.replace(/\\/g, '/');
}

function runGenerator(outFile) {
  execFileSync('bash', [toBashPath(GENERATOR), toBashPath(outFile)], { cwd: REPO_ROOT, stdio: 'pipe' });
}

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
    runGenerator(outFile);

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

// #1161: the reverse direction. #1153 fixed "the example declares names the
// generator never writes"; this pins the mirror, so the two files stay exactly
// equal rather than merely one-way covered. NEO4J_CANONICAL_SALT was the whole
// gap when this was added -- written by the generator, declared by neither file,
// and silently falling back to USER_ANON_SALT.
test('a fresh generate declares nothing .env.docker.example omits (#1161)', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-generator-arch-'));
  const outFile = path.join(outDir, '.env.docker');
  try {
    runGenerator(outFile);

    const declared = declaredIn(EXAMPLE);
    const generated = declaredIn(outFile);
    const undeclared = [...generated].filter((name) => !declared.has(name)).sort();

    assert.deepEqual(
      undeclared,
      [],
      `${undeclared.length} variable(s) are written by the generator but declared nowhere: ${undeclared.join(', ')}`
    );
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

// #1162: a security default the sync must not quietly widen. `1` makes
// Express take req.ip from a client-supplied X-Forwarded-For, which is the
// key the rate limiters count against, and no stack in this repo puts
// anything in front of the backend.
test('a fresh generate does not trust a proxy that does not exist (#1162)', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-generator-arch-'));
  const outFile = path.join(outDir, '.env.docker');
  try {
    runGenerator(outFile);

    const trustLines = fs.readFileSync(outFile, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('TRUST_PROXY='));

    assert.equal(trustLines.length, 1, 'TRUST_PROXY must appear exactly once');
    assert.equal(trustLines[0], 'TRUST_PROXY=0');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

// #1162, Axis E E1 (Denise, 2026-09-25): the example ships both rate-limit
// relaxations as `true`, and a fresh generate must not inherit them, so
// relaxing an auth or consent control stays an explicit edit (#359, #832).
test('a fresh generate writes the rate-limit relaxations blank, not the example\'s true (#1162)', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-generator-arch-'));
  const outFile = path.join(outDir, '.env.docker');
  try {
    runGenerator(outFile);

    const lines = fs.readFileSync(outFile, 'utf8').split(/\r?\n/);
    const exampleLines = fs.readFileSync(EXAMPLE, 'utf8').split(/\r?\n/);
    for (const name of ['AUTH_RATE_LIMIT_RELAXED', 'CONSENT_RATE_LIMIT_RELAXED']) {
      // CONTROL: the example still carries the value the sync must NOT copy.
      assert.ok(exampleLines.includes(`${name}=true`), `the example must still declare ${name}=true`);
      const found = lines.filter((line) => line.startsWith(`${name}=`));
      assert.deepEqual(found, [`${name}=`], `${name} must be written exactly once, blank`);
    }
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
    runGenerator(outFile);

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
