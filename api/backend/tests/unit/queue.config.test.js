import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// This module (src/config/queue.js) destructures `{ Queue, QueueEvents }` from
// `bullmq` and `{ validateRedisOnly }` from `./validateEnv` at module scope, and
// keeps module-level mutable state (redisConnection/importQueue/queueEvents)
// across calls. Per this repo's testing conventions, vi.mock()/vi.spyOn() do not
// reliably intercept require()-based destructured imports here. Instead we
// inject fake module objects directly into Node's require.cache for `bullmq`,
// `./validateEnv` and `./redis` BEFORE each fresh require of queue.js (clearing
// queue.js's own cache entry each time), so the destructuring inside queue.js
// re-runs against our fakes and the module-level state starts clean per test.

const queuePath = require.resolve('../../src/config/queue');
const bullmqPath = require.resolve('bullmq');
const validateEnvPath = require.resolve('../../src/config/validateEnv');
const redisPath = require.resolve('../../src/config/redis');
const logger = require('../../src/utils/logger');

let FakeQueue;
let FakeQueueEvents;
let fakeQueueInstances;
let fakeQueueEventsInstances;
let fakeValidateEnv;
let fakeRedisModule;
let getJobCountsImpl;

function installFakes() {
  fakeQueueInstances = [];
  fakeQueueEventsInstances = [];
  getJobCountsImpl = vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 });

  FakeQueue = vi.fn(function FakeQueueCtor(name, opts) {
    this.name = name;
    this.opts = opts;
    this.close = vi.fn().mockResolvedValue(undefined);
    this.getJobCounts = (...args) => getJobCountsImpl(...args);
    fakeQueueInstances.push(this);
  });

  FakeQueueEvents = vi.fn(function FakeQueueEventsCtor(name, opts) {
    this.name = name;
    this.opts = opts;
    this.listeners = {};
    this.on = vi.fn((event, handler) => {
      this.listeners[event] = handler;
    });
    this.close = vi.fn().mockResolvedValue(undefined);
    fakeQueueEventsInstances.push(this);
  });

  require.cache[bullmqPath] = {
    id: bullmqPath,
    filename: bullmqPath,
    loaded: true,
    exports: { Queue: FakeQueue, QueueEvents: FakeQueueEvents },
  };

  fakeValidateEnv = {
    validateRedisOnly: vi.fn().mockReturnValue(true),
  };
  require.cache[validateEnvPath] = {
    id: validateEnvPath,
    filename: validateEnvPath,
    loaded: true,
    exports: fakeValidateEnv,
  };

  fakeRedisModule = {
    marker: 'fake-redis-instance',
    testRedisConnection: vi.fn().mockResolvedValue(true),
    closeRedisConnection: vi.fn().mockResolvedValue(undefined),
  };
  require.cache[redisPath] = {
    id: redisPath,
    filename: redisPath,
    loaded: true,
    exports: fakeRedisModule,
  };
}

function freshQueueModule() {
  delete require.cache[queuePath];
  return require(queuePath);
}

function clearAllCaches() {
  delete require.cache[queuePath];
  delete require.cache[bullmqPath];
  delete require.cache[validateEnvPath];
  delete require.cache[redisPath];
}

describe('config/queue', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    installFakes();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.env.NODE_ENV = originalNodeEnv;
    clearAllCaches();
  });

  describe('initRedis', () => {
    it('validates and sets redisConnection to the redis module on success', () => {
      process.env.NODE_ENV = 'test';
      const queue = freshQueueModule();

      const result = queue.initRedis();

      expect(result).toBe(fakeRedisModule);
      expect(fakeValidateEnv.validateRedisOnly).toHaveBeenCalledWith(false, true);
    });

    it('memoizes: a second call returns the cached connection without re-validating', () => {
      process.env.NODE_ENV = 'test';
      const queue = freshQueueModule();

      const first = queue.initRedis();
      const second = queue.initRedis();

      expect(second).toBe(first);
      expect(fakeValidateEnv.validateRedisOnly).toHaveBeenCalledTimes(1);
    });

    it('invalid config + development NODE_ENV returns null and does not set redisConnection', () => {
      process.env.NODE_ENV = 'development';
      fakeValidateEnv.validateRedisOnly.mockReturnValue(false);
      const queue = freshQueueModule();

      const result = queue.initRedis();

      expect(result).toBeNull();
      // Because redisConnection was never set, a second call re-validates
      // (proves the null result was NOT cached/memoized).
      queue.initRedis();
      expect(fakeValidateEnv.validateRedisOnly).toHaveBeenCalledTimes(2);
    });

    it('returns null when validateRedisOnly reports invalid regardless of NODE_ENV (#22)', () => {
      // validateRedisOnly can only actually return false in development (any
      // other NODE_ENV throws first) — but initRedis's own null-return guard
      // should not additionally gate on NODE_ENV itself, since nothing about
      // the guard's purpose (don't init Redis with an invalid config) is
      // development-specific. Simulated here via a direct mock since the real
      // validateRedisOnly can't produce this combination.
      process.env.NODE_ENV = 'test';
      fakeValidateEnv.validateRedisOnly.mockReturnValue(false);
      const queue = freshQueueModule();

      expect(queue.initRedis()).toBeNull();
    });

    it('propagates an error thrown by validateRedisOnly (e.g. invalid config in non-development)', () => {
      process.env.NODE_ENV = 'production';
      const boom = new Error('Redis configurado incorretamente: REDIS_HOST não está definido');
      fakeValidateEnv.validateRedisOnly.mockImplementation(() => {
        throw boom;
      });
      const queue = freshQueueModule();

      expect(() => queue.initRedis()).toThrow(boom);
    });
  });

  describe('initQueue', () => {
    it('returns null and does not construct a Queue when Redis is unavailable', () => {
      process.env.NODE_ENV = 'development';
      fakeValidateEnv.validateRedisOnly.mockReturnValue(false);
      const queue = freshQueueModule();

      const result = queue.initQueue();

      expect(result).toBeNull();
      expect(FakeQueue).not.toHaveBeenCalled();
    });

    it('happy path constructs Queue and QueueEvents with the expected name/options and wires listeners', () => {
      process.env.NODE_ENV = 'test';
      const queue = freshQueueModule();

      const result = queue.initQueue();

      expect(FakeQueue).toHaveBeenCalledTimes(1);
      expect(FakeQueue).toHaveBeenCalledWith(
        'import-queue',
        expect.objectContaining({
          connection: fakeRedisModule,
          defaultJobOptions: expect.objectContaining({
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: expect.objectContaining({ age: 24 * 3600, count: 1000 }),
            removeOnFail: expect.objectContaining({ age: 7 * 24 * 3600 }),
          }),
        })
      );
      expect(FakeQueueEvents).toHaveBeenCalledTimes(1);
      expect(FakeQueueEvents).toHaveBeenCalledWith('import-queue', { connection: fakeRedisModule });

      const eventsInstance = fakeQueueEventsInstances[0];
      expect(Object.keys(eventsInstance.listeners).sort()).toEqual(
        ['completed', 'failed', 'progress', 'stalled'].sort()
      );
      expect(result).toBe(fakeQueueInstances[0]);
    });

    it('memoizes: a second call returns the cached queue without constructing a new one', () => {
      process.env.NODE_ENV = 'test';
      const queue = freshQueueModule();

      const first = queue.initQueue();
      const second = queue.initQueue();

      expect(second).toBe(first);
      expect(FakeQueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('getQueue', () => {
    it('delegates to initQueue when uncached', () => {
      process.env.NODE_ENV = 'test';
      const queue = freshQueueModule();

      const result = queue.getQueue();

      expect(FakeQueue).toHaveBeenCalledTimes(1);
      expect(result).toBe(fakeQueueInstances[0]);
    });

    it('returns the cached queue without calling initQueue logic again', () => {
      process.env.NODE_ENV = 'test';
      const queue = freshQueueModule();

      queue.initQueue();
      const result = queue.getQueue();

      expect(FakeQueue).toHaveBeenCalledTimes(1);
      expect(result).toBe(fakeQueueInstances[0]);
    });
  });

  describe('getQueueEvents', () => {
    it('delegates to initQueue when uncached', () => {
      process.env.NODE_ENV = 'test';
      const queue = freshQueueModule();

      const result = queue.getQueueEvents();

      expect(FakeQueueEvents).toHaveBeenCalledTimes(1);
      expect(result).toBe(fakeQueueEventsInstances[0]);
    });

    it('returns the cached queueEvents without re-initializing', () => {
      process.env.NODE_ENV = 'test';
      const queue = freshQueueModule();

      queue.initQueue();
      const result = queue.getQueueEvents();

      expect(FakeQueueEvents).toHaveBeenCalledTimes(1);
      expect(result).toBe(fakeQueueEventsInstances[0]);
    });
  });

  describe('closeConnections', () => {
    it('closes queueEvents, queue and the redis connection, and resets state to null', async () => {
      process.env.NODE_ENV = 'test';
      const queue = freshQueueModule();
      queue.initQueue();
      const queueInstance = fakeQueueInstances[0];
      const eventsInstance = fakeQueueEventsInstances[0];

      await queue.closeConnections();

      expect(eventsInstance.close).toHaveBeenCalledTimes(1);
      expect(queueInstance.close).toHaveBeenCalledTimes(1);
      expect(fakeRedisModule.closeRedisConnection).toHaveBeenCalledTimes(1);

      // State reset to null: calling initQueue again constructs brand new instances.
      queue.initQueue();
      expect(FakeQueue).toHaveBeenCalledTimes(2);
      expect(FakeQueueEvents).toHaveBeenCalledTimes(2);
    });

    it('catches and swallows an error thrown while closing, instead of rejecting', async () => {
      process.env.NODE_ENV = 'test';
      const queue = freshQueueModule();
      queue.initQueue();
      const eventsInstance = fakeQueueEventsInstances[0];
      eventsInstance.close.mockRejectedValue(new Error('close failed'));

      await expect(queue.closeConnections()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('returns false when testRedisConnection fails, without initializing the queue', async () => {
      process.env.NODE_ENV = 'test';
      fakeRedisModule.testRedisConnection.mockResolvedValue(false);
      const queue = freshQueueModule();

      const result = await queue.testConnection();

      expect(result).toBe(false);
      expect(FakeQueue).not.toHaveBeenCalled();
    });

    it('happy path initializes the queue, checks job counts, and returns true', async () => {
      process.env.NODE_ENV = 'test';
      vi.useFakeTimers();
      const queue = freshQueueModule();

      const resultPromise = queue.testConnection();
      await vi.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result).toBe(true);
      expect(FakeQueue).toHaveBeenCalledTimes(1);
      expect(getJobCountsImpl).toHaveBeenCalledWith('waiting', 'active', 'completed', 'failed');
    });

    it('catches an error thrown by getJobCounts and returns false instead of propagating', async () => {
      process.env.NODE_ENV = 'test';
      getJobCountsImpl.mockRejectedValue(new Error('getJobCounts failed'));
      vi.useFakeTimers();
      const queue = freshQueueModule();

      const resultPromise = queue.testConnection();
      await vi.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(result).toBe(false);
    });
  });
});
