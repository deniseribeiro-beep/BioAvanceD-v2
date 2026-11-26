import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #977/#979: src/workers/worker.js is the worker process entrypoint, and the
// Redis posture it takes has two halves: a configuration fault (validateRedisOnly
// or the client failing before the connectivity loop, initRedis inside
// initWorker) or a permanent client error (WRONGPASS, NOAUTH, WRONGTYPE, a
// protocol error) is fatal (process.exit(1)), while a Redis that is merely
// down at boot is retried with backoff, the heartbeat staying stale so the
// container healthcheck reports it. A comment alone can be silently
// contradicted by the next edit, so both halves are pinned here.
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
const SRC_ROOT = require('path').resolve(__dirname, '../../src') + require('path').sep;
// config/env.js is exempt from that eviction on purpose. It is a plain literal
// module.exports object that tests deliberately WRITE to (env.FOO = ...) instead
// of going through process.env, so a fresh copy per test would silently discard
// every assignment the test just made -- the code under test would then read
// defaults and the assertion would fail for a reason nothing in the test names.
const envModulePath = require.resolve('../../src/config/env');

let fakeInitWorker;
let fakeTestRedisConnection;
let fakeRedisClient;
let fakeGetRedisInstance;
let redisErrorHandlers;
let envBefore;
// #979: worker.js runs the real validateRedisOnly() before the connectivity
// loop, which reads these straight from process.env.
const ENV_KEYS = ['NODE_ENV', 'ENCRYPTION_KEY', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_URL', 'REDIS_PASSWORD'];
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

describe('#979 src/workers/worker.js — Redis connectivity loss is retried, configuration faults stay fatal', () => {
  beforeEach(() => {
    // #1160: uncaughtException/unhandledRejection are in this set too, not just
    // the signals. worker.js registers all four at load, afterEach dropped only
    // the signals, and the #1040 handlers therefore accumulated one pair per
    // loadWorker() across the file. Any late failure -- from a boot still in
    // flight after its own test ended -- then reached a stale handler and called
    // the REAL process.exit(1), which vitest reports as "Worker exited
    // unexpectedly" with no pass or fail counts at all. The cause is invisible
    // from the failure.
    signalListenersBefore = {
      SIGTERM: process.listeners('SIGTERM').slice(),
      SIGINT: process.listeners('SIGINT').slice(),
      uncaughtException: process.listeners('uncaughtException').slice(),
      unhandledRejection: process.listeners('unhandledRejection').slice(),
    };

    fakeInitWorker = vi.fn().mockResolvedValue({});
    fakeTestRedisConnection = vi.fn().mockResolvedValue(true);
    envBefore = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
    delete process.env.REDIS_URL;
    delete process.env.REDIS_PASSWORD;

    redisErrorHandlers = [];
    fakeRedisClient = {
      status: 'ready',
      connect: vi.fn().mockResolvedValue(undefined),
      ping: vi.fn().mockResolvedValue('PONG'),
      on: vi.fn((event, handler) => { if (event === 'error') redisErrorHandlers.push(handler); }),
      removeListener: vi.fn((event, handler) => {
        if (event === 'error') redisErrorHandlers = redisErrorHandlers.filter((h) => h !== handler);
      }),
    };
    fakeGetRedisInstance = vi.fn(() => fakeRedisClient);

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    stub(dotenvPath, { config: vi.fn() });
    stub(loggerPath, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
    stub(importWorkerPath, { initWorker: fakeInitWorker, closeWorker: vi.fn() });
    stub(queueConfigPath, { testConnection: vi.fn().mockResolvedValue(true) });
    stub(redisConfigPath, { testRedisConnection: fakeTestRedisConnection, getRedisInstance: fakeGetRedisInstance });
    stub(dailyMerkleJobPath, { scheduleNextRun: vi.fn() });
  });

  afterEach(() => {
    // worker.js registers SIGTERM/SIGINT and, since #1040, uncaughtException and
    // unhandledRejection, all at load; drop the ones this test added so repeated
    // loads do not leak listeners into sibling tests.
    for (const event of ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection']) {
      for (const listener of process.listeners(event)) {
        if (!signalListenersBefore[event].includes(listener)) {
          process.removeListener(event, listener);
        }
      }
    }
    // #1160: evict by PREFIX, not by hand-kept list. The list held only the
    // modules worker.js requires DIRECTLY, so anything reached through one of
    // them -- config/validateEnv is the live example -- was loaded once, bound
    // whatever was in require.cache at that moment (the FIRST test's stubs) and
    // kept it for the rest of the file. An assertion on a later stub then reads
    // an object nothing writes to, and reports zero as though the code under
    // test never ran. A prefix rule cannot fall behind the dependency graph the
    // way a list does.
    for (const path of Object.keys(require.cache)) {
      if (path === envModulePath) continue;
      if (path.startsWith(SRC_ROOT) || path === dotenvPath) {
        delete require.cache[path];
      }
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const key of ENV_KEYS) {
      if (envBefore[key] === undefined) delete process.env[key];
      else process.env[key] = envBefore[key];
    }
  });

  // #979: the backoff waits run on faked setTimeout; setImmediate stays real so
  // loadWorker's drain and the one below still turn the event loop.
  async function drain() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('keeps running and retries while the Redis connectivity test fails, without initialising the worker', async () => {
    fakeTestRedisConnection.mockResolvedValue(false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await loadWorker();
    expect(fakeTestRedisConnection).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await drain();
    expect(fakeTestRedisConnection).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    await drain();
    expect(fakeTestRedisConnection).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(4000);
    await drain();
    expect(fakeTestRedisConnection).toHaveBeenCalledTimes(4);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(fakeInitWorker).not.toHaveBeenCalled();
    const warnings = require.cache[loggerPath].exports.warn.mock.calls.map((args) => String(args[0]));
    expect(warnings.some((message) => message.includes('Redis indisponível'))).toBe(true);
  });

  it('initialises the worker once Redis comes back, without exiting', async () => {
    fakeTestRedisConnection.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await loadWorker();
    await vi.advanceTimersByTimeAsync(1000);
    await drain();

    expect(fakeInitWorker).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits(1) on a Redis configuration fault without testing connectivity', async () => {
    fakeGetRedisInstance.mockImplementation(() => {
      throw new Error('REDIS_HOST ou REDIS_URL não está definido no .env');
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await loadWorker();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fakeTestRedisConnection).not.toHaveBeenCalled();
    expect(fakeInitWorker).not.toHaveBeenCalled();
  });

  it('reconnects a client that ioredis left ended before the next attempt', async () => {
    fakeRedisClient.status = 'end';
    fakeTestRedisConnection.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await loadWorker();
    await vi.advanceTimersByTimeAsync(1000);
    await drain();

    expect(fakeRedisClient.connect).toHaveBeenCalledTimes(1);
  });

  // #979: a fault validateRedisOnly() detects must not wait behind the
  // connectivity loop -- a missing production password for a remote host
  // usually also keeps Redis from answering.
  it('exits(1) on a Redis configuration fault while Redis is down, without retrying', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENCRYPTION_KEY = 'chave-de-teste';
    process.env.REDIS_HOST = 'redis.example.internal';
    fakeTestRedisConnection.mockResolvedValue(false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await loadWorker();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fakeTestRedisConnection).not.toHaveBeenCalled();
    expect(fakeInitWorker).not.toHaveBeenCalled();
  });

  it('exits(1) on an invalid REDIS_URL without testing connectivity', async () => {
    process.env.REDIS_URL = 'not a url';
    fakeTestRedisConnection.mockResolvedValue(false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await loadWorker();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fakeTestRedisConnection).not.toHaveBeenCalled();
    expect(fakeInitWorker).not.toHaveBeenCalled();
  });

  function failWithClientError(message, code) {
    fakeTestRedisConnection.mockImplementation(async () => {
      const err = new Error(message);
      if (code) err.code = code;
      for (const handler of redisErrorHandlers) handler(err);
      return false;
    });
  }

  it('exits(1) on a WRONGPASS client error instead of retrying', async () => {
    failWithClientError('WRONGPASS invalid username-password pair or user is disabled.');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await loadWorker();
    await vi.advanceTimersByTimeAsync(1000);
    await drain();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fakeTestRedisConnection).toHaveBeenCalledTimes(1);
    expect(fakeInitWorker).not.toHaveBeenCalled();
  });

  // #979: a server that wants a password ioredis did not send answers PING
  // with NOAUTH as a command reply, which never reaches the 'error' listener.
  it('exits(1) on a NOAUTH reply to PING instead of retrying', async () => {
    fakeTestRedisConnection.mockResolvedValue(false);
    fakeRedisClient.ping.mockRejectedValue(new Error('NOAUTH Authentication required.'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await loadWorker();
    await vi.advanceTimersByTimeAsync(1000);
    await drain();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fakeTestRedisConnection).toHaveBeenCalledTimes(1);
    expect(fakeInitWorker).not.toHaveBeenCalled();
  });

  it('keeps retrying on an ECONNREFUSED client error', async () => {
    failWithClientError('connect ECONNREFUSED 127.0.0.1:6379', 'ECONNREFUSED');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    await loadWorker();
    await vi.advanceTimersByTimeAsync(1000);
    await drain();

    expect(fakeTestRedisConnection).toHaveBeenCalledTimes(2);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(fakeInitWorker).not.toHaveBeenCalled();
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

  // RF022 AC4/AC9, RNF014 C7: initWorker refuses on a missing, blocked or
  // other-release ReadinessReport; worker.js must then exit 1 rather than
  // keep the process up with no queue consumer behind its heartbeat.
  describe('#1551 src/workers/worker.js — Foundation readiness refusal', () => {
    it('exits(1) when initWorker refuses on the Foundation readiness gate', async () => {
      const { FoundationNotReadyError } = require('../../src/foundation/readiness');
      fakeInitWorker.mockRejectedValue(new FoundationNotReadyError('Nenhum ReadinessReport para o ambiente test'));

      await loadWorker();

      expect(fakeInitWorker).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
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
  // change independent of how this process treats Redis (#979, pinned above)
  // -- and a comment cannot stop the next edit from quietly escalating it,
  // which is the same reasoning #977 used to pin the fatal posture above.
  describe('#1154 the audit-signing boot check warns and never exits', () => {
    const crypto = require('crypto');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const env = require('../../src/config/env');

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
    });

    afterEach(() => {
      if (nodeEnvBefore === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvBefore;
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = auditBefore.key;
      env.AUDIT_MERKLE_SIGN_KEY_ID = auditBefore.id;
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = auditBefore.json;
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE = auditBefore.file;
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
