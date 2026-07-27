import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const scriptPath = require.resolve('../../src/scripts/testEnvironment');
const mongoPath = require.resolve('../../src/database/mongo');
const neo4jPath = require.resolve('../../src/infrastructure/database/neo4j/connection');
const ioredisPath = require.resolve('ioredis');

const realMongo = require('../../src/database/mongo');
const realNeo4j = require('../../src/infrastructure/database/neo4j/connection');
require('ioredis');

const originalConnectDB = realMongo.connectDB;
const originalCloseConnection = realMongo.closeConnection;
const originalConnectNeo4j = realNeo4j.connectNeo4j;
const originalCloseNeo4j = realNeo4j.closeNeo4jConnection;
const originalIoredisRecord = require.cache[ioredisPath];
const originalEnv = { ...process.env };

const validEnv = {
  NODE_ENV: 'test',
  TEST_ENVIRONMENT: 'true',
  MONGO_DB: 'bioavanced_test',
  MONGO_DB_NOVO: 'bioavanced_test',
  NEO4J_DATABASE: 'bioavanced_test',
  INFLUXDB_ORG: 'bioavanced-test',
  INFLUXDB_BUCKET: 'bioavanced-test',
  SMTP_HOST: 'smtp-test',
  ALLOWED_ORIGINS: 'http://frontend-test:5173',
  MONGO_URI: 'mongodb://mongodb-test:27017/db',
  NEO4J_URI: 'bolt://neo4j-test:7687',
  NEO4J_USERNAME: 'neo4j',
  NEO4J_PASSWORD: 'secretpass',
  REDIS_URL: 'redis://redis-test:6379',
  INFLUXDB_URL: 'http://influxdb-test:8086',
  INFLUXDB_TOKEN: 'tok',
  MQTT_URL: 'mqtt://mqtt-test:1883',
  JWT_SECRET: 's1',
  JWT_REFRESH_SECRET: 's2',
  USER_ANON_SALT: 'salt',
  CONSENT_SECRET: 'consent',
};

function setEnv(overrides = {}) {
  process.env = { ...originalEnv, ...validEnv, ...overrides };
}

function setEnvMissingAll() {
  process.env = { ...originalEnv };
  for (const key of Object.keys(validEnv)) delete process.env[key];
}

function loadScript() {
  delete require.cache[scriptPath];
  return require('../../src/scripts/testEnvironment');
}

function mockMongoForCleanup(collections) {
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 0 });
  const collection = vi.fn().mockReturnValue({ deleteMany });
  const toArray = vi.fn().mockResolvedValue(collections);
  const listCollections = vi.fn().mockReturnValue({ toArray });
  const db = { listCollections, collection };
  realMongo.connectDB = vi.fn().mockResolvedValue(db);
  realMongo.closeConnection = vi.fn().mockResolvedValue(undefined);
  return { db, listCollections, collection, deleteMany };
}

function mockMongoForReset() {
  const dropDatabase = vi.fn().mockResolvedValue(undefined);
  const db = { dropDatabase };
  realMongo.connectDB = vi.fn().mockResolvedValue(db);
  realMongo.closeConnection = vi.fn().mockResolvedValue(undefined);
  return { db, dropDatabase };
}

function mockNeo4j() {
  const run = vi.fn().mockResolvedValue({});
  const closeSession = vi.fn().mockResolvedValue(undefined);
  const session = vi.fn().mockReturnValue({ run, close: closeSession });
  const driver = { session };
  realNeo4j.connectNeo4j = vi.fn().mockResolvedValue(driver);
  realNeo4j.closeNeo4jConnection = vi.fn().mockResolvedValue(undefined);
  return { driver, session, run, closeSession };
}

function mockIoredis() {
  const flushdb = vi.fn().mockResolvedValue('OK');
  const quit = vi.fn().mockResolvedValue('OK');
  function FakeRedis(url) {
    this.url = url;
    this.flushdb = flushdb;
    this.quit = quit;
  }
  require.cache[ioredisPath] = {
    id: ioredisPath,
    filename: ioredisPath,
    loaded: true,
    exports: FakeRedis,
  };
  return { flushdb, quit, FakeRedis };
}

describe('scripts/testEnvironment', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    realMongo.connectDB = originalConnectDB;
    realMongo.closeConnection = originalCloseConnection;
    realNeo4j.connectNeo4j = originalConnectNeo4j;
    realNeo4j.closeNeo4jConnection = originalCloseNeo4j;
    require.cache[ioredisPath] = originalIoredisRecord;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete require.cache[scriptPath];
  });

  describe('ensureTestEnvironment guard (via cleanupSyntheticData/resetTestEnvironment)', () => {
    it('aggregates every missing env var into one thrown error, prefixed by the action', async () => {
      setEnvMissingAll();
      const mod = loadScript();

      await expect(mod.cleanupSyntheticData()).rejects.toThrow(
        /\[CLEANUP\] Unsafe test environment/,
      );
      await expect(mod.cleanupSyntheticData()).rejects.toThrow(/NODE_ENV must be test/);
      await expect(mod.cleanupSyntheticData()).rejects.toThrow(/MONGO_URI is required/);
      await expect(mod.cleanupSyntheticData()).rejects.toThrow(/NEO4J_URI is required/);
      await expect(mod.cleanupSyntheticData()).rejects.toThrow(/REDIS_URL is required/);
      await expect(mod.cleanupSyntheticData()).rejects.toThrow(/INFLUXDB_URL is required/);
      await expect(mod.cleanupSyntheticData()).rejects.toThrow(/MQTT_URL is required/);
      await expect(mod.cleanupSyntheticData()).rejects.toThrow(/JWT_SECRET is required/);
    });

    it('uses the RESET prefix for resetTestEnvironment', async () => {
      setEnvMissingAll();
      const mod = loadScript();

      await expect(mod.resetTestEnvironment()).rejects.toThrow(/\[RESET\] Unsafe test environment/);
    });

    it('rejects a MONGO_URI pointing at a non-test host', async () => {
      setEnv({ MONGO_URI: 'mongodb://production-host:27017/db' });
      const mod = loadScript();

      await expect(mod.cleanupSyntheticData()).rejects.toThrow(/MONGO_URI must point to mongodb-test/);
    });

    it('rejects a MONGO_URI using localhost even if otherwise well-formed', async () => {
      setEnv({ MONGO_URI: 'mongodb://localhost:27017/db' });
      const mod = loadScript();

      await expect(mod.cleanupSyntheticData()).rejects.toThrow(/MONGO_URI must not use localhost/);
    });

    it('rejects a malformed MONGO_URI', async () => {
      setEnv({ MONGO_URI: 'not a valid url' });
      const mod = loadScript();

      await expect(mod.cleanupSyntheticData()).rejects.toThrow(/MONGO_URI must be a valid URL/);
    });

    it('rejects NEO4J_URI/REDIS_URL/INFLUXDB_URL/MQTT_URL pointing at disallowed hosts', async () => {
      setEnv({
        NEO4J_URI: 'bolt://prod-neo4j:7687',
        REDIS_URL: 'redis://prod-redis:6379',
        INFLUXDB_URL: 'http://prod-influx:8086',
        MQTT_URL: 'mqtt://prod-mqtt:1883',
      });
      const mod = loadScript();

      const error = await mod.cleanupSyntheticData().catch((e) => e);
      expect(error.message).toMatch(/NEO4J_URI must use one of the test hosts: neo4j-test/);
      expect(error.message).toMatch(/REDIS_URL must use one of the test hosts: redis-test/);
      expect(error.message).toMatch(/INFLUXDB_URL must use one of the test hosts: influxdb-test/);
      expect(error.message).toMatch(/MQTT_URL must use one of the test hosts: mqtt-test/);
    });

    it('rejects an ALLOWED_ORIGINS entry that is not the frontend-test host', async () => {
      setEnv({ ALLOWED_ORIGINS: 'http://frontend-test:5173,https://evil.example.com' });
      const mod = loadScript();

      await expect(mod.cleanupSyntheticData()).rejects.toThrow(
        /ALLOWED_ORIGINS must contain only frontend-test origins/,
      );
    });

    it('does not call connectDB when the environment guard rejects', async () => {
      setEnvMissingAll();
      const connectDB = vi.fn();
      realMongo.connectDB = connectDB;
      const mod = loadScript();

      await expect(mod.cleanupSyntheticData()).rejects.toThrow();
      expect(connectDB).not.toHaveBeenCalled();
    });
  });

  describe('cleanupSyntheticData', () => {
    it('deletes synthetic documents from every Mongo collection and Neo4j nodes, then closes both connections', async () => {
      setEnv();
      const { deleteMany, collection } = mockMongoForCleanup([{ name: 'users' }, { name: 'samples' }]);
      const { session, run, closeSession } = mockNeo4j();
      const mod = loadScript();

      await mod.cleanupSyntheticData();

      expect(collection).toHaveBeenCalledWith('users');
      expect(collection).toHaveBeenCalledWith('samples');
      expect(deleteMany).toHaveBeenCalledWith({
        $or: [{ source: mod.MARKER }, { synthetic: true }],
      });
      expect(session).toHaveBeenCalledWith({ database: 'bioavanced_test' });
      expect(run).toHaveBeenCalledWith('MATCH (n {source: $source}) DETACH DELETE n', {
        source: mod.MARKER,
      });
      expect(closeSession).toHaveBeenCalledTimes(1);
      expect(realMongo.closeConnection).toHaveBeenCalledTimes(1);
      expect(realNeo4j.closeNeo4jConnection).toHaveBeenCalledTimes(1);
    });

    it('still closes the Mongo connection when a collection delete fails', async () => {
      setEnv();
      const deleteMany = vi.fn().mockRejectedValue(new Error('mongo delete failed'));
      const collection = vi.fn().mockReturnValue({ deleteMany });
      const toArray = vi.fn().mockResolvedValue([{ name: 'users' }]);
      const listCollections = vi.fn().mockReturnValue({ toArray });
      realMongo.connectDB = vi.fn().mockResolvedValue({ listCollections, collection });
      realMongo.closeConnection = vi.fn().mockResolvedValue(undefined);
      mockNeo4j();
      const mod = loadScript();

      await expect(mod.cleanupSyntheticData()).rejects.toThrow('mongo delete failed');
      expect(realMongo.closeConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetTestEnvironment', () => {
    it('drops the Mongo database, wipes all Neo4j nodes, purges InfluxDB, and flushes Redis', async () => {
      setEnv();
      const { dropDatabase } = mockMongoForReset();
      const { session, run } = mockNeo4j();
      const { flushdb, quit, FakeRedis } = mockIoredis();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('') });
      vi.stubGlobal('fetch', fetchMock);
      const mod = loadScript();

      await mod.resetTestEnvironment();

      expect(dropDatabase).toHaveBeenCalledTimes(1);
      expect(session).toHaveBeenCalledWith({ database: 'bioavanced_test' });
      expect(run).toHaveBeenCalledWith('MATCH (n) DETACH DELETE n');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('/api/v2/delete');
      expect(String(url)).toContain('org=bioavanced-test');
      expect(String(url)).toContain('bucket=bioavanced-test');
      expect(options.headers.Authorization).toBe('Token tok');
      expect(flushdb).toHaveBeenCalledTimes(1);
      expect(quit).toHaveBeenCalledTimes(1);
      expect(realMongo.closeConnection).toHaveBeenCalledTimes(1);
      expect(realNeo4j.closeNeo4jConnection).toHaveBeenCalledTimes(1);
    });

    it('throws with the InfluxDB status and body when the purge request fails', async () => {
      setEnv();
      mockMongoForReset();
      mockNeo4j();
      mockIoredis();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('influx down'),
      });
      vi.stubGlobal('fetch', fetchMock);
      const mod = loadScript();

      await expect(mod.resetTestEnvironment()).rejects.toThrow(/InfluxDB reset failed: 500 influx down/);
    });
  });
});
