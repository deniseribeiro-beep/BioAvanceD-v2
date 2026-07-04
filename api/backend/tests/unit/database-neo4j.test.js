import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MODULE_PATH = require.resolve('../../src/database/neo4j');
const NEO4J_DRIVER_MODULE_PATH = require.resolve('neo4j-driver');
require('neo4j-driver'); // ensure it's populated in require.cache before we mutate it

const realNeo4jDriverExports = require.cache[NEO4J_DRIVER_MODULE_PATH].exports;

/**
 * src/database/neo4j.js does `const neo4j = require('neo4j-driver')` and calls
 * `neo4j.driver(...)` / `neo4j.auth.basic(...)` without destructuring, so we can
 * replace the cached module's `exports` with a fake before re-requiring the
 * module under test, mirroring tests/unit/neo4j-connection.test.js.
 */
function installFakeNeo4jDriverPkg() {
  const fakeModule = {
    driver: vi.fn((...args) => ({ _args: args, fake: true })),
    auth: {
      basic: vi.fn((username, password) => ({ scheme: 'basic', principal: username, credentials: password })),
    },
  };
  require.cache[NEO4J_DRIVER_MODULE_PATH].exports = fakeModule;
  return fakeModule;
}

function restoreRealNeo4jDriverPkg() {
  require.cache[NEO4J_DRIVER_MODULE_PATH].exports = realNeo4jDriverExports;
}

function freshModule() {
  delete require.cache[MODULE_PATH];
  const fakeDriverPkg = installFakeNeo4jDriverPkg();
  // eslint-disable-next-line global-require
  const mod = require('../../src/database/neo4j');
  return { mod, fakeDriverPkg };
}

const ORIGINAL_ENV = { ...process.env };

describe('src/database/neo4j.js', () => {
  beforeEach(() => {
    Object.keys(process.env)
      .filter((k) => k.startsWith('NEO4J_'))
      .forEach((k) => delete process.env[k]);
  });

  afterEach(() => {
    delete require.cache[MODULE_PATH];
    restoreRealNeo4jDriverPkg();
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('builds the driver from NEO4J_URI/USERNAME/PASSWORD when set', () => {
    process.env.NEO4J_URI = 'bolt://custom-host:7687';
    process.env.NEO4J_USERNAME = 'custom-user';
    process.env.NEO4J_PASSWORD = 'custom-pass';
    const { mod, fakeDriverPkg } = freshModule();

    mod.getNeo4jDriver();

    expect(fakeDriverPkg.auth.basic).toHaveBeenCalledWith('custom-user', 'custom-pass');
    expect(fakeDriverPkg.driver).toHaveBeenCalledWith(
      'bolt://custom-host:7687',
      { scheme: 'basic', principal: 'custom-user', credentials: 'custom-pass' }
    );
  });

  it('falls back to default URI/username/password when env vars are unset', () => {
    const { mod, fakeDriverPkg } = freshModule();

    mod.getNeo4jDriver();

    expect(fakeDriverPkg.auth.basic).toHaveBeenCalledWith('neo4j', 'password');
    expect(fakeDriverPkg.driver).toHaveBeenCalledWith(
      'bolt://localhost:7687',
      expect.any(Object)
    );
  });

  it('memoizes the driver as a singleton across calls', () => {
    process.env.NEO4J_URI = 'bolt://custom-host:7687';
    process.env.NEO4J_USERNAME = 'custom-user';
    process.env.NEO4J_PASSWORD = 'custom-pass';
    const { mod, fakeDriverPkg } = freshModule();

    const first = mod.getNeo4jDriver();
    const second = mod.getNeo4jDriver();

    expect(second).toBe(first);
    expect(fakeDriverPkg.driver).toHaveBeenCalledTimes(1);
  });
});
