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
});
