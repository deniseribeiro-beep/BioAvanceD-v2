import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const logger = require('../../src/utils/logger');

const GUARD_KEY = '__BIOAVANCE_1040_PROCESS_HANDLERS_INSTALLED__';
const workerPath = require.resolve('../../src/workers/worker');
const importWorkerPath = require.resolve('../../src/workers/import-worker');
const loggerPath = require.resolve('../../src/utils/logger');
const queueConfigPath = require.resolve('../../src/config/queue');
const redisConfigPath = require.resolve('../../src/config/redis');
const dailyMerkleJobPath = require.resolve('../../src/workers/jobs/daily-merkle.job');
const validateEnvPath = require.resolve('../../src/config/validateEnv');
const dotenvPath = require.resolve('dotenv');

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
        if (!before[event].includes(listener)) process.removeListener(event, listener);
      }
    }
    delete process[GUARD_KEY];
    if (hadGuard) process[GUARD_KEY] = guardBefore;
  }
}

function installWorkerLoadFakes() {
  require.cache[dotenvPath] = {
    id: dotenvPath,
    filename: dotenvPath,
    loaded: true,
    exports: { config: () => ({}) },
  };
  require.cache[validateEnvPath] = {
    id: validateEnvPath,
    filename: validateEnvPath,
    loaded: true,
    exports: { validateEncryptionAndHalt: () => {} },
  };
  require.cache[queueConfigPath] = {
    id: queueConfigPath,
    filename: queueConfigPath,
    loaded: true,
    exports: { testConnection: async () => true },
  };
  require.cache[redisConfigPath] = {
    id: redisConfigPath,
    filename: redisConfigPath,
    loaded: true,
    exports: {
      testRedisConnection: async () => true,
      getRedisInstance: () => ({
        ping: async () => {
          throw 'plain heartbeat failure';
        },
      }),
    },
  };
  require.cache[importWorkerPath] = {
    id: importWorkerPath,
    filename: importWorkerPath,
    loaded: true,
    exports: { initWorker: async () => {} },
  };
  require.cache[dailyMerkleJobPath] = {
    id: dailyMerkleJobPath,
    filename: dailyMerkleJobPath,
    loaded: true,
    exports: {
      scheduleNextRun: () => {
        throw 'plain merkle schedule failure';
      },
    },
  };
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: logger,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete require.cache[workerPath];
});

describe('worker.js item 8 residual plain-failure branches', () => {
  it('logs raw unhandledRejection / uncaughtException reasons without .message', async () => {
    await withCleanGuard(async () => {
      installWorkerLoadFakes();
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

      const beforeUR = process.listeners('unhandledRejection').slice();
      const beforeUC = process.listeners('uncaughtException').slice();
      delete require.cache[workerPath];
      require('../../src/workers/worker');

      const ur = process.listeners('unhandledRejection').find((l) => !beforeUR.includes(l));
      const uc = process.listeners('uncaughtException').find((l) => !beforeUC.includes(l));
      expect(ur).toBeTruthy();
      expect(uc).toBeTruthy();

      ur('plain rejection');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('unhandledRejection'),
        'plain rejection'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockClear();
      errorSpy.mockClear();
      uc('plain exception');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('uncaughtException'),
        'plain exception'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'Job daily-merkle não registrado:',
        'plain merkle schedule failure'
      );
    });
  });
});
