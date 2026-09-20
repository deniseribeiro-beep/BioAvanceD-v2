import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const REDIS_MODULE_PATH = require.resolve('../../src/config/redis');
const ENV_MODULE_PATH = require.resolve('../../src/config/env');
const IOREDIS_MODULE_PATH = require.resolve('ioredis');
require('ioredis'); // ensure it's populated in require.cache before we mutate it

const realIoredisExports = require.cache[IOREDIS_MODULE_PATH].exports;

/**
 * redis.js does `const Redis = require('ioredis')` (default-export, not
 * destructured), so we can replace the cached module's `exports` directly
 * with our own fake constructor function before redis.js is re-required.
 * This mirrors the mechanic in database-mongo.test.js, adapted for a
 * default-export-as-the-whole-module shape rather than a named export.
 */
class FakeRedisInstance {
  constructor(...args) {
    this._handlers = {};
    this.status = 'connecting';
    this._args = args;
    FakeRedisInstance.instances.push(this);
    if (FakeRedisInstance.ctorSpy) FakeRedisInstance.ctorSpy(...args);
  }

  on(event, handler) {
    (this._handlers[event] = this._handlers[event] || []).push(handler);
    return this;
  }

  once(event, handler) {
    const wrapped = (...a) => {
      this.removeListener(event, wrapped);
      handler(...a);
    };
    return this.on(event, wrapped);
  }

  removeListener(event, handler) {
    if (!this._handlers[event]) return this;
    this._handlers[event] = this._handlers[event].filter((h) => h !== handler);
    return this;
  }

  emit(event, ...args) {
    (this._handlers[event] || []).slice().forEach((h) => h(...args));
  }

  async ping() {
    if (FakeRedisInstance.pingBehavior) return FakeRedisInstance.pingBehavior();
    return 'PONG';
  }

  async quit() {
    if (FakeRedisInstance.quitBehavior) return FakeRedisInstance.quitBehavior();
    return 'OK';
  }

  disconnect() {
    this._disconnected = true;
  }
}
FakeRedisInstance.instances = [];
FakeRedisInstance.ctorSpy = null;
FakeRedisInstance.pingBehavior = null;
FakeRedisInstance.quitBehavior = null;

function installFakeRedis() {
  FakeRedisInstance.instances = [];
  FakeRedisInstance.ctorSpy = null;
  FakeRedisInstance.pingBehavior = null;
  FakeRedisInstance.quitBehavior = null;
  function FakeRedisCtor(...args) {
    return new FakeRedisInstance(...args);
  }
  require.cache[IOREDIS_MODULE_PATH].exports = FakeRedisCtor;
}

function restoreRealRedis() {
  require.cache[IOREDIS_MODULE_PATH].exports = realIoredisExports;
}

function freshRedis() {
  delete require.cache[REDIS_MODULE_PATH];
  installFakeRedis();
  // eslint-disable-next-line global-require
  return require('../../src/config/redis');
}

function setEnv(vars) {
  delete require.cache[ENV_MODULE_PATH];
  Object.keys(process.env)
    .filter((k) => k.startsWith('REDIS_') || k === 'NODE_ENV')
    .forEach((k) => delete process.env[k]);
  Object.entries(vars).forEach(([k, v]) => {
    if (v === undefined) return;
    process.env[k] = String(v);
  });
}

const ORIGINAL_ENV = { ...process.env };

describe('config/redis.js', () => {
  afterEach(() => {
    delete require.cache[REDIS_MODULE_PATH];
    delete require.cache[ENV_MODULE_PATH];
    restoreRealRedis();
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe('createRedisConnection validation (via getRedisInstance)', () => {
    it('throws when neither REDIS_URL nor REDIS_HOST is set', () => {
      setEnv({ NODE_ENV: 'test', REDIS_PORT: '6379' });
      const redisMod = freshRedis();

      expect(() => redisMod.getRedisInstance()).toThrow(/REDIS_HOST ou REDIS_URL/);
      expect(FakeRedisInstance.instances).toHaveLength(0);
    });

    it('throws when neither REDIS_URL nor REDIS_PORT is set', () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: 'redis.example.com' });
      const redisMod = freshRedis();

      expect(() => redisMod.getRedisInstance()).toThrow(/REDIS_PORT/);
      expect(FakeRedisInstance.instances).toHaveLength(0);
    });

    it('does not throw when REDIS_URL alone is provided (no host/port needed)', () => {
      setEnv({ NODE_ENV: 'test', REDIS_URL: 'redis://myhost:6380' });
      const redisMod = freshRedis();

      expect(() => redisMod.getRedisInstance()).not.toThrow();
      expect(FakeRedisInstance.instances).toHaveLength(1);
    });
  });

  describe('config building', () => {
    it('builds config from discrete REDIS_HOST/PORT/USERNAME/PASSWORD vars when no REDIS_URL', () => {
      setEnv({
        NODE_ENV: 'test',
        REDIS_HOST: 'redis.example.com',
        REDIS_PORT: '6380',
        REDIS_USERNAME: 'myuser',
        REDIS_PASSWORD: 'mypass',
      });
      const redisMod = freshRedis();
      redisMod.getRedisInstance();

      expect(FakeRedisInstance.instances).toHaveLength(1);
      const args = FakeRedisInstance.instances[0]._args;
      // discrete-var path: new Redis(config) -- single arg, no URL string
      expect(args).toHaveLength(1);
      const config = args[0];
      expect(config.host).toBe('redis.example.com');
      expect(config.port).toBe(6380);
      expect(config.username).toBe('myuser');
      expect(config.password).toBe('mypass');
    });

    it('parses REDIS_URL and passes the URL string as first constructor arg, falling back to the URL-embedded password when REDIS_PASSWORD is unset', () => {
      setEnv({
        NODE_ENV: 'test',
        REDIS_URL: 'redis://urluser:urlpass@remotehost:6381',
      });
      const redisMod = freshRedis();
      redisMod.getRedisInstance();

      expect(FakeRedisInstance.instances).toHaveLength(1);
      const args = FakeRedisInstance.instances[0]._args;
      // url path: new Redis(redisUrl, config) -- two args
      expect(args).toHaveLength(2);
      expect(args[0]).toBe('redis://urluser:urlpass@remotehost:6381');
      const config = args[1];
      expect(config.username).toBe('urluser');
      expect(config.password).toBe('urlpass');
    });

    it('prefers explicit REDIS_USERNAME/REDIS_PASSWORD over URL-embedded credentials', () => {
      setEnv({
        NODE_ENV: 'test',
        REDIS_URL: 'redis://urluser:urlpass@remotehost:6381',
        REDIS_USERNAME: 'explicituser',
        REDIS_PASSWORD: 'explicitpass',
      });
      const redisMod = freshRedis();
      redisMod.getRedisInstance();

      const config = FakeRedisInstance.instances[0]._args[1];
      expect(config.username).toBe('explicituser');
      expect(config.password).toBe('explicitpass');
    });
  });

  describe('TLS behavior', () => {
    it('enables TLS when REDIS_TLS=true and NODE_ENV is a non-local env (production)', () => {
      setEnv({
        NODE_ENV: 'production',
        REDIS_HOST: 'remotehost',
        REDIS_PORT: '6379',
        REDIS_TLS: 'true',
      });
      const redisMod = freshRedis();
      redisMod.getRedisInstance();

      const config = FakeRedisInstance.instances[0]._args[0];
      expect(config.tls).toEqual({});
    });

    it('force-disables TLS locally even when REDIS_TLS=true, because NODE_ENV=test is treated as local', () => {
      setEnv({
        NODE_ENV: 'test',
        REDIS_HOST: 'remotehost',
        REDIS_PORT: '6379',
        REDIS_TLS: 'true',
      });
      const redisMod = freshRedis();
      redisMod.getRedisInstance();

      const config = FakeRedisInstance.instances[0]._args[0];
      expect(config.tls).toBeUndefined();
    });

    it('leaves TLS disabled when REDIS_TLS is unset in a non-local env', () => {
      setEnv({
        NODE_ENV: 'production',
        REDIS_HOST: 'remotehost',
        REDIS_PORT: '6379',
      });
      const redisMod = freshRedis();
      redisMod.getRedisInstance();

      const config = FakeRedisInstance.instances[0]._args[0];
      expect(config.tls).toBeUndefined();
    });
  });

  describe('config.retryStrategy', () => {
    it('backs off linearly at 50ms per attempt, capped at 2000ms', () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      redisMod.getRedisInstance();
      const config = FakeRedisInstance.instances[0]._args[0];

      expect(config.retryStrategy(1)).toBe(50);
      expect(config.retryStrategy(10)).toBe(500);
      expect(config.retryStrategy(100)).toBe(2000);
    });
  });

  describe('config.reconnectOnError', () => {
    it('returns true and logs a warning when the error message includes READONLY', () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      redisMod.getRedisInstance();
      const config = FakeRedisInstance.instances[0]._args[0];
      const warnSpy = vi.spyOn(require('../../src/utils/logger'), 'warn');

      expect(config.reconnectOnError(new Error('READONLY You can\'t write'))).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('READONLY'));
    });

    it('returns false for errors unrelated to READONLY', () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      redisMod.getRedisInstance();
      const config = FakeRedisInstance.instances[0]._args[0];

      expect(config.reconnectOnError(new Error('some other failure'))).toBe(false);
    });
  });

  describe('error event handler: graceful local-ECONNREFUSED disconnect vs plain error log', () => {
    it('calls redis.disconnect() and logs a warning (not error) for local host + ECONNREFUSED in a local env', () => {
      setEnv({
        NODE_ENV: 'test',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '6379',
      });
      const redisMod = freshRedis();
      const instance = redisMod.getRedisInstance();

      const warnSpy = vi.spyOn(require('../../src/utils/logger'), 'warn');
      const errorSpy = vi.spyOn(require('../../src/utils/logger'), 'error');

      const err = new Error('connect ECONNREFUSED 127.0.0.1:6379');
      err.code = 'ECONNREFUSED';
      instance.emit('error', err);

      expect(instance._disconnected).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('indisponível'));
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Erro na conexão Redis'), expect.anything());
    });

    it('logs a plain error (does not disconnect) for ECONNREFUSED against a non-local host', () => {
      setEnv({
        NODE_ENV: 'test',
        REDIS_HOST: 'remotehost.example.com',
        REDIS_PORT: '6379',
      });
      const redisMod = freshRedis();
      const instance = redisMod.getRedisInstance();

      const errorSpy = vi.spyOn(require('../../src/utils/logger'), 'error');

      const err = new Error('connect ECONNREFUSED remotehost.example.com:6379');
      err.code = 'ECONNREFUSED';
      instance.emit('error', err);

      expect(instance._disconnected).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith('[ERROR] Erro na conexão Redis:', err.message);
    });

    it('logs a plain error for local host but a non-ECONNREFUSED error code', () => {
      setEnv({
        NODE_ENV: 'test',
        REDIS_HOST: 'localhost',
        REDIS_PORT: '6379',
      });
      const redisMod = freshRedis();
      const instance = redisMod.getRedisInstance();

      const errorSpy = vi.spyOn(require('../../src/utils/logger'), 'error');

      const err = new Error('some other failure');
      err.code = 'ENOTFOUND';
      instance.emit('error', err);

      expect(instance._disconnected).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith('[ERROR] Erro na conexão Redis:', err.message);
    });
  });

  describe('getRedisInstance singleton memoization', () => {
    it('returns the same instance on repeated calls without constructing twice', () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();

      const first = redisMod.getRedisInstance();
      const second = redisMod.getRedisInstance();

      expect(second).toBe(first);
      expect(FakeRedisInstance.instances).toHaveLength(1);
    });
  });

  describe('testRedisConnection', () => {
    it('returns true when status is already ready and ping resolves to PONG', async () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      const instance = redisMod.getRedisInstance();
      instance.status = 'ready';
      FakeRedisInstance.pingBehavior = async () => 'PONG';

      await expect(redisMod.testRedisConnection()).resolves.toBe(true);
    });

    it('returns false when ping resolves to something other than PONG', async () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      const instance = redisMod.getRedisInstance();
      instance.status = 'ready';
      FakeRedisInstance.pingBehavior = async () => 'WRONG';

      await expect(redisMod.testRedisConnection()).resolves.toBe(false);
    });

    it('waits for the "ready" event when status is not ready yet, then pings successfully', async () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      const instance = redisMod.getRedisInstance();
      instance.status = 'connecting';
      FakeRedisInstance.pingBehavior = async () => 'PONG';

      const resultPromise = redisMod.testRedisConnection();
      // Manually fire 'ready' immediately instead of waiting on the real 15s timeout.
      instance.emit('ready');

      await expect(resultPromise).resolves.toBe(true);
    });

    it('resolves false without throwing when the "error" event fires for a local ECONNREFUSED while waiting', async () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      const instance = redisMod.getRedisInstance();
      instance.status = 'connecting';

      const resultPromise = redisMod.testRedisConnection();
      const err = new Error('connect ECONNREFUSED 127.0.0.1:6379');
      err.code = 'ECONNREFUSED';
      instance.emit('error', err);

      await expect(resultPromise).resolves.toBe(false);
    });

    it('resolves false without throwing for a generic error while waiting (non-local-ECONNREFUSED path)', async () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: 'remotehost.example.com', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      const instance = redisMod.getRedisInstance();
      instance.status = 'connecting';

      const resultPromise = redisMod.testRedisConnection();
      const err = new Error('connect ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      instance.emit('error', err);

      await expect(resultPromise).resolves.toBe(false);
    });

    it('logs code/syscall/address and both hint messages for a non-local ECONNREFUSED+ETIMEDOUT-worded error', async () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: 'remotehost.example.com', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      const instance = redisMod.getRedisInstance();
      instance.status = 'ready';
      const errorSpy = vi.spyOn(require('../../src/utils/logger'), 'error');
      const err = new Error('connect ECONNREFUSED remotehost.example.com:6379 ETIMEDOUT Timeout');
      err.code = 'ECONNREFUSED';
      err.syscall = 'connect';
      err.address = 'remotehost.example.com';
      err.port = 6379;
      FakeRedisInstance.pingBehavior = async () => {
        throw err;
      };

      await expect(redisMod.testRedisConnection()).resolves.toBe(false);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Código do erro'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Chamada de sistema'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Endereço'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Verifique se o Redis está rodando'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('firewall'));
    });

    it('resolves false when ping itself throws a local-ECONNREFUSED error after status is ready', async () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: 'localhost', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      const instance = redisMod.getRedisInstance();
      instance.status = 'ready';
      const err = new Error('connect ECONNREFUSED localhost:6379');
      err.code = 'ECONNREFUSED';
      FakeRedisInstance.pingBehavior = async () => {
        throw err;
      };

      await expect(redisMod.testRedisConnection()).resolves.toBe(false);
    });
  });

  describe('closeRedisConnection', () => {
    it('no-ops (resolves without throwing) when no instance was ever created', async () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();

      await expect(redisMod.closeRedisConnection()).resolves.toBeUndefined();
      expect(FakeRedisInstance.instances).toHaveLength(0);
    });

    it('calls quit() and nulls the singleton on a normal close (a subsequent getRedisInstance creates a new instance)', async () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      const first = redisMod.getRedisInstance();
      FakeRedisInstance.quitBehavior = async () => 'OK';

      await expect(redisMod.closeRedisConnection()).resolves.toBeUndefined();

      const second = redisMod.getRedisInstance();
      expect(second).not.toBe(first);
      expect(FakeRedisInstance.instances).toHaveLength(2);
    });

    it('rethrows when quit() rejects, unlike testRedisConnection which swallows errors', async () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();
      redisMod.getRedisInstance();
      const quitError = new Error('quit failed: connection already closed');
      FakeRedisInstance.quitBehavior = async () => {
        throw quitError;
      };

      await expect(redisMod.closeRedisConnection()).rejects.toThrow('quit failed');
    });
  });

  describe('exported redis Proxy', () => {
    it('does not create a Redis instance merely by requiring the module', () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      freshRedis();

      expect(FakeRedisInstance.instances).toHaveLength(0);
    });

    it('lazily proxies property access through to a real singleton instance on first touch', () => {
      setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
      const redisMod = freshRedis();

      expect(redisMod.status).toBe('connecting');
      expect(FakeRedisInstance.instances).toHaveLength(1);
    });
  });
});


describe('config/redis.js item 8 final residual branches', () => {
  afterEach(() => {
    delete require.cache[REDIS_MODULE_PATH];
    delete require.cache[ENV_MODULE_PATH];
    restoreRealRedis();
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('keeps a discrete local Redis config passwordless when REDIS_PASSWORD is absent', () => {
    setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
    const redisMod = freshRedis();
    redisMod.getRedisInstance();

    const config = FakeRedisInstance.instances[0]._args[0];
    expect(config.password).toBeUndefined();
    expect(config.username).toBe('default');
  });

  it('keeps a URL Redis config passwordless when neither explicit nor embedded password is present', () => {
    setEnv({ NODE_ENV: 'production', REDIS_URL: 'redis://remotehost:6380' });
    const redisMod = freshRedis();
    redisMod.getRedisInstance();

    const config = FakeRedisInstance.instances[0]._args[1];
    expect(config.password).toBeUndefined();
    expect(config.username).toBe('default');
  });

  it('falls back to REDIS_HOST metadata when a non-empty REDIS_URL cannot be parsed', () => {
    setEnv({
      NODE_ENV: 'production',
      REDIS_URL: 'not a valid redis url',
      REDIS_HOST: 'fallback.redis.internal',
      REDIS_PORT: '6380',
    });
    const redisMod = freshRedis();

    expect(() => redisMod.getRedisInstance()).not.toThrow();
    expect(FakeRedisInstance.instances).toHaveLength(1);
    expect(FakeRedisInstance.instances[0]._args[0]).toBe('not a valid redis url');
  });

  it('generic ping failure without optional error metadata skips all specialized diagnostics', async () => {
    setEnv({ NODE_ENV: 'production', REDIS_HOST: 'remotehost.example.com', REDIS_PORT: '6379' });
    const redisMod = freshRedis();
    const instance = redisMod.getRedisInstance();
    instance.status = 'ready';
    const logger = require('../../src/utils/logger');
    const errorSpy = vi.spyOn(logger, 'error');
    FakeRedisInstance.pingBehavior = async () => {
      throw new Error('plain redis failure');
    };

    await expect(redisMod.testRedisConnection()).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] Teste de conexão Redis falhou:', 'plain redis failure');
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Código do erro'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Chamada de sistema'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Endereço'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Redis está rodando'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('firewall'));
  });

  it('exercises connect/ready/close/reconnecting event callbacks on a real configured fake instance', () => {
    setEnv({ NODE_ENV: 'production', REDIS_HOST: 'remotehost.example.com', REDIS_PORT: '6379' });
    const redisMod = freshRedis();
    const instance = redisMod.getRedisInstance();
    const logger = require('../../src/utils/logger');
    const infoSpy = vi.spyOn(logger, 'info');
    const warnSpy = vi.spyOn(logger, 'warn');

    instance.emit('connect');
    instance.emit('ready');
    instance.emit('close');
    instance.emit('reconnecting', 250);

    expect(infoSpy).toHaveBeenCalledWith('[INFO] Redis conectado');
    expect(infoSpy).toHaveBeenCalledWith('[INFO] Redis pronto para uso');
    expect(warnSpy).toHaveBeenCalledWith('[WARN] Conexão Redis fechada');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('250ms'));
  });

  it('uses proxy-owned properties without constructing Redis and covers the has trap on both states', () => {
    setEnv({ NODE_ENV: 'test', REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379' });
    const redisMod = freshRedis();

    redisMod.item8Sentinel = 'ok';
    expect(redisMod.item8Sentinel).toBe('ok');
    expect('item8Sentinel' in redisMod).toBe(true);
    expect('definitelyMissingProperty' in redisMod).toBe(false);
    expect(FakeRedisInstance.instances).toHaveLength(0);

    const instance = redisMod.getRedisInstance();
    instance.runtimeOnly = 42;
    expect('runtimeOnly' in redisMod).toBe(true);
  });
});
