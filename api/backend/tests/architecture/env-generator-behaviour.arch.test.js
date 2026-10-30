// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect.
//
// This file pins generate-env-docker-secrets.sh's own behaviour: the
// overwrite guard, the audit-signing key's mint-once/reuse lifecycle, the
// registry it writes for that key, the container path it hands the backend,
// and what --upgrade may and may not change on an existing file. It is a
// sibling of env-generator-coverage.arch.test.js, which instead pins that a
// fresh generate covers (and does not exceed) the variables
// .env.docker.example declares -- that file's scope is left alone here.
//
// Every run in this file operates on a COPY of both the generator and
// .env.docker.example inside a fresh mkdtempSync directory, never on the
// repo's own copies. The generator derives its key directory from
// BASH_SOURCE[0], so running the copy also sandboxes the key: the real
// infra/audit/secrets/merkle_signing_key.pem this repo already relies on to
// verify previously-signed audit roots is never read, minted over, or
// deleted by anything in this file.
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

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GENERATOR = path.resolve(REPO_ROOT, 'generate-env-docker-secrets.sh');
const EXAMPLE = path.resolve(REPO_ROOT, '.env.docker.example');

// #1190, #1059's class: in backend-unit-runner REPO_ROOT clamps at `/`.
// Keyed on the repo tree being present, not on the generator, so a deleted
// or renamed generator still fails natively rather than skipping.
const IN_REPO_TREE = fs.existsSync(path.join(REPO_ROOT, 'api', 'backend', 'package.json'));
const test = IN_REPO_TREE
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: '#1190: repo tree not reachable (expected inside backend-unit-runner)' }, fn);

const CONTAINER_KEY_PATH = 'AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE=/run/secrets/merkle_signing_key.pem';

// Copies the generator and the example into a fresh temp directory so the
// script's own BASH_SOURCE[0]-derived SCRIPT_DIR -- and therefore its key
// directory -- lands entirely inside the sandbox, never in this repo.
function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-generator-behaviour-'));
  const script = path.join(dir, 'generate-env-docker-secrets.sh');
  const example = path.join(dir, '.env.docker.example');
  fs.copyFileSync(GENERATOR, script);
  fs.copyFileSync(EXAMPLE, example);
  return {
    dir,
    script,
    example,
    keyFile: path.join(dir, 'infra', 'audit', 'secrets', 'merkle_signing_key.pem'),
  };
}

// WSL's `bash` (WindowsApps) rewrites a bare `C:\...` argv into `C:Users...`
// and fails; Git Bash accepts `C:/...`. Prefer a path the active bash can open.
function toBashPath(winPath) {
  if (process.platform !== 'win32') return winPath;
  const resolved = path.resolve(winPath);
  const uname = spawnSync('bash', ['-c', 'uname -s'], { encoding: 'utf8' });
  const kind = String(uname.stdout || '');
  if (/MINGW|MSYS/i.test(kind)) {
    return resolved.replace(/\\/g, '/');
  }
  const m = /^([A-Za-z]):(.*)$/.exec(resolved);
  if (m) return `/mnt/${m[1].toLowerCase()}${m[2].replace(/\\/g, '/')}`;
  return resolved.replace(/\\/g, '/');
}

function run(script, args, cwd) {
  // bash explicitly rather than relying on the executable bit, which does
  // not survive every checkout on every platform.
  // cwd stays a host path (Node's spawnSync); argv paths are rewritten for
  // WSL/Git Bash so bash can open the sandboxed script (#1418 / Windows).
  // Flags (--upgrade) must stay literal: path.resolve would turn them into
  // cwd/--upgrade under win32.
  const bashArgs = args.map((arg) => (arg.startsWith('-') ? arg : toBashPath(arg)));
  return spawnSync('bash', [toBashPath(script), ...bashArgs], {
    cwd,
    encoding: 'utf8',
  });
}

// WSL bash can briefly keep a handle on /mnt/c/... sandbox dirs after exit;
// force-rm then would raise EPERM/EBUSY and fail an otherwise-green test.
function removeSandbox(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    if (err && err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
  }
}

function findLine(content, prefix) {
  return content.split(/\r?\n/).find((line) => line.startsWith(prefix));
}

function findLines(content, prefix) {
  return content.split(/\r?\n/).filter((line) => line.startsWith(prefix));
}

test('running without --upgrade against an existing output refuses, and leaves the file untouched', () => {
  const { dir, script } = makeSandbox();
  try {
    const outFile = path.join(dir, '.env.docker');

    const first = run(script, [outFile], dir);
    assert.equal(first.status, 0, `fresh generate must succeed: ${first.stderr}`);
    const originalBytes = fs.readFileSync(outFile);

    const second = run(script, [outFile], dir);
    assert.notEqual(second.status, 0, 'a second run without --upgrade must exit non-zero');
    assert.match(second.stderr, /já existe/, 'stderr must mention the file already exists');
    assert.match(second.stderr, /--upgrade/, 'stderr must point at --upgrade as the way in');
    assert.deepEqual(
      fs.readFileSync(outFile),
      originalBytes,
      'the refused run must not touch the existing file\'s bytes'
    );
  } finally {
    removeSandbox(dir);
  }
});

test('--upgrade against a nonexistent output file refuses, and creates nothing', () => {
  const { dir, script } = makeSandbox();
  try {
    const outFile = path.join(dir, '.env.docker');

    const result = run(script, ['--upgrade', outFile], dir);
    assert.notEqual(result.status, 0, '--upgrade with no existing file must exit non-zero');
    assert.equal(fs.existsSync(outFile), false, '--upgrade must not create the output file when none existed');
  } finally {
    removeSandbox(dir);
  }
});

test('a fresh generate mints the audit signing key, a second fresh generate reuses it, the registry matches it, the container path is verbatim, and credentials are random per run', () => {
  const { dir, script, keyFile } = makeSandbox();
  try {
    const outFile1 = path.join(dir, '.env.docker');
    const run1 = run(script, [outFile1], dir);
    assert.equal(run1.status, 0, `first fresh generate must succeed: ${run1.stderr}`);
    assert.ok(fs.existsSync(keyFile), 'a fresh generate must mint the signing key when absent');

    const keyBytes1 = fs.readFileSync(keyFile);
    const content1 = fs.readFileSync(outFile1, 'utf8');

    const outFile2 = path.join(dir, '.env.docker.second');
    const run2 = run(script, [outFile2], dir);
    assert.equal(run2.status, 0, `second fresh generate must succeed: ${run2.stderr}`);
    assert.match(run2.stdout, /Reutilizando/, 'a second fresh generate must report reusing the existing key');

    const keyBytes2 = fs.readFileSync(keyFile);
    assert.deepEqual(keyBytes2, keyBytes1, 'the key file bytes must be unchanged by the second fresh generate');

    // Registry matches the key (derived independently from the key file, not copied from the script's own output).
    const publicKeyPem = crypto.createPublicKey(keyBytes1).export({ type: 'spki', format: 'pem' });
    const registryLine = findLine(content1, 'AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON=');
    assert.ok(registryLine, 'AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON must be present');
    const registry = JSON.parse(registryLine.slice('AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON='.length));
    assert.deepEqual(Object.keys(registry), ['audit-ed25519-dev-1']);
    assert.equal(
      registry['audit-ed25519-dev-1'].trim(),
      publicKeyPem.trim(),
      'the registry PEM must equal the SPKI public half of the minted key'
    );

    // Container path verbatim, fresh-generate half. This is the MSYS
    // regression named in the script's own comment: a Unix absolute path
    // rewritten on the way to a native program would turn this into
    // something like C:/Program Files/Git/run/secrets/...
    const fileLine1 = findLine(content1, 'AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE=');
    assert.equal(fileLine1, CONTAINER_KEY_PATH);

    // Credentials are random per run, not constant.
    const content2 = fs.readFileSync(outFile2, 'utf8');
    const jwt1 = findLine(content1, 'JWT_SECRET=');
    const jwt2 = findLine(content2, 'JWT_SECRET=');
    assert.ok(jwt1 && jwt2, 'both runs must write a JWT_SECRET line');
    assert.notEqual(jwt1, jwt2, 'JWT_SECRET must differ between independent fresh generates');

    // #1418: Git Bash mingw openssl ends base64 with CRLF; tok() must strip `\r`
    // so MONGO_URI / passwords never embed a carriage return.
    assert.ok(!content1.includes('\r'), 'no line of a fresh generate may contain a carriage return (#1418)');
    assert.match(
      jwt1.slice('JWT_SECRET='.length),
      /^[A-Za-z0-9_-]+$/,
      'JWT_SECRET must be base64url with no CR (#1418)',
    );
  } finally {
    removeSandbox(dir);
  }
});

test('fresh generate strips CR when openssl rand -base64 ends with CRLF (#1418)', () => {
  const { dir, script } = makeSandbox();
  try {
    // Resolve the real binary once so the fake never re-enters itself via PATH
    // (`command openssl` still prefers the shim ahead on PATH).
    const realOpenssl = String(
      spawnSync('bash', ['-c', 'command -v openssl'], { encoding: 'utf8' }).stdout || '',
    ).trim();
    assert.ok(realOpenssl, 'host must provide openssl for the CRLF shim');

    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    // Pretend to be mingw openssl: emit CRLF after every rand -base64 payload.
    const fakeOpenssl = path.join(bin, 'openssl');
    fs.writeFileSync(
      fakeOpenssl,
      `#!/usr/bin/env bash
set -euo pipefail
REAL='${realOpenssl.replace(/'/g, `'\\''`)}'
if [[ "\${1:-}" == "rand" && "\${2:-}" == "-base64" ]]; then
  "$REAL" rand -base64 "\${3:?}" | tr -d '\\r\\n' | awk '{printf "%s\\r\\n", $0}'
  exit 0
fi
exec "$REAL" "\$@"
`,
      { mode: 0o755 },
    );
    if (process.platform === 'win32') {
      // WSL/Git Bash need +x via chmod; Node mode bits alone are not enough.
      const chmod = spawnSync('bash', ['-c', `chmod +x '${toBashPath(fakeOpenssl)}'`], {
        encoding: 'utf8',
      });
      assert.equal(chmod.status, 0, `chmod +x fake openssl must succeed: ${chmod.stderr}`);
    }

    const outFile = path.join(dir, '.env.docker');
    // Prefer the fake openssl via bash PATH (colon-separated inside WSL/Git Bash).
    const res = spawnSync(
      'bash',
      ['-c', `export PATH='${toBashPath(bin)}':"$PATH"; bash '${toBashPath(script)}' '${toBashPath(outFile)}'`],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(res.status, 0, `fresh generate must succeed under CRLF openssl: ${res.stderr}\n${res.stdout}`);

    const content = fs.readFileSync(outFile, 'utf8');
    assert.ok(!content.includes('\r'), 'output must contain no carriage return even when openssl prints CRLF (#1418)');
    const mongoPassword = findLine(content, 'MONGO_ROOT_PASSWORD=');
    assert.ok(mongoPassword, 'MONGO_ROOT_PASSWORD must be present');
    assert.match(
      mongoPassword.slice('MONGO_ROOT_PASSWORD='.length),
      /^[A-Za-z0-9_-]+$/,
      'MONGO_ROOT_PASSWORD must not carry a trailing CR (#1418)',
    );
  } finally {
    removeSandbox(dir);
  }
});

// #1162: --upgrade fills a missing relaxation BLANK too, and -- like every
// other existing line -- leaves an operator's hand-set value alone.
test('--upgrade restores a missing rate-limit relaxation blank, and keeps a hand-set true (#1162)', () => {
  const { dir, script } = makeSandbox();
  try {
    const outFile = path.join(dir, '.env.docker');
    const fresh = run(script, [outFile], dir);
    assert.equal(fresh.status, 0, `fresh generate must succeed: ${fresh.stderr}`);

    const mutated = fs.readFileSync(outFile, 'utf8')
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('AUTH_RATE_LIMIT_RELAXED='))
      .map((line) => (line.startsWith('CONSENT_RATE_LIMIT_RELAXED=') ? 'CONSENT_RATE_LIMIT_RELAXED=true' : line))
      .join('\n');
    fs.writeFileSync(outFile, mutated);

    const upgrade = run(script, ['--upgrade', outFile], dir);
    assert.equal(upgrade.status, 0, `--upgrade must succeed: ${upgrade.stderr}`);

    const content = fs.readFileSync(outFile, 'utf8');
    assert.deepEqual(findLines(content, 'AUTH_RATE_LIMIT_RELAXED='), ['AUTH_RATE_LIMIT_RELAXED=']);
    assert.deepEqual(findLines(content, 'CONSENT_RATE_LIMIT_RELAXED='), ['CONSENT_RATE_LIMIT_RELAXED=true']);
  } finally {
    removeSandbox(dir);
  }
});

test('--upgrade preserves existing credentials, restores deleted example-sourced lines, fixes the AUDIT_MERKLE_SIGN_* registry, writes a matching backup, and a second --upgrade is a no-op', () => {
  const { dir, script, example, keyFile } = makeSandbox();
  try {
    const outFile = path.join(dir, '.env.docker');
    const fresh = run(script, [outFile], dir);
    assert.equal(fresh.status, 0, `fresh generate must succeed: ${fresh.stderr}`);

    const freshContent = fs.readFileSync(outFile, 'utf8');
    const credentialNames = [
      'MONGO_ROOT_PASSWORD',
      'JWT_SECRET',
      'ENCRYPTION_KEY',
      'CONSENT_SECRET',
      'USER_ANON_SALT',
    ];
    const credentialLinesBefore = Object.fromEntries(
      credentialNames.map((name) => [name, findLine(freshContent, `${name}=`)])
    );
    for (const name of credentialNames) {
      assert.ok(credentialLinesBefore[name], `fresh generate must write ${name}`);
    }

    // Delete two names the example declares (REDIS_URL, FRONTEND_URL), and
    // blank the registry the way .env.docker.example ships it, so --upgrade
    // has to both restore missing lines and repair a wrong-but-present one.
    const exampleContent = fs.readFileSync(example, 'utf8');
    const expectedRedisLine = findLine(exampleContent, 'REDIS_URL=');
    const expectedFrontendLine = findLine(exampleContent, 'FRONTEND_URL=');
    assert.ok(expectedRedisLine && expectedFrontendLine, 'the example must declare both names this test deletes');

    const mutatedLines = freshContent
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('REDIS_URL=') && !line.startsWith('FRONTEND_URL='))
      .map((line) => (line.startsWith('AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON=') ? 'AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON={}' : line));
    const preUpgradeContent = mutatedLines.join('\n');
    fs.writeFileSync(outFile, preUpgradeContent);

    const upgrade1 = run(script, ['--upgrade', outFile], dir);
    assert.equal(upgrade1.status, 0, `--upgrade must succeed: ${upgrade1.stderr}`);
    assert.ok(
      upgrade1.stdout.includes('(2 variável(is) adicionada(s))'),
      `expected 2 variables added, got stdout: ${upgrade1.stdout}`
    );

    const backupName = fs
      .readdirSync(dir)
      .find((name) => name.startsWith(`${path.basename(outFile)}.bak-`));
    assert.ok(backupName, 'an --upgrade must leave a .bak-<timestamp> file behind');
    const backupContent = fs.readFileSync(path.join(dir, backupName), 'utf8');
    assert.equal(backupContent, preUpgradeContent, "the backup's content must equal the pre-upgrade file");

    const upgradedContent = fs.readFileSync(outFile, 'utf8');

    for (const name of credentialNames) {
      assert.equal(
        findLine(upgradedContent, `${name}=`),
        credentialLinesBefore[name],
        `${name} must be byte-identical after --upgrade`
      );
    }

    assert.equal(findLine(upgradedContent, 'REDIS_URL='), expectedRedisLine, 'REDIS_URL must be restored from the example');
    assert.equal(
      findLine(upgradedContent, 'FRONTEND_URL='),
      expectedFrontendLine,
      'FRONTEND_URL must be restored from the example'
    );

    for (const prefix of [
      'AUDIT_MERKLE_SIGN_KEY_ID=',
      'AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE=',
      'AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON=',
    ]) {
      assert.equal(findLines(upgradedContent, prefix).length, 1, `${prefix} must appear exactly once`);
    }

    // Container path verbatim, --upgrade half.
    assert.equal(findLine(upgradedContent, 'AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE='), CONTAINER_KEY_PATH);

    const publicKeyPem = crypto
      .createPublicKey(fs.readFileSync(keyFile))
      .export({ type: 'spki', format: 'pem' });
    const registryLine = findLine(upgradedContent, 'AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON=');
    const registry = JSON.parse(registryLine.slice('AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON='.length));
    assert.equal(
      registry['audit-ed25519-dev-1'].trim(),
      publicKeyPem.trim(),
      '--upgrade must SET the registry to match the key file, not leave the example\'s blanked {}'
    );

    // Idempotency: a second --upgrade adds nothing and changes nothing.
    const upgrade2 = run(script, ['--upgrade', outFile], dir);
    assert.equal(upgrade2.status, 0, `second --upgrade must succeed: ${upgrade2.stderr}`);
    assert.ok(
      upgrade2.stdout.includes('(0 variável(is) adicionada(s))'),
      `expected 0 variables added on the second --upgrade, got stdout: ${upgrade2.stdout}`
    );
    assert.equal(
      fs.readFileSync(outFile, 'utf8'),
      upgradedContent,
      'a second --upgrade must leave the file content unchanged'
    );
  } finally {
    removeSandbox(dir);
  }
});
