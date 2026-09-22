import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #977: src/workers/worker.js is the worker process entrypoint and had NO test
// at all, on either half of the decision it makes. That matters because the
// decision is an asymmetry: this process treats ANY Redis failure as fatal
// (process.exit(1)), while server.js logs the same failure and keeps serving.
// A comment alone can be silently contradicted by the next edit, so the fatal
// posture is pinned here.
//
// worker.js runs startWorker() at module load and pulls its collaborators in
// with require()-based destructuring, so — same as tests/unit/import-worker.test.js
// and tests/unit/queue.config.test.js — fakes go straight into require.cache
// before a fresh require of worker.js, rather than through vi.mock().

const workerPath = require.resolve('../../src/workers/worker');
const importWorkerPath = require.resolve('../../src/workers/import-worker');
const queueConfigPath = require.resolve('../../src/config/queue');
const redisConfigPath = require.resolve('../../src/config/redis');
const loggerPath = require.resolve('../../src/utils/logger');
const dailyMerkleJobPath = require.resolve('../../src/workers/jobs/daily-merkle.job');
const dotenvPath = require.resolve('dotenv');

let fakeInitWorker;
let fakeTestRedisConnection;
let exitSpy;
let signalListenersBefore;

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

// Load worker.js fresh and let its module-level startWorker() settle.
async function loadWorker() {
  delete require.cache[workerPath];
  require(workerPath);
  // startWorker() is async and unawaited by the module; drain the microtask
  // queue plus one macrotask so its try/catch has run to completion.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('#977 src/workers/worker.js — the worker treats every Redis failure as fatal', () => {
  beforeEach(() => {
    signalListenersBefore = {
      SIGTERM: process.listeners('SIGTERM').slice(),
      SIGINT: process.listeners('SIGINT').slice(),
    };

    fakeInitWorker = vi.fn().mockResolvedValue({});
    fakeTestRedisConnection = vi.fn().mockResolvedValue(true);

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    stub(dotenvPath, { config: vi.fn() });
    stub(loggerPath, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
    stub(importWorkerPath, { initWorker: fakeInitWorker, closeWorker: vi.fn() });
    stub(queueConfigPath, { testConnection: vi.fn().mockResolvedValue(true) });
    stub(redisConfigPath, { testRedisConnection: fakeTestRedisConnection });
    stub(dailyMerkleJobPath, { scheduleNextRun: vi.fn() });
  });

  afterEach(() => {
    // worker.js registers SIGTERM/SIGINT handlers at load; drop the ones this
    // test added so repeated loads do not leak listeners into sibling tests.
    for (const signal of ['SIGTERM', 'SIGINT']) {
      for (const listener of process.listeners(signal)) {
        if (!signalListenersBefore[signal].includes(listener)) {
          process.removeListener(signal, listener);
        }
      }
    }
    for (const path of [workerPath, importWorkerPath, queueConfigPath, redisConfigPath, loggerPath, dailyMerkleJobPath, dotenvPath]) {
      delete require.cache[path];
    }
    vi.restoreAllMocks();
  });

  it('exits(1) when the Redis connectivity test fails, without initialising the worker', async () => {
    fakeTestRedisConnection.mockResolvedValue(false);

    await loadWorker();

    expect(exitSpy).toHaveBeenCalledWith(1);
    // A real process.exit(1) never returns, so initWorker is unreachable in
    // production. The spy DOES return, so assert the ordering that termination
    // guarantees rather than the absence a stub cannot reproduce.
    expect(exitSpy.mock.invocationCallOrder[0])
      .toBeLessThan(fakeInitWorker.mock.invocationCallOrder[0]);
  });

  it('exits(1) when initWorker rejects — the validateRedisOnly / initRedis policy failures land here', async () => {
    fakeInitWorker.mockRejectedValue(new Error('Redis configurado incorretamente: REDIS_PASSWORD não está definido no .env'));

    await loadWorker();

    expect(fakeTestRedisConnection).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not exit when Redis is healthy and initWorker resolves', async () => {
    await loadWorker();

    expect(fakeInitWorker).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // #1085: the encryption gate sits at the top of startWorker(), ahead of the
  // Redis connectivity test, so its refusal must terminate this process the
  // same way every other startup failure here does. Pinned because the call
  // site is one line and a later edit can drop it silently -- the worker would
  // then keep draining import jobs that write participant identity, with no
  // key to encrypt it under.
  describe('#1085 the encryption posture gate is fatal for this process in production', () => {
    let nodeEnvBefore;
    let encryptionKeyBefore;

    beforeEach(() => {
      nodeEnvBefore = process.env.NODE_ENV;
      encryptionKeyBefore = process.env.ENCRYPTION_KEY;
    });

    afterEach(() => {
      if (nodeEnvBefore === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvBefore;
      if (encryptionKeyBefore === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = encryptionKeyBefore;
    });

    it('exits(1) before testing Redis when ENCRYPTION_KEY is blank in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ENCRYPTION_KEY;

      await loadWorker();

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(fakeTestRedisConnection).not.toHaveBeenCalled();
      expect(fakeInitWorker).not.toHaveBeenCalled();
    });

    // Control case: same expectation before and after the gate existed, so a
    // red here is the fixture rather than the behaviour under test (#695).
    it('control: a blank ENCRYPTION_KEY outside production warns and lets the worker start', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.ENCRYPTION_KEY;

      await loadWorker();

      expect(fakeInitWorker).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('control: a configured ENCRYPTION_KEY lets the worker start in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ENCRYPTION_KEY = 'chave-de-teste';

      await loadWorker();

      expect(fakeInitWorker).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  // #1154: the audit-signing boot check sits beside #1085's encryption gate in
  // this same startup sequence, and is deliberately the OPPOSITE severity.
  // That asymmetry is the whole point of direction 1 -- it is what keeps the
  // change independent of #979's open fatal-vs-degrade decision -- and a
  // comment cannot stop the next edit from quietly escalating it, which is the
  // same reasoning #977 used to pin the fatal posture above.
  describe('#1154 the audit-signing boot check warns and never exits', () => {
    const crypto = require('crypto');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const env = require('../../src/config/env');
    const validateEnvPath = require.resolve('../../src/config/validateEnv');
    const auditProviderPath = require.resolve('../../src/services/audit-signing.provider');

    let nodeEnvBefore;
    let auditBefore;
    let tmpKeyFile;

    // The boot check is fire-and-forget (see worker.js), so the startup
    // sequence itself still settles inside loadWorker's two turns -- but the
    // WARNING lands a few turns later, after the key file read. Drain a fixed
    // bound, and let the control case assert nothing arrived within it.
    const SETTLE_TURNS = 50;

    async function bootAndSettleWarnings() {
      await loadWorker();
      for (let i = 0; i < SETTLE_TURNS; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    beforeEach(() => {
      nodeEnvBefore = process.env.NODE_ENV;
      auditBefore = {
        key: env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE,
        id: env.AUDIT_MERKLE_SIGN_KEY_ID,
        json: env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON,
        file: env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE,
      };
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = '';
      env.AUDIT_MERKLE_SIGN_KEY_ID = '';
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = '';
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE = '';
      // The encryption gate shares this sequence and exits(1) in production
      // without a key, which would mask everything below.
      process.env.ENCRYPTION_KEY = 'chave-de-teste';

      // config/validateEnv.js captures `logger` at ITS first load, which happens
      // inside the first loadWorker() of this file -- so without this it holds
      // the FIRST test's stub for the whole run, and every later assertion reads
      // an object nothing is writing to. worker.js is re-required per test and
      // does not have the problem; its dependency does. Evict both so they bind
      // to the stub this test installed.
      delete require.cache[validateEnvPath];
      delete require.cache[auditProviderPath];
    });

    afterEach(() => {
      if (nodeEnvBefore === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvBefore;
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = auditBefore.key;
      env.AUDIT_MERKLE_SIGN_KEY_ID = auditBefore.id;
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = auditBefore.json;
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE = auditBefore.file;
      delete require.cache[validateEnvPath];
      delete require.cache[auditProviderPath];
      if (tmpKeyFile) {
        fs.rmSync(tmpKeyFile, { force: true });
        tmpKeyFile = undefined;
      }
    });

    function auditWarnings() {
      // The logger stub is rebuilt per test by the outer beforeEach, so read it
      // back out of require.cache rather than holding a stale reference.
      return require.cache[loggerPath].exports.warn.mock.calls
        .map((args) => String(args[0]))
        .filter((message) => message.includes('[AUDIT]'));
    }

    function configureSoundKey() {
      const pair = crypto.generateKeyPairSync('ed25519');
      tmpKeyFile = path.join(os.tmpdir(), 'worker-entrypoint-1154-' + Date.now() + '-' + Math.random() + '.pem');
      fs.writeFileSync(tmpKeyFile, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), 'utf8');
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = tmpKeyFile;
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'key-worker-1';
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({
        'key-worker-1': pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      });
    }

    it('starts the worker anyway when the audit signing config is broken in production', async () => {
      process.env.NODE_ENV = 'production';

      await bootAndSettleWarnings();

      expect(exitSpy).not.toHaveBeenCalled();
      expect(fakeInitWorker).toHaveBeenCalled();
    });

    it('logs the broken config as an [AUDIT] warning at boot, not at 02:30 UTC', async () => {
      process.env.NODE_ENV = 'production';

      await bootAndSettleWarnings();

      const warnings = auditWarnings();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.join(' ')).toContain('AUDIT_MERKLE_SIGN_KEY_ID');
    });

    // Control: a sound config must produce NO audit warning, or the check is
    // noise and an operator learns to ignore it.
    it('control: says nothing when the signing config round-trips', async () => {
      process.env.NODE_ENV = 'production';
      configureSoundKey();

      await bootAndSettleWarnings();

      expect(auditWarnings()).toEqual([]);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(fakeInitWorker).toHaveBeenCalled();
    });
  });
});
