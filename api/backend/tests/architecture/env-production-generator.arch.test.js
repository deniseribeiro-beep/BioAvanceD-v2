// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect.
//
// This file pins generate-env-production-secrets.sh: every secret the
// production stack needs is minted fresh and free of a carriage return,
// MONGO_URI embeds the very password written beside it, the file declares
// exactly the variables .env.production.example declares, the Merkle registry
// is the public half of the key file the script minted or reused, the external
// keys stay blank and are named on stdout, and an existing output is never
// overwritten. It also pins that compose.prod.yml mounts the key directory
// into backend and worker, that the key is 0400 in a 0700 directory, and that
// the generator's APP_UID is the fixed uid Dockerfile.prod gives `app` (#978).
//
// Every run operates on a COPY of the generator and .env.production.example
// inside a fresh mkdtempSync directory. The generator derives its key
// directory from BASH_SOURCE[0], so running the copy sandboxes the key: the
// repo's own infra/audit is never read, minted over, or deleted here.
//
// Does NOT run on CI, and skips there by design (#1190): CI runs
// test:architecture inside backend-unit-runner, whose image holds only
// api/backend (no generator, no example) and is node:22-alpine (no bash,
// openssl or python3). It runs natively, wherever the repo tree is present.

const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

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

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GENERATOR = path.resolve(REPO_ROOT, 'generate-env-production-secrets.sh');
const EXAMPLE = path.resolve(REPO_ROOT, '.env.production.example');
const COMPOSE_PROD = path.resolve(REPO_ROOT, 'compose.prod.yml');

// #1190, #1059's class: in backend-unit-runner REPO_ROOT clamps at `/`.
// Keyed on the repo tree being present, not on the generator, so a deleted
// or renamed generator still fails natively rather than skipping.
const IN_REPO_TREE = fs.existsSync(path.join(REPO_ROOT, 'api', 'backend', 'package.json'));
const test = IN_REPO_TREE
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: '#1190: repo tree not reachable (expected inside backend-unit-runner)' }, fn);

const MINTED = [
  'MONGO_ROOT_PASSWORD',
  'NEO4J_PASSWORD',
  'INFLUXDB_INIT_PASSWORD',
  'REDIS_PASSWORD',
  'INFLUXDB_TOKEN',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'CONSENT_SECRET',
  'ENCRYPTION_KEY',
  'USER_ANON_SALT',
  'MONGO_REPLICA_SET_KEY',
];

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-production-generator-'));
  const script = path.join(dir, 'generate-env-production-secrets.sh');
  fs.copyFileSync(GENERATOR, script);
  fs.copyFileSync(EXAMPLE, path.join(dir, '.env.production.example'));
  return {
    dir,
    script,
    keyFile: path.join(dir, 'infra', 'audit', 'prod', 'secrets', 'merkle_signing_key.pem'),
  };
}

function run(script, args, cwd) {
  // bash explicitly rather than relying on the executable bit, which does
  // not survive every checkout on every platform.
  // cwd stays a host path (Node's spawnSync); argv paths are rewritten for
  // WSL/Git Bash. Flags stay literal: path.resolve would turn them into
  // cwd/--flag under win32.
  const bashArgs = args.map((arg) => (String(arg).startsWith('-') ? arg : toBashPath(arg)));
  return spawnSync('bash', [toBashPath(script), ...bashArgs], { cwd, encoding: 'utf8' });
}

function parseEnv(content) {
  const out = {};
  for (const line of content.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function declaredNames(content) {
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => /^([A-Z0-9_]+)=/.exec(line))
      .filter(Boolean)
      .map((m) => m[1]),
  );
}

function withSandbox(fn) {
  const sandbox = makeSandbox();
  try {
    fn(sandbox);
  } finally {
    // WSL bash can briefly keep a handle on /mnt/c/... sandbox dirs after exit.
    try {
      fs.rmSync(sandbox.dir, { recursive: true, force: true });
    } catch (err) {
      if (err && err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
    }
  }
}

test('a fresh generate fills every minted secret and derives MONGO_URI from the minted password (#978)', () => {
  withSandbox(({ dir, script }) => {
    const out = path.join(dir, 'out.env');
    const res = run(script, [out], dir);
    assert.equal(res.status, 0, `fresh generate must succeed: ${res.stderr}`);

    const content = fs.readFileSync(out, 'utf8');
    const env = parseEnv(content);

    for (const name of MINTED) {
      assert.ok(env[name], `${name} must be non-empty`);
      assert.match(env[name], /^[A-Za-z0-9_-]+$/, `${name} must be base64url with no CR`);
    }
    assert.equal(new Set(MINTED.map((n) => env[n])).size, MINTED.length, 'minted secrets must be pairwise distinct');
    // RF023 AC3 (#1550): openssl rand -hex 48 prints 48 bytes as 96 hex digits, the
    // base64 subset a mongod key file accepts.
    assert.match(env.MONGO_REPLICA_SET_KEY, /^[0-9a-f]{96}$/, 'MONGO_REPLICA_SET_KEY must be 96 hex digits');

    assert.equal(
      env.MONGO_URI,
      `mongodb://${env.MONGO_ROOT_USERNAME}:${env.MONGO_ROOT_PASSWORD}@mongodb:27017/${env.MONGO_DB}?authSource=admin&replicaSet=rs0`,
      'MONGO_URI must embed the password written as MONGO_ROOT_PASSWORD and name the replica set rs0',
    );
    assert.equal(env.MONGO_DB_NOVO, env.MONGO_DB);
    assert.ok(!content.includes('\r'), 'no line of the output may contain a carriage return');

    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    }
  });
});

test('a second generate refuses and leaves the existing file untouched (#978)', () => {
  withSandbox(({ dir, script }) => {
    const out = path.join(dir, 'out.env');
    const first = run(script, [out], dir);
    assert.equal(first.status, 0, `fresh generate must succeed: ${first.stderr}`);
    const originalBytes = fs.readFileSync(out);

    const second = run(script, [out], dir);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /já existe/);
    assert.ok(fs.readFileSync(out).equals(originalBytes), 'the existing file must be byte-identical');
  });
});

test('a fresh generate declares exactly the variables .env.production.example declares (#978)', () => {
  withSandbox(({ dir, script }) => {
    const out = path.join(dir, 'out.env');
    const res = run(script, [out], dir);
    assert.equal(res.status, 0, `fresh generate must succeed: ${res.stderr}`);

    const generated = declaredNames(fs.readFileSync(out, 'utf8'));
    const expected = declaredNames(fs.readFileSync(EXAMPLE, 'utf8'));
    assert.deepEqual([...generated].sort(), [...expected].sort());
  });
});

test('the Merkle registry is the public half of the minted key file, reused on a later generate (#978)', () => {
  withSandbox(({ dir, script, keyFile }) => {
    const outA = path.join(dir, 'a.env');
    const outB = path.join(dir, 'b.env');
    assert.equal(run(script, [outA], dir).status, 0);
    const envA = parseEnv(fs.readFileSync(outA, 'utf8'));

    assert.equal(envA.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE, '/run/secrets/merkle_signing_key.pem');

    const keyBytes = fs.readFileSync(keyFile);
    const expectedPublic = crypto
      .createPublicKey(crypto.createPrivateKey(keyBytes))
      .export({ type: 'spki', format: 'pem' });
    const registryA = JSON.parse(envA.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON);
    assert.deepEqual(Object.keys(registryA), [envA.AUDIT_MERKLE_SIGN_KEY_ID]);
    assert.equal(registryA[envA.AUDIT_MERKLE_SIGN_KEY_ID], expectedPublic);

    const resB = run(script, [outB], dir);
    assert.equal(resB.status, 0, `second generate must succeed: ${resB.stderr}`);
    const envB = parseEnv(fs.readFileSync(outB, 'utf8'));
    assert.ok(fs.readFileSync(keyFile).equals(keyBytes), 'the key file must be reused, not re-minted');
    assert.equal(
      JSON.parse(envB.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON)[envB.AUDIT_MERKLE_SIGN_KEY_ID],
      expectedPublic,
    );
  });
});

const modesApply = process.platform !== 'win32';
nodeTest(
  'the signing key is 0400 in a 0700 directory, and a non-root run prints the chown to uid 10001 (#978)',
  { skip: !IN_REPO_TREE ? '#1190: repo tree not reachable' : !modesApply && 'file modes do not map to Linux modes on win32' },
  () => {
    withSandbox(({ dir, script, keyFile }) => {
      const res = run(script, [path.join(dir, 'out.env')], dir);
      assert.equal(res.status, 0, `fresh generate must succeed: ${res.stderr}`);
      // Backend and worker run as the image's `app`, uid 10001: the key is that uid's
      // alone, never readable by another host user.
      const keyDir = path.dirname(keyFile);
      assert.equal(fs.statSync(keyFile).mode & 0o777, 0o400);
      assert.equal(fs.statSync(keyDir).mode & 0o777, 0o700);
      if (process.getuid() !== 0) {
        assert.ok(res.stderr.includes('sudo chown -R 10001:10001'), `a non-root run must print the chown: ${res.stderr}`);
      }
    });
  },
);

test('Dockerfile.prod creates app with uid 10001, the generator\'s APP_UID (#978)', () => {
  const dockerfile = fs.readFileSync(path.resolve(REPO_ROOT, 'api', 'backend', 'Dockerfile.prod'), 'utf8');
  const generator = fs.readFileSync(GENERATOR, 'utf8');
  const user = /adduser -S -u (\d+) -G app app/.exec(dockerfile);
  const group = /addgroup -S -g (\d+) app/.exec(dockerfile);
  const appUid = /^APP_UID=(\d+)$/m.exec(generator);
  assert.ok(user && group, 'Dockerfile.prod must create app with a fixed uid and gid');
  assert.ok(appUid, 'the generator must declare APP_UID');
  assert.equal(user[1], '10001');
  assert.equal(group[1], user[1], 'app\'s gid must equal its uid');
  assert.equal(appUid[1], user[1], 'the generator\'s APP_UID must equal app\'s uid in Dockerfile.prod');
});

test('the external keys stay blank and are named on stdout (#978)', () => {
  withSandbox(({ dir, script }) => {
    const out = path.join(dir, 'out.env');
    const res = run(script, [out], dir);
    assert.equal(res.status, 0, `fresh generate must succeed: ${res.stderr}`);
    const env = parseEnv(fs.readFileSync(out, 'utf8'));

    for (const name of [
      'RESEND_API_KEY',
      'AUDIT_RFC3161_TSA_AUTH_TOKEN',
      'AUDIT_EXTERNAL_WITNESS_PUBLIC_KEY',
      'MQTT_URL',
      'ALERT_EMAIL_TO',
      'FRONTEND_URL',
      'ALLOWED_ORIGINS',
      'EMAIL_FROM',
      'TELEMETRY_INGEST_SECRET',
    ]) {
      assert.equal(env[name], '', `${name} must be left blank`);
      assert.ok(res.stdout.includes(name), `${name} must be named on stdout`);
    }
    assert.ok(res.stdout.includes('BACKUP_OFFSITE_S3_'), 'the off-site backup variables must be named on stdout');
  });
});

test('compose.prod.yml mounts the production signing-key directory into backend and worker (#978)', () => {
  const compose = fs.readFileSync(COMPOSE_PROD, 'utf8').replace(/\r\n/g, '\n');
  for (const service of ['backend', 'worker']) {
    const start = compose.search(new RegExp(`^  ${service}:`, 'm'));
    assert.notEqual(start, -1, `compose.prod.yml must define ${service}`);
    const rest = compose.slice(start + 1);
    const next = rest.search(/^  [a-z]/m);
    // The slice starts one char in so the service's own header is not the "next" one.
    const block = next === -1 ? rest : rest.slice(0, next);
    assert.ok(
      block.includes('./infra/audit/prod/secrets:/run/secrets:ro'),
      `${service} must mount ./infra/audit/prod/secrets read-only at /run/secrets`,
    );
  }
});
