import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #1040: server.js, src/workers/worker.js, src/workers/import-worker.js and
// src/workers/neo4jProjection.worker.js each register process-level
// 'unhandledRejection' / 'uncaughtException' handlers that are observability
// ONLY -- they log with attribution and then still terminate the process,
// exactly as it already terminated before this fix (just anonymously). This
// file pins that shape directly: it captures the listener functions each
// module installs on the real `process` object, invokes them with a spied
// logger and a spied process.exit (so the test runner itself never actually
// exits), and asserts both that the log happened AND that termination was
// still requested -- proving the handler does not swallow.
//
// It also pins the cross-process-sharing guard: src/workers/worker.js
// requires src/workers/import-worker.js directly, so in the real worker
// process both files' module-level registration code runs. A guard flag on
// `process` itself (not on either module) is what keeps that a single
// registered pair instead of two -- proven below both per-file (requiring
// the same file twice) and cross-file (requiring two different files back
// to back).
//
// Same require.cache-injection convention as tests/unit/import-worker.test.js
// and tests/unit/worker.entrypoint.test.js for src/workers/worker.js, since
// that file runs startWorker() (real Redis I/O) at module load and vi.mock()
// does not reliably intercept its require()-based destructured imports.

const GUARD_KEY = '__BIOAVANCE_1040_PROCESS_HANDLERS_INSTALLED__';

const serverPath = require.resolve('../../server');
const neo4jWorkerPath = require.resolve('../../src/workers/neo4jProjection.worker');
const importWorkerPath = require.resolve('../../src/workers/import-worker');
const workerPath = require.resolve('../../src/workers/worker');
const loggerPath = require.resolve('../../src/utils/logger');
const queueConfigPath = require.resolve('../../src/config/queue');
const redisConfigPath = require.resolve('../../src/config/redis');
const dailyMerkleJobPath = require.resolve('../../src/workers/jobs/daily-merkle.job');
const dotenvPath = require.resolve('dotenv');

/**
 * Runs `fn` with the #1040 guard flag cleared beforehand and fully restored
 * (flag value + any 'unhandledRejection'/'uncaughtException' listeners added
 * during `fn`) afterwards, so tests never leak a real handler into the
 * vitest process or into each other.
 */
async function withCleanGuard(fn) {
  const hadGuard = Object.prototype.hasOwnProperty.call(process, GUARD_KEY);
  const guardBefore = process[GUARD_KEY];
  delete process[GUARD_KEY];

  const before = {
    unhandledRejection: process.listeners('unhandledRejection').slice(),
    uncaughtException: process.listeners('uncaughtException').slice(),
  };

  try {
    return await fn();
  } finally {
    for (const event of ['unhandledRejection', 'uncaughtException']) {
      for (const listener of process.listeners(event)) {
        if (!before[event].includes(listener)) {
          process.removeListener(event, listener);
        }
      }
    }
    delete process[GUARD_KEY];
    if (hadGuard) {
      process[GUARD_KEY] = guardBefore;
    }
  }
}

function addedListeners(event, before) {
  return process.listeners(event).filter((listener) => !before.includes(listener));
}

describe('#1040 process-level fatal-error handlers (observability-only, still terminate)', () => {
  describe('src/workers/neo4jProjection.worker.js', () => {
    let logger;

    beforeEach(() => {
      logger = require(loggerPath);
      vi.spyOn(logger, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      delete require.cache[neo4jWorkerPath];
    });

    it('logs through the module logger and still calls process.exit(1) for both events', async () => {
      await withCleanGuard(async () => {
        const beforeUR = process.listeners('unhandledRejection').slice();
        const beforeUC = process.listeners('uncaughtException').slice();

        delete require.cache[neo4jWorkerPath];
        require(neo4jWorkerPath);

        const urListeners = addedListeners('unhandledRejection', beforeUR);
        const ucListeners = addedListeners('uncaughtException', beforeUC);
        expect(urListeners.length).toBe(1);
        expect(ucListeners.length).toBe(1);

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

        urListeners[0](new Error('outbox projection boom'));
        expect(logger.error).toHaveBeenCalled();
        expect(String(logger.error.mock.calls[0][0])).toMatch(/#1040/);
        expect(exitSpy).toHaveBeenCalledWith(1);

        exitSpy.mockClear();
        logger.error.mockClear();

        ucListeners[0](new Error('outbox sync boom'));
        expect(logger.error).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
      });
    });

    it('does not add a second pair of listeners when required again in the same process', async () => {
      await withCleanGuard(async () => {
        delete require.cache[neo4jWorkerPath];
        require(neo4jWorkerPath);
        const firstCount = process.listeners('unhandledRejection').length;

        delete require.cache[neo4jWorkerPath];
        require(neo4jWorkerPath);
        const secondCount = process.listeners('unhandledRejection').length;

        expect(secondCount).toBe(firstCount);
      });
    });
  });

  describe('src/workers/import-worker.js', () => {
    let logger;

    beforeEach(() => {
      logger = require(loggerPath);
      vi.spyOn(logger, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      delete require.cache[importWorkerPath];
    });

    it('logs through the module logger and still calls process.exit(1) for both events', async () => {
      await withCleanGuard(async () => {
        const beforeUR = process.listeners('unhandledRejection').slice();
        const beforeUC = process.listeners('uncaughtException').slice();

        delete require.cache[importWorkerPath];
        require(importWorkerPath);

        const urListeners = addedListeners('unhandledRejection', beforeUR);
        const ucListeners = addedListeners('uncaughtException', beforeUC);
        expect(urListeners.length).toBe(1);
        expect(ucListeners.length).toBe(1);

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

        urListeners[0](new Error('import queue boom'));
        expect(logger.error).toHaveBeenCalled();
        expect(String(logger.error.mock.calls[0][0])).toMatch(/#1040/);
        expect(exitSpy).toHaveBeenCalledWith(1);

        exitSpy.mockClear();
        logger.error.mockClear();

        ucListeners[0](new Error('import queue sync boom'));
        expect(logger.error).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
      });
    });

    it('does not add a second pair of listeners when required again in the same process', async () => {
      await withCleanGuard(async () => {
        delete require.cache[importWorkerPath];
        require(importWorkerPath);
        const firstCount = process.listeners('uncaughtException').length;

        delete require.cache[importWorkerPath];
        require(importWorkerPath);
        const secondCount = process.listeners('uncaughtException').length;

        expect(secondCount).toBe(firstCount);
      });
    });
  });

  describe('server.js', () => {
    let logger;
    let originalNodeEnv;

    beforeEach(() => {
      originalNodeEnv = process.env.NODE_ENV;
      // Belt-and-suspenders: startServer() must not run as a side effect of
      // require()-ing this module in a test, regardless of vitest's own
      // NODE_ENV default -- server.js only auto-starts when
      // NODE_ENV !== "test" (or RUN_SERVER_IN_TEST="1", which we also leave unset).
      process.env.NODE_ENV = 'test';
      delete process.env.RUN_SERVER_IN_TEST;
      logger = require(loggerPath);
      vi.spyOn(logger, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      process.env.NODE_ENV = originalNodeEnv;
      delete require.cache[serverPath];
    });

    it('logs through the module logger and still calls process.exit(1) for both events', async () => {
      await withCleanGuard(async () => {
        const beforeUR = process.listeners('unhandledRejection').slice();
        const beforeUC = process.listeners('uncaughtException').slice();
        const beforeSIGINT = process.listeners('SIGINT').slice();
        const beforeSIGTERM = process.listeners('SIGTERM').slice();

        delete require.cache[serverPath];
        require(serverPath);

        const urListeners = addedListeners('unhandledRejection', beforeUR);
        const ucListeners = addedListeners('uncaughtException', beforeUC);
        expect(urListeners.length).toBe(1);
        expect(ucListeners.length).toBe(1);

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

        urListeners[0](new Error('boot sequence boom'));
        expect(logger.error).toHaveBeenCalled();
        expect(String(logger.error.mock.calls[0][0])).toMatch(/#1040/);
        expect(exitSpy).toHaveBeenCalledWith(1);

        exitSpy.mockClear();
        logger.error.mockClear();

        ucListeners[0](new Error('boot sequence sync boom'));
        expect(logger.error).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);

        // server.js also unconditionally registers SIGINT/SIGTERM handlers at
        // require time (pre-existing behaviour, out of #1040's scope) --
        // clean those up too so this test doesn't leak them.
        for (const listener of addedListeners('SIGINT', beforeSIGINT)) {
          process.removeListener('SIGINT', listener);
        }
        for (const listener of addedListeners('SIGTERM', beforeSIGTERM)) {
          process.removeListener('SIGTERM', listener);
        }
      });
    });

    it('does not add a second pair of listeners when required again in the same process', async () => {
      await withCleanGuard(async () => {
        const beforeSIGINT = process.listeners('SIGINT').slice();
        const beforeSIGTERM = process.listeners('SIGTERM').slice();

        delete require.cache[serverPath];
        require(serverPath);
        const firstCount = process.listeners('unhandledRejection').length;

        delete require.cache[serverPath];
        require(serverPath);
        const secondCount = process.listeners('unhandledRejection').length;

        expect(secondCount).toBe(firstCount);

        for (const listener of addedListeners('SIGINT', beforeSIGINT)) {
          process.removeListener('SIGINT', listener);
        }
        for (const listener of addedListeners('SIGTERM', beforeSIGTERM)) {
          process.removeListener('SIGTERM', listener);
        }
      });
    });
  });

  describe('src/workers/worker.js', () => {
    // worker.js runs startWorker() (real Redis I/O) at module load, so its
    // collaborators are faked via require.cache before each fresh require,
    // same pattern as tests/unit/worker.entrypoint.test.js. import-worker.js
    // is faked away here too -- its own #1040 registration is covered by its
    // own describe block above; this block is only about worker.js's.
    let fakeLogger;

    function stub(path, exports) {
      require.cache[path] = { id: path, filename: path, loaded: true, exports };
    }

    beforeEach(() => {
      fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      stub(dotenvPath, { config: vi.fn() });
      stub(loggerPath, fakeLogger);
      stub(importWorkerPath, { initWorker: vi.fn().mockResolvedValue({}), closeWorker: vi.fn() });
      stub(queueConfigPath, { testConnection: vi.fn().mockResolvedValue(true) });
      stub(redisConfigPath, {
        testRedisConnection: vi.fn().mockResolvedValue(true),
        getRedisInstance: vi.fn(() => ({ ping: vi.fn().mockResolvedValue('PONG') })),
      });
      stub(dailyMerkleJobPath, { scheduleNextRun: vi.fn() });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      for (const path of [workerPath, importWorkerPath, queueConfigPath, redisConfigPath, loggerPath, dailyMerkleJobPath, dotenvPath]) {
        delete require.cache[path];
      }
    });

    async function loadWorker() {
      delete require.cache[workerPath];
      require(workerPath);
      // startWorker() is async and unawaited by the module; drain the
      // microtask queue plus a macrotask so its try/catch settles before we
      // inspect anything (same as worker.entrypoint.test.js's loadWorker()).
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    }

    it('logs through the module logger and still calls process.exit(1) for both events', async () => {
      await withCleanGuard(async () => {
        const beforeUR = process.listeners('unhandledRejection').slice();
        const beforeUC = process.listeners('uncaughtException').slice();
        const beforeSIGINT = process.listeners('SIGINT').slice();
        const beforeSIGTERM = process.listeners('SIGTERM').slice();

        await loadWorker();

        const urListeners = addedListeners('unhandledRejection', beforeUR);
        const ucListeners = addedListeners('uncaughtException', beforeUC);
        expect(urListeners.length).toBe(1);
        expect(ucListeners.length).toBe(1);

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

        urListeners[0](new Error('worker queue boom'));
        expect(fakeLogger.error).toHaveBeenCalled();
        expect(String(fakeLogger.error.mock.calls[0][0])).toMatch(/#1040/);
        expect(exitSpy).toHaveBeenCalledWith(1);

        exitSpy.mockClear();
        fakeLogger.error.mockClear();

        ucListeners[0](new Error('worker queue sync boom'));
        expect(fakeLogger.error).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);

        for (const listener of addedListeners('SIGINT', beforeSIGINT)) {
          process.removeListener('SIGINT', listener);
        }
        for (const listener of addedListeners('SIGTERM', beforeSIGTERM)) {
          process.removeListener('SIGTERM', listener);
        }
      });
    });

    it('does not add a second pair of listeners when required again in the same process', async () => {
      await withCleanGuard(async () => {
        const beforeSIGINT = process.listeners('SIGINT').slice();
        const beforeSIGTERM = process.listeners('SIGTERM').slice();

        await loadWorker();
        const firstCount = process.listeners('unhandledRejection').length;

        await loadWorker();
        const secondCount = process.listeners('unhandledRejection').length;

        expect(secondCount).toBe(firstCount);

        for (const listener of addedListeners('SIGINT', beforeSIGINT)) {
          process.removeListener('SIGINT', listener);
        }
        for (const listener of addedListeners('SIGTERM', beforeSIGTERM)) {
          process.removeListener('SIGTERM', listener);
        }
      });
    });
  });

  describe('cross-file guard: worker.js requires import-worker.js into the same process', () => {
    // Proven here with two REAL (unstubbed) lightweight modules --
    // neo4jProjection.worker.js and import-worker.js -- rather than
    // worker.js + import-worker.js directly, since requiring the real
    // worker.js triggers real Redis I/O at module load (see the describe
    // block above, which fakes that away). The guarded property lives on
    // `process`, not on either module, so this pairing exercises the exact
    // same guard code path that worker.js + import-worker.js hit in
    // production.
    let logger;

    beforeEach(() => {
      logger = require(loggerPath);
      vi.spyOn(logger, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      delete require.cache[neo4jWorkerPath];
      delete require.cache[importWorkerPath];
    });

    it('the second module in-process does not install a duplicate pair of listeners', async () => {
      await withCleanGuard(async () => {
        const beforeUR = process.listeners('unhandledRejection').slice();
        const beforeUC = process.listeners('uncaughtException').slice();

        delete require.cache[neo4jWorkerPath];
        require(neo4jWorkerPath);

        delete require.cache[importWorkerPath];
        require(importWorkerPath);

        const urListeners = addedListeners('unhandledRejection', beforeUR);
        const ucListeners = addedListeners('uncaughtException', beforeUC);

        expect(urListeners.length).toBe(1);
        expect(ucListeners.length).toBe(1);
      });
    });
  });
});
