// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect.
//
// #1177: infra/witness/entrypoint.sh guarded on the /run/secrets literal while
// its node writer honoured WITNESS_PRIVATE_KEY_PEM_FILE, so any non-default
// path minted a fresh witness key on every container start and orphaned the
// key earlier tree heads were co-signed with. Both compose files happen to set
// the default path, which is why nothing noticed.
//
// The entrypoint is run on the HOST here, not in a container: with the key path
// pointed into a temp dir it touches nothing else (its only mkdir is the key's
// own directory), and `exec "$@"` hands off to a harmless `node -e` stand-in
// for the witness server. Skips on CI by design (#1190): CI runs
// test:architecture inside backend-unit-runner, whose image holds only
// api/backend, so infra/ is absent. It runs natively.

const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ENTRYPOINT = path.resolve(REPO_ROOT, 'infra/witness/entrypoint.sh');

// #1190, #1059's class: in backend-unit-runner REPO_ROOT clamps at `/`.
// Keyed on the repo tree, not the entrypoint, so a moved entrypoint still
// fails natively rather than skipping.
const IN_REPO_TREE = fs.existsSync(path.join(REPO_ROOT, 'api', 'backend', 'package.json'));
const test = IN_REPO_TREE
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: '#1190: repo tree not reachable (expected inside backend-unit-runner)' }, fn);

function start(keyPath) {
  // sh explicitly rather than relying on the executable bit. Forward slashes
  // so the same path means the same file to sh and to node on Windows too.
  return spawnSync('sh', [ENTRYPOINT, 'node', '-e', 'process.stdout.write("server-started")'], {
    encoding: 'utf8',
    env: { ...process.env, WITNESS_PRIVATE_KEY_PEM_FILE: keyPath.split(path.sep).join('/') },
  });
}

test('the witness key at a non-default path is minted once and reused across starts (#1177)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-entrypoint-'));
  try {
    // A nested, not-yet-existing directory: the entrypoint must create it.
    const keyPath = path.join(dir, 'nested', 'witness_key.pem');

    const first = start(keyPath);
    assert.equal(first.status, 0, `first start must succeed: ${first.stderr}`);
    assert.equal(first.stdout, 'server-started', 'the entrypoint must exec its arguments');
    assert.ok(fs.existsSync(keyPath), 'the first start must mint the key at WITNESS_PRIVATE_KEY_PEM_FILE');
    const minted = fs.readFileSync(keyPath);
    assert.equal(crypto.createPrivateKey(minted).asymmetricKeyType, 'ed25519');

    const second = start(keyPath);
    assert.equal(second.status, 0, `second start must succeed: ${second.stderr}`);
    assert.deepEqual(fs.readFileSync(keyPath), minted, 'a restart must reuse the key, not mint over it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
