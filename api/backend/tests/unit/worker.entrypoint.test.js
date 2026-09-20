import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stage 2 consolidated validation checkpoint: static residual audit completed before CI.

const fs = require('fs');

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
let fakeGetRedisInstance;
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
    fakeGetRedisInstance = vi.fn(() => ({ ping: vi.fn().mockResolvedValue('PONG') }));

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    stub(dotenvPath, { config: vi.fn() });
    stub(loggerPath, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
    stub(importWorkerPath, { initWorker: fakeInitWorker, closeWorker: vi.fn() });
    stub(queueConfigPath, { testConnection: vi.fn().mockResolvedValue(true) });
    stub(redisConfigPath, { testRedisConnection: fakeTestRedisConnection, getRedisInstance: fakeGetRedisInstance });
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

  describe('item 8 worker scheduler and heartbeat residual branches', () => {
    it('keeps worker startup alive when the optional daily Merkle scheduler throws during registration', async () => {
      const logger = require(loggerPath);
      const scheduleNextRun = vi.fn(() => {
        throw new Error('scheduler unavailable');
      });
      stub(dailyMerkleJobPath, { scheduleNextRun });

      await loadWorker();

      expect(scheduleNextRun).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Job daily-merkle não registrado:',
        'scheduler unavailable'
      );
      expect(fakeInitWorker).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('skips scheduler registration cleanly when the optional module has no scheduleNextRun function', async () => {
      stub(dailyMerkleJobPath, {});

      await loadWorker();

      expect(fakeInitWorker).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('writes the heartbeat only after a live Redis PONG', async () => {
      const ping = vi.fn().mockResolvedValue('PONG');
      fakeGetRedisInstance.mockReturnValue({ ping });
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      let heartbeatCallback = null;
      const unref = vi.fn();
      vi.spyOn(global, 'setInterval').mockImplementation((callback) => {
        heartbeatCallback = callback;
        return { unref };
      });

      await loadWorker();
      expect(typeof heartbeatCallback).toBe('function');
      expect(unref).toHaveBeenCalledTimes(1);

      await heartbeatCallback();

      expect(ping).toHaveBeenCalledTimes(1);
      expect(writeSpy).toHaveBeenCalledWith('/tmp/worker-heartbeat', expect.any(String));
    });

    it('does not refresh the heartbeat when Redis responds with a non-PONG value', async () => {
      const ping = vi.fn().mockResolvedValue('LOADING');
      fakeGetRedisInstance.mockReturnValue({ ping });
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      let heartbeatCallback = null;
      vi.spyOn(global, 'setInterval').mockImplementation((callback) => {
        heartbeatCallback = callback;
        return { unref: vi.fn() };
      });

      await loadWorker();
      await heartbeatCallback();

      expect(ping).toHaveBeenCalledTimes(1);
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('logs a heartbeat ping failure without throwing or writing a stale heartbeat', async () => {
      const logger = require(loggerPath);
      const ping = vi.fn().mockRejectedValue(new Error('redis heartbeat down'));
      fakeGetRedisInstance.mockReturnValue({ ping });
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      let heartbeatCallback = null;
      vi.spyOn(global, 'setInterval').mockImplementation((callback) => {
        heartbeatCallback = callback;
        return { unref: vi.fn() };
      });

      await loadWorker();
      await expect(heartbeatCallback()).resolves.toBeUndefined();

      expect(writeSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        '[WARN] Falha ao gravar heartbeat do worker:',
        'redis heartbeat down'
      );
    });
  });
});
