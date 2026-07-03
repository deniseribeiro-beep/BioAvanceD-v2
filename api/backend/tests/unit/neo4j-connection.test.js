import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CONNECTION_MODULE_PATH = require.resolve('../../src/infrastructure/database/neo4j/connection');
const ENV_MODULE_PATH = require.resolve('../../src/config/env');
const NEO4J_DRIVER_MODULE_PATH = require.resolve('neo4j-driver');
require('neo4j-driver'); // ensure it's populated in require.cache before we mutate it

const realNeo4jDriverExports = require.cache[NEO4J_DRIVER_MODULE_PATH].exports;

/**
 * connection.js does `const neo4j = require('neo4j-driver')` and calls
 * `neo4j.driver(...)` / `neo4j.auth.basic(...)` without destructuring, so we
 * can replace the cached module's `exports` object with a fake before
 * connection.js is re-required, mirroring the mechanic in redis.test.js.
 */
class FakeSession {
  constructor() {
    this.closed = false;
  }

  async run() {
    if (FakeSession.runBehavior) return FakeSession.runBehavior();
    return { records: [] };
  }

  async close() {
    this.closed = true;
  }
}
FakeSession.runBehavior = null;

class FakeDriver {
  constructor(...args) {
    this._args = args;
    this.closed = false;
    FakeDriver.instances.push(this);
  }

  async verifyConnectivity() {
    if (FakeDriver.verifyConnectivityBehavior) return FakeDriver.verifyConnectivityBehavior();
    return true;
  }

  session() {
    const s = new FakeSession();
    FakeDriver.sessions.push(s);
    return s;
  }

  async close() {
    this.closed = true;
  }
}
FakeDriver.instances = [];
FakeDriver.sessions = [];
FakeDriver.verifyConnectivityBehavior = null;

function installFakeNeo4jDriverPkg() {
  FakeDriver.instances = [];
  FakeDriver.sessions = [];
  FakeDriver.verifyConnectivityBehavior = null;
  FakeSession.runBehavior = null;

  const fakeModule = {
    driver: vi.fn((...args) => new FakeDriver(...args)),
    auth: {
      basic: vi.fn((username, password) => ({ scheme: 'basic', principal: username, credentials: password }))
    }
  };
  require.cache[NEO4J_DRIVER_MODULE_PATH].exports = fakeModule;
  return fakeModule;
}

function restoreRealNeo4jDriverPkg() {
  require.cache[NEO4J_DRIVER_MODULE_PATH].exports = realNeo4jDriverExports;
}

function freshConnection() {
  delete require.cache[CONNECTION_MODULE_PATH];
  const fakeDriverPkg = installFakeNeo4jDriverPkg();
  // eslint-disable-next-line global-require
  const connectionMod = require('../../src/infrastructure/database/neo4j/connection');
  return { connectionMod, fakeDriverPkg };
}

function setEnv(vars) {
  delete require.cache[ENV_MODULE_PATH];
  Object.keys(process.env)
    .filter((k) => k.startsWith('NEO4J_') || k === 'NODE_ENV')
    .forEach((k) => delete process.env[k]);
  Object.entries(vars).forEach(([k, v]) => {
    if (v === undefined) return;
    process.env[k] = String(v);
  });
}

const ORIGINAL_ENV = { ...process.env };

describe('infrastructure/database/neo4j/connection.js', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    delete require.cache[CONNECTION_MODULE_PATH];
    delete require.cache[ENV_MODULE_PATH];
    restoreRealNeo4jDriverPkg();
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('getNeo4jConfig', () => {
    it('builds the config object from env vars, defaulting database to "neo4j" when unset', () => {
      setEnv({
        NODE_ENV: 'test',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'secret'
      });
      const { connectionMod } = freshConnection();

      const config = connectionMod.getNeo4jConfig();
      expect(config).toEqual({
        uri: 'bolt://localhost:7687',
        username: 'neo4j',
        password: 'secret',
        database: 'neo4j'
      });
    });

    it('uses NEO4J_DATABASE when explicitly set', () => {
      setEnv({
        NODE_ENV: 'test',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'secret',
        NEO4J_DATABASE: 'custom-db'
      });
      const { connectionMod } = freshConnection();

      expect(connectionMod.getNeo4jConfig().database).toBe('custom-db');
    });
  });

  describe('connectNeo4j validation', () => {
    it('rejects when NEO4J_URI/USERNAME/PASSWORD are missing', async () => {
      setEnv({ NODE_ENV: 'test' });
      const { connectionMod, fakeDriverPkg } = freshConnection();

      await expect(connectionMod.connectNeo4j()).rejects.toThrow(
        /NEO4J_URI, NEO4J_USERNAME e NEO4J_PASSWORD são obrigatórias/
      );
      expect(fakeDriverPkg.driver).not.toHaveBeenCalled();
    });
  });

  describe('connectNeo4j happy path', () => {
    it('creates the driver, verifies connectivity, runs a probe query, and memoizes the singleton', async () => {
      setEnv({
        NODE_ENV: 'test',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'secret'
      });
      const { connectionMod, fakeDriverPkg } = freshConnection();

      const driver1 = await connectionMod.connectNeo4j();
      expect(driver1).toBeInstanceOf(FakeDriver);
      expect(fakeDriverPkg.driver).toHaveBeenCalledTimes(1);
      expect(fakeDriverPkg.auth.basic).toHaveBeenCalledWith('neo4j', 'secret');
      expect(FakeDriver.sessions).toHaveLength(1);
      expect(FakeDriver.sessions[0].closed).toBe(true);

      const driver2 = await connectionMod.connectNeo4j();
      expect(driver2).toBe(driver1);
      // singleton path: driver() must not be called again
      expect(fakeDriverPkg.driver).toHaveBeenCalledTimes(1);
    });

    it('exposes the connected driver via getNeo4jDriver once connected', async () => {
      setEnv({
        NODE_ENV: 'test',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'secret'
      });
      const { connectionMod } = freshConnection();

      const driver = await connectionMod.connectNeo4j();
      expect(connectionMod.getNeo4jDriver()).toBe(driver);
    });
  });

  describe('getNeo4jDriver before connection', () => {
    it('throws when no connection has been established yet', () => {
      setEnv({
        NODE_ENV: 'test',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'secret'
      });
      const { connectionMod } = freshConnection();

      expect(() => connectionMod.getNeo4jDriver()).toThrow(
        /Driver indisponível para validação pré-persistência/
      );
    });
  });

  describe('connectNeo4j retry behavior', () => {
    it('retries on transient verifyConnectivity failures and eventually succeeds, logging a warning per attempt', async () => {
      setEnv({
        NODE_ENV: 'test',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'secret',
        NEO4J_CONNECT_MAX_RETRIES: '3',
        NEO4J_CONNECT_INITIAL_DELAY_MS: '1',
        NEO4J_CONNECT_MAX_DELAY_MS: '5'
      });
      const { connectionMod } = freshConnection();
      const logger = require('../../src/utils/logger');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      let calls = 0;
      FakeDriver.verifyConnectivityBehavior = () => {
        calls += 1;
        if (calls < 2) {
          return Promise.reject(new Error('connection refused'));
        }
        return Promise.resolve(true);
      };

      const driver = await connectionMod.connectNeo4j();

      expect(driver).toBeInstanceOf(FakeDriver);
      expect(calls).toBe(2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/Tentativa 1\/3 falhou/);
    });

    it('closes the driver and rejects once max retries is exhausted', async () => {
      setEnv({
        NODE_ENV: 'test',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'secret',
        NEO4J_CONNECT_MAX_RETRIES: '2',
        NEO4J_CONNECT_INITIAL_DELAY_MS: '1',
        NEO4J_CONNECT_MAX_DELAY_MS: '5'
      });
      const { connectionMod } = freshConnection();
      const logger = require('../../src/utils/logger');
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      FakeDriver.verifyConnectivityBehavior = () => Promise.reject(new Error('always down'));

      await expect(connectionMod.connectNeo4j()).rejects.toThrow('always down');

      expect(FakeDriver.instances).toHaveLength(1);
      expect(FakeDriver.instances[0].closed).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Falha de conexão que impacta cadeia de custódia'),
        'always down'
      );

      // A subsequent call must be able to retry from scratch (connectingPromise was cleared).
      FakeDriver.verifyConnectivityBehavior = () => Promise.resolve(true);
      const driver = await connectionMod.connectNeo4j();
      expect(driver).toBeInstanceOf(FakeDriver);
      expect(FakeDriver.instances).toHaveLength(2);
    });
  });

  describe('closeNeo4jConnection', () => {
    it('no-ops when no driver was ever connected', async () => {
      setEnv({
        NODE_ENV: 'test',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'secret'
      });
      const { connectionMod } = freshConnection();

      await expect(connectionMod.closeNeo4jConnection()).resolves.toBeUndefined();
    });

    it('closes the driver, nulls the singleton, and logs success', async () => {
      setEnv({
        NODE_ENV: 'test',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USERNAME: 'neo4j',
        NEO4J_PASSWORD: 'secret'
      });
      const { connectionMod } = freshConnection();
      const logger = require('../../src/utils/logger');
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

      const driver = await connectionMod.connectNeo4j();
      await connectionMod.closeNeo4jConnection();

      expect(driver.closed).toBe(true);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Conexão encerrada com sucesso')
      );
      // getNeo4jDriver should reflect that the singleton was cleared.
      expect(() => connectionMod.getNeo4jDriver()).toThrow();
    });
  });
});
