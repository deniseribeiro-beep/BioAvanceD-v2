import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const CONNECTION_MODULE_PATH = require.resolve('../../src/infrastructure/database/influxdb/connection');
const ENV_MODULE_PATH = require.resolve('../../src/config/env');
const INFLUXDB_CLIENT_MODULE_PATH = require.resolve('@influxdata/influxdb-client');
require('@influxdata/influxdb-client'); // ensure it's populated in require.cache before we mutate it

const realInfluxDbClientExports = require.cache[INFLUXDB_CLIENT_MODULE_PATH].exports;

/**
 * connection.js does `const { InfluxDB } = require('@influxdata/influxdb-client')`
 * (destructured at module-load time), so we replace the cached module's
 * `exports.InfluxDB` before connection.js is re-required, mirroring the
 * mechanic in neo4j-connection.test.js / redis.test.js.
 */
class FakeQueryApi {
  constructor(org) {
    this.org = org;
  }

  async collectRows(query) {
    this._lastQuery = query;
    if (FakeQueryApi.collectRowsBehavior) return FakeQueryApi.collectRowsBehavior(query);
    return [];
  }
}
FakeQueryApi.collectRowsBehavior = null;

class FakeWriteApi {
  constructor(org, bucket, precision) {
    this.org = org;
    this.bucket = bucket;
    this.precision = precision;
  }
}

class FakeInfluxDB {
  constructor(options) {
    this._options = options;
    FakeInfluxDB.instances.push(this);
  }

  getQueryApi(org) {
    const api = new FakeQueryApi(org);
    FakeInfluxDB.queryApis.push(api);
    return api;
  }

  getWriteApi(org, bucket, precision) {
    const api = new FakeWriteApi(org, bucket, precision);
    FakeInfluxDB.writeApis.push(api);
    return api;
  }
}
FakeInfluxDB.instances = [];
FakeInfluxDB.queryApis = [];
FakeInfluxDB.writeApis = [];

function installFakeInfluxDbClientPkg() {
  FakeInfluxDB.instances = [];
  FakeInfluxDB.queryApis = [];
  FakeInfluxDB.writeApis = [];
  FakeQueryApi.collectRowsBehavior = null;

  const fakeModule = {
    ...realInfluxDbClientExports,
    InfluxDB: vi.fn(function InfluxDBCtor(options) {
      return new FakeInfluxDB(options);
    })
  };
  require.cache[INFLUXDB_CLIENT_MODULE_PATH].exports = fakeModule;
  return fakeModule;
}

function restoreRealInfluxDbClientPkg() {
  require.cache[INFLUXDB_CLIENT_MODULE_PATH].exports = realInfluxDbClientExports;
}

function freshConnection() {
  delete require.cache[CONNECTION_MODULE_PATH];
  const fakeClientPkg = installFakeInfluxDbClientPkg();
  // eslint-disable-next-line global-require
  const connectionMod = require('../../src/infrastructure/database/influxdb/connection');
  return { connectionMod, fakeClientPkg };
}

function setEnv(vars) {
  delete require.cache[ENV_MODULE_PATH];
  Object.keys(process.env)
    .filter((k) => k.startsWith('INFLUXDB_') || k === 'NODE_ENV')
    .forEach((k) => delete process.env[k]);
  Object.entries(vars).forEach(([k, v]) => {
    if (v === undefined) return;
    process.env[k] = String(v);
  });
}

const ORIGINAL_ENV = { ...process.env };

const FULL_ENV = {
  NODE_ENV: 'test',
  INFLUXDB_URL: 'http://localhost:8086',
  INFLUXDB_TOKEN: 'super-secret-token',
  INFLUXDB_ORG: 'bioavance-org',
  INFLUXDB_BUCKET: 'telemetry-bucket'
};

describe('infrastructure/database/influxdb/connection.js', () => {
  afterEach(() => {
    delete require.cache[CONNECTION_MODULE_PATH];
    delete require.cache[ENV_MODULE_PATH];
    restoreRealInfluxDbClientPkg();
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe('getInfluxConfig', () => {
    it('builds the config object from env vars', () => {
      setEnv(FULL_ENV);
      const { connectionMod } = freshConnection();

      expect(connectionMod.getInfluxConfig()).toEqual({
        url: 'http://localhost:8086',
        token: 'super-secret-token',
        org: 'bioavance-org',
        bucket: 'telemetry-bucket'
      });
    });
  });

  describe('connectInfluxDB validation', () => {
    it('rejects when all env vars are missing', async () => {
      setEnv({ NODE_ENV: 'test' });
      const { connectionMod, fakeClientPkg } = freshConnection();

      await expect(connectionMod.connectInfluxDB()).rejects.toThrow(
        /INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG e INFLUXDB_BUCKET são obrigatórias/
      );
      expect(fakeClientPkg.InfluxDB).not.toHaveBeenCalled();
    });

    it('rejects when only INFLUXDB_URL is missing', async () => {
      setEnv({ ...FULL_ENV, INFLUXDB_URL: undefined });
      const { connectionMod } = freshConnection();

      await expect(connectionMod.connectInfluxDB()).rejects.toThrow(
        /INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG e INFLUXDB_BUCKET são obrigatórias/
      );
    });

    it('rejects when only INFLUXDB_TOKEN is missing', async () => {
      setEnv({ ...FULL_ENV, INFLUXDB_TOKEN: undefined });
      const { connectionMod } = freshConnection();

      await expect(connectionMod.connectInfluxDB()).rejects.toThrow(
        /INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG e INFLUXDB_BUCKET são obrigatórias/
      );
    });

    it('rejects when only INFLUXDB_ORG is missing', async () => {
      setEnv({ ...FULL_ENV, INFLUXDB_ORG: undefined });
      const { connectionMod } = freshConnection();

      await expect(connectionMod.connectInfluxDB()).rejects.toThrow(
        /INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG e INFLUXDB_BUCKET são obrigatórias/
      );
    });

    it('rejects when only INFLUXDB_BUCKET is missing', async () => {
      setEnv({ ...FULL_ENV, INFLUXDB_BUCKET: undefined });
      const { connectionMod } = freshConnection();

      await expect(connectionMod.connectInfluxDB()).rejects.toThrow(
        /INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG e INFLUXDB_BUCKET são obrigatórias/
      );
    });
  });

  describe('connectInfluxDB happy path', () => {
    it('creates the client, runs a bucket probe query, memoizes the singleton, and logs success', async () => {
      setEnv(FULL_ENV);
      const { connectionMod, fakeClientPkg } = freshConnection();
      const logger = require('../../src/utils/logger');
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

      const client1 = await connectionMod.connectInfluxDB();
      expect(client1).toBeInstanceOf(FakeInfluxDB);
      expect(fakeClientPkg.InfluxDB).toHaveBeenCalledTimes(1);
      expect(fakeClientPkg.InfluxDB).toHaveBeenCalledWith({
        url: 'http://localhost:8086',
        token: 'super-secret-token'
      });
      expect(FakeInfluxDB.queryApis).toHaveLength(1);
      expect(FakeInfluxDB.queryApis[0]._lastQuery).toContain('telemetry-bucket');
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Conexão validada para telemetria')
      );

      const client2 = await connectionMod.connectInfluxDB();
      expect(client2).toBe(client1);
      // singleton path: the InfluxDB constructor must not be invoked again
      expect(fakeClientPkg.InfluxDB).toHaveBeenCalledTimes(1);
    });
  });

  describe('connectInfluxDB probe-query failure path', () => {
    it('logs and rejects when the bucket probe query throws, without memoizing a client', async () => {
      setEnv(FULL_ENV);
      const { connectionMod } = freshConnection();
      const logger = require('../../src/utils/logger');
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      FakeQueryApi.collectRowsBehavior = () => Promise.reject(new Error('bucket not found'));

      await expect(connectionMod.connectInfluxDB()).rejects.toThrow('bucket not found');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Falha de conexão que compromete histórico temporal'),
        'bucket not found'
      );

      // singleton must remain unset so a subsequent call retries from scratch
      expect(() => connectionMod.getInfluxClient()).toThrow(/Cliente indisponível/);
    });
  });

  describe('getInfluxClient before connection', () => {
    it('throws when no connection has been established yet', () => {
      setEnv(FULL_ENV);
      const { connectionMod } = freshConnection();

      expect(() => connectionMod.getInfluxClient()).toThrow(/Cliente indisponível/);
    });

    it('returns the connected client once connected', async () => {
      setEnv(FULL_ENV);
      const { connectionMod } = freshConnection();

      const client = await connectionMod.connectInfluxDB();
      expect(connectionMod.getInfluxClient()).toBe(client);
    });
  });

  describe('getInfluxQueryApi / getInfluxWriteApi', () => {
    it('delegates to the connected client.getQueryApi with the configured org', async () => {
      setEnv(FULL_ENV);
      const { connectionMod } = freshConnection();

      await connectionMod.connectInfluxDB();
      const beforeCount = FakeInfluxDB.queryApis.length;
      const queryApi = connectionMod.getInfluxQueryApi();

      expect(FakeInfluxDB.queryApis).toHaveLength(beforeCount + 1);
      expect(queryApi.org).toBe('bioavance-org');
    });

    it('delegates to the connected client.getWriteApi with the configured org, bucket, and ns precision', async () => {
      setEnv(FULL_ENV);
      const { connectionMod } = freshConnection();

      await connectionMod.connectInfluxDB();
      const writeApi = connectionMod.getInfluxWriteApi();

      expect(writeApi.org).toBe('bioavance-org');
      expect(writeApi.bucket).toBe('telemetry-bucket');
      expect(writeApi.precision).toBe('ns');
    });

    it('throws via getInfluxClient when not connected', () => {
      setEnv(FULL_ENV);
      const { connectionMod } = freshConnection();

      expect(() => connectionMod.getInfluxQueryApi()).toThrow(/Cliente indisponível/);
      expect(() => connectionMod.getInfluxWriteApi()).toThrow(/Cliente indisponível/);
    });
  });

  describe('closeInfluxDBConnection', () => {
    it('resets the singleton and logs success, even if no client was ever connected', async () => {
      setEnv(FULL_ENV);
      const { connectionMod } = freshConnection();
      const logger = require('../../src/utils/logger');
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

      await connectionMod.closeInfluxDBConnection();

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cliente liberado com sucesso')
      );
      expect(() => connectionMod.getInfluxClient()).toThrow(/Cliente indisponível/);
    });

    it('clears an established connection so getInfluxClient throws afterwards', async () => {
      setEnv(FULL_ENV);
      const { connectionMod } = freshConnection();

      await connectionMod.connectInfluxDB();
      expect(connectionMod.getInfluxClient()).toBeInstanceOf(FakeInfluxDB);

      await connectionMod.closeInfluxDBConnection();

      expect(() => connectionMod.getInfluxClient()).toThrow(/Cliente indisponível/);
    });
  });
});
