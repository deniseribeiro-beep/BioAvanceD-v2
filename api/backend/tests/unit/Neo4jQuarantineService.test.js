import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SERVICE_PATH = require.resolve('../../src/infrastructure/queue/Neo4jQuarantineService');
const IOREDIS_PATH = require.resolve('ioredis');

const Neo4jQuarantineService = require(SERVICE_PATH);

/**
 * `vi.mock('ioredis', ...)` does not intercept the plain `require('ioredis')`
 * inside this CJS source file (see cjs-mocking.md's "require.cache injection
 * also works for third-party npm packages" section) — fake it via
 * require.cache injection, re-requiring the service fresh so its top-level
 * `require('ioredis')` resolves to the fake.
 */
function withFakeRedisCtor(fn) {
  const realIoredisModule = require.cache[IOREDIS_PATH];
  const calls = [];
  function FakeRedis(...args) {
    calls.push(args);
    this.__ctorArgs = args;
    this.quit = vi.fn().mockResolvedValue('OK');
  }
  require.cache[IOREDIS_PATH] = { id: IOREDIS_PATH, filename: IOREDIS_PATH, loaded: true, exports: FakeRedis };
  delete require.cache[SERVICE_PATH];
  try {
    const FreshService = require(SERVICE_PATH);
    return fn(FreshService, calls);
  } finally {
    require.cache[IOREDIS_PATH] = realIoredisModule;
    delete require.cache[SERVICE_PATH];
    require(SERVICE_PATH);
  }
}

function makeFakeRedis() {
  return {
    rpush: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue('OK')
  };
}

function makeFakeLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  };
}

describe('Neo4jQuarantineService', () => {
  let redisClient;
  let logger;

  beforeEach(() => {
    redisClient = makeFakeRedis();
    logger = makeFakeLogger();
  });

  describe('constructor', () => {
    it('uses the injected redisClient and marks shouldCloseClient false', () => {
      const service = new Neo4jQuarantineService({ redisClient, logger });
      expect(service.redis).toBe(redisClient);
      expect(service.shouldCloseClient).toBe(false);
    });

    it('defaults queueKey to neo4j:topological:quarantine when not provided and no env var set', () => {
      const prev = process.env.NEO4J_QUARANTINE_QUEUE_KEY;
      delete process.env.NEO4J_QUARANTINE_QUEUE_KEY;
      const service = new Neo4jQuarantineService({ redisClient, logger });
      expect(service.queueKey).toBe('neo4j:topological:quarantine');
      if (prev !== undefined) process.env.NEO4J_QUARANTINE_QUEUE_KEY = prev;
    });

    it('uses provided queueKey option over default', () => {
      const service = new Neo4jQuarantineService({ redisClient, logger, queueKey: 'custom:queue:key' });
      expect(service.queueKey).toBe('custom:queue:key');
    });

    it('uses the provided logger instead of the default logger', () => {
      const service = new Neo4jQuarantineService({ redisClient, logger });
      expect(service.logger).toBe(logger);
    });
  });

  describe('constructor - own Redis client construction (no redisClient injected)', () => {
    const ENV_KEYS = [
      'NODE_ENV',
      'REDIS_TLS',
      'REDIS_URL',
      'REDIS_HOST',
      'REDIS_PORT',
      'REDIS_USERNAME',
      'REDIS_PASSWORD',
      'NEO4J_QUARANTINE_QUEUE_KEY'
    ];
    let savedEnv;

    beforeEach(() => {
      savedEnv = {};
      for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
      for (const key of ENV_KEYS) delete process.env[key];
    });

    afterEach(() => {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
    });

    it('uses NEO4J_QUARANTINE_QUEUE_KEY env var when no queueKey option is given', () => {
      process.env.NEO4J_QUARANTINE_QUEUE_KEY = 'env:queue:key';
      const service = new Neo4jQuarantineService({ logger });
      expect(service.queueKey).toBe('env:queue:key');
    });

    it('constructs its own Redis client with default options and marks shouldCloseClient true', () => {
      withFakeRedisCtor((FreshService, calls) => {
        const service = new FreshService({ logger });
        expect(service.shouldCloseClient).toBe(true);
        expect(calls).toHaveLength(1);
        const [options] = calls[0];
        expect(options).toMatchObject({
          username: 'default',
          maxRetriesPerRequest: null,
          enableReadyCheck: false
        });
        expect(options.tls).toBeUndefined();
      });
    });

    it('constructs with new Redis(redisUrl, options) when REDIS_URL is set', () => {
      process.env.REDIS_URL = 'redis://example.test:6379';
      withFakeRedisCtor((FreshService, calls) => {
        const service = new FreshService({ logger });
        expect(service.shouldCloseClient).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toBe('redis://example.test:6379');
      });
    });

    it('enables tls when REDIS_TLS is truthy and NODE_ENV is not development/test', () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_TLS = 'true';
      withFakeRedisCtor((FreshService, calls) => {
        new FreshService({ logger });
        const [options] = calls[0];
        expect(options.tls).toEqual({});
      });
    });

    it('does not enable tls when NODE_ENV is development, even if REDIS_TLS is truthy', () => {
      process.env.NODE_ENV = 'development';
      process.env.REDIS_TLS = 'true';
      withFakeRedisCtor((FreshService, calls) => {
        new FreshService({ logger });
        const [options] = calls[0];
        expect(options.tls).toBeUndefined();
      });
    });

    it('does not enable tls when NODE_ENV is unset (defaults to development)', () => {
      process.env.REDIS_TLS = '1';
      withFakeRedisCtor((FreshService, calls) => {
        new FreshService({ logger });
        const [options] = calls[0];
        expect(options.tls).toBeUndefined();
      });
    });

    it('deletes tls from a provided redisOptions object when shouldUseTls is false', () => {
      const redisOptions = { host: 'x', tls: { rejectUnauthorized: false } };
      withFakeRedisCtor((FreshService, calls) => {
        new FreshService({ logger, redisOptions });
        expect(redisOptions).not.toHaveProperty('tls');
        const [options] = calls[0];
        expect(options).toBe(redisOptions);
      });
    });

    it('keeps tls on a provided redisOptions object when shouldUseTls is true', () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_TLS = 'true';
      const redisOptions = { host: 'x', tls: { rejectUnauthorized: false } };
      withFakeRedisCtor((FreshService, calls) => {
        new FreshService({ logger, redisOptions });
        expect(redisOptions.tls).toEqual({ rejectUnauthorized: false });
      });
    });
  });

  describe('enqueueTopologicalTransaction', () => {
    it('throws when transaction is not an object', async () => {
      const service = new Neo4jQuarantineService({ redisClient, logger });
      await expect(service.enqueueTopologicalTransaction(null)).rejects.toThrow(
        'Transação topológica inválida para quarentena'
      );
      await expect(service.enqueueTopologicalTransaction('not-an-object')).rejects.toThrow(
        'Transação topológica inválida para quarentena'
      );
      expect(redisClient.rpush).not.toHaveBeenCalled();
    });

    it('throws when neither specimenId nor sampleMongoId is present', async () => {
      const service = new Neo4jQuarantineService({ redisClient, logger });
      await expect(service.enqueueTopologicalTransaction({ foo: 'bar' })).rejects.toThrow(
        'specimenId é obrigatório para quarentena topológica'
      );
      expect(redisClient.rpush).not.toHaveBeenCalled();
    });

    it('falls back to sampleMongoId when specimenId is missing', async () => {
      const service = new Neo4jQuarantineService({ redisClient, logger });
      const transaction = { sampleMongoId: 'mongo-123' };
      const result = await service.enqueueTopologicalTransaction(transaction);
      expect(result.queued).toBe(true);
      expect(result.item.specimenId).toBe('mongo-123');
      expect(redisClient.rpush).toHaveBeenCalledTimes(1);
    });

    it('enqueues a valid transaction with correct item shape and context defaults', async () => {
      const service = new Neo4jQuarantineService({ redisClient, logger, queueKey: 'my:queue' });
      const transaction = { specimenId: 'sample-1', payload: { a: 1 } };

      const result = await service.enqueueTopologicalTransaction(transaction);

      expect(result.queued).toBe(true);
      expect(result.queueKey).toBe('my:queue');
      expect(result.item.specimenId).toBe('sample-1');
      expect(result.item.transaction).toBe(transaction);
      expect(result.item.context).toEqual({
        reason: 'neo4j_unavailable_permissive_mode',
        strictMode: false,
        neo4jError: null,
        attempt: 0
      });
      expect(typeof result.item.createdAt).toBe('string');
      expect(() => new Date(result.item.createdAt).toISOString()).not.toThrow();

      expect(redisClient.rpush).toHaveBeenCalledTimes(1);
      const [calledKey, calledPayload] = redisClient.rpush.mock.calls[0];
      expect(calledKey).toBe('my:queue');
      expect(JSON.parse(calledPayload)).toMatchObject({
        specimenId: 'sample-1',
        context: {
          reason: 'neo4j_unavailable_permissive_mode',
          strictMode: false,
          neo4jError: null,
          attempt: 0
        }
      });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain('sample-1');
    });

    it('applies custom context values over defaults', async () => {
      const service = new Neo4jQuarantineService({ redisClient, logger });
      const transaction = { specimenId: 'sample-2' };
      const context = { reason: 'custom_reason', strictMode: true, neo4jError: 'boom', attempt: 3 };

      const result = await service.enqueueTopologicalTransaction(transaction, context);

      expect(result.item.context).toEqual({
        reason: 'custom_reason',
        strictMode: true,
        neo4jError: 'boom',
        attempt: 3
      });
    });

    it('coerces specimenId to a string', async () => {
      const service = new Neo4jQuarantineService({ redisClient, logger });
      const transaction = { specimenId: 12345 };
      const result = await service.enqueueTopologicalTransaction(transaction);
      expect(result.item.specimenId).toBe('12345');
    });

    it('throws and logs an error when redis.rpush fails', async () => {
      const failure = new Error('redis connection lost');
      redisClient.rpush.mockRejectedValueOnce(failure);
      const service = new Neo4jQuarantineService({ redisClient, logger });
      const transaction = { specimenId: 'sample-3' };

      await expect(service.enqueueTopologicalTransaction(transaction)).rejects.toThrow('redis connection lost');

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0][0]).toContain('Falha ao enfileirar transação');
      expect(logger.error.mock.calls[0][1]).toBe('redis connection lost');
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('is a no-op and does not call quit when shouldCloseClient is false (injected client)', async () => {
      const service = new Neo4jQuarantineService({ redisClient, logger });
      expect(service.shouldCloseClient).toBe(false);

      await service.close();

      expect(redisClient.quit).not.toHaveBeenCalled();
    });

    it('is a no-op when this.redis is falsy even if shouldCloseClient would be true', async () => {
      const service = new Neo4jQuarantineService({ redisClient, logger });
      service.shouldCloseClient = true;
      service.redis = null;

      await expect(service.close()).resolves.toBeUndefined();
    });

    it('calls redis.quit() when shouldCloseClient is true and a redis client exists', async () => {
      const service = new Neo4jQuarantineService({ redisClient, logger });
      service.shouldCloseClient = true;

      await service.close();

      expect(redisClient.quit).toHaveBeenCalledTimes(1);
    });

    it('catches and logs (via warn) an error from redis.quit() without rethrowing', async () => {
      const quitError = new Error('quit failed');
      redisClient.quit.mockRejectedValueOnce(quitError);
      const service = new Neo4jQuarantineService({ redisClient, logger });
      service.shouldCloseClient = true;

      await expect(service.close()).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain('Falha ao encerrar cliente Redis');
      expect(logger.warn.mock.calls[0][1]).toBe('quit failed');
    });
  });
});
