import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MONGO_MODULE_PATH = require.resolve('../../src/database/mongo');
const ENV_MODULE_PATH = require.resolve('../../src/config/env');

/**
 * mongo.js does `const { MongoClient } = require('mongodb')` at module top-level
 * (CommonJS require, not ESM import), so vi.mock() cannot intercept it. Instead we
 * monkeypatch the exported MongoClient on the shared 'mongodb' module object
 * *before* clearing mongo.js's require cache entry and re-requiring it, so the
 * fresh require() picks up our fake constructor via the destructure.
 */
const mongodbModule = require('mongodb');
const realMongoClient = mongodbModule.MongoClient;

/** Tracks constructor calls: { uri, options } */
let constructedWith = [];

class FakeClientInstance {
  constructor(uri, options) {
    this.uri = uri;
    this.options = options;
    this._connected = false;
    constructedWith.push({ uri, options });
  }

  async connect() {
    if (FakeClientInstance.connectBehavior) {
      await FakeClientInstance.connectBehavior(this);
    }
    this._connected = true;
    return this;
  }

  async close() {
    this._connected = false;
  }

  db(name) {
    return { __dbName: name, command: vi.fn() };
  }
}
FakeClientInstance.connectBehavior = null;

function installFakeMongoClient() {
  constructedWith = [];
  FakeClientInstance.connectBehavior = null;
  // 'mongodb' exposes MongoClient as a getter-only export (CJS/ESM interop),
  // so a plain assignment throws; redefine the property instead.
  function FakeMongoClientCtor(uri, options) {
    return new FakeClientInstance(uri, options);
  }
  Object.defineProperty(mongodbModule, 'MongoClient', {
    value: vi.fn(FakeMongoClientCtor),
    writable: true,
    configurable: true,
  });
}

function freshMongo() {
  delete require.cache[MONGO_MODULE_PATH];
  installFakeMongoClient();
  // eslint-disable-next-line global-require
  return require('../../src/database/mongo');
}

function freshEnv() {
  delete require.cache[ENV_MODULE_PATH];
  // eslint-disable-next-line global-require
  return require('../../src/config/env');
}

describe('database/mongo.js', () => {
  let env;

  beforeEach(() => {
    env = freshEnv();
  });

  afterEach(() => {
    delete require.cache[MONGO_MODULE_PATH];
    Object.defineProperty(mongodbModule, 'MongoClient', {
      value: realMongoClient,
      writable: true,
      configurable: true,
    });
    delete process.env.ALLOW_CLOUD_INTEGRATIONS;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------
  // ensureMongoUri (exercised indirectly through connectDB, by inspecting
  // the URI passed into the MongoClient constructor)
  // ---------------------------------------------------------------------
  describe('ensureMongoUri (via connectDB URI construction)', () => {
    it('appends the db name when the URI has no path segment', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();

      expect(constructedWith).toHaveLength(1);
      const uri = constructedWith[0].uri;
      expect(uri.startsWith('mongodb://localhost:27017/mydb?')).toBe(true);
    });

    it('appends the db name when the URI path is just a trailing slash', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();

      const uri = constructedWith[0].uri;
      expect(uri.startsWith('mongodb://localhost:27017/mydb?')).toBe(true);
    });

    it('leaves an existing db path segment untouched', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/existingdb';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();

      const uri = constructedWith[0].uri;
      expect(uri.startsWith('mongodb://localhost:27017/existingdb?')).toBe(true);
      expect(uri).not.toContain('/mydb');
    });

    it('sets default retryWrites/w/tls=false query params for mongodb:// when absent', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();

      const uri = constructedWith[0].uri;
      const query = new URLSearchParams(uri.split('?')[1]);
      expect(query.get('retryWrites')).toBe('true');
      expect(query.get('w')).toBe('majority');
      expect(query.get('tls')).toBe('false');
    });

    it('sets tls=true by default for mongodb+srv:// URIs', async () => {
      env.MONGO_URI = 'mongodb+srv://cluster0.example.mongodb.net/mydb';
      env.MONGO_DB = 'mydb';
      env.ALLOW_CLOUD_INTEGRATIONS = true;
      const mongo = freshMongo();

      await mongo.connectDB();

      const uri = constructedWith[0].uri;
      const query = new URLSearchParams(uri.split('?')[1]);
      expect(query.get('tls')).toBe('true');
    });

    it('preserves caller-provided query params instead of overwriting them', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb?retryWrites=false&w=1&tls=true&appName=custom';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();

      const uri = constructedWith[0].uri;
      const query = new URLSearchParams(uri.split('?')[1]);
      expect(query.get('retryWrites')).toBe('false');
      expect(query.get('w')).toBe('1');
      expect(query.get('tls')).toBe('true');
      expect(query.get('appName')).toBe('custom');
    });

    it('does not set tls when ssl param is already present', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb?ssl=false';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();

      const uri = constructedWith[0].uri;
      const query = new URLSearchParams(uri.split('?')[1]);
      expect(query.has('tls')).toBe(false);
      expect(query.get('ssl')).toBe('false');
    });
  });

  // ---------------------------------------------------------------------
  // assertLocalMongoUri (exercised via connectDB / connectNewDB throw behavior)
  // ---------------------------------------------------------------------
  describe('assertLocalMongoUri (cloud URI guard)', () => {
    it('throws for mongodb+srv:// when ALLOW_CLOUD_INTEGRATIONS is not set', async () => {
      env.MONGO_URI = 'mongodb+srv://cluster0.example.mongodb.net/mydb';
      env.MONGO_DB = 'mydb';
      env.ALLOW_CLOUD_INTEGRATIONS = false;
      const mongo = freshMongo();

      await expect(mongo.connectDB()).rejects.toThrow(/mongodb\+srv/);
      expect(constructedWith).toHaveLength(0);
    });

    it('allows mongodb+srv:// when env.ALLOW_CLOUD_INTEGRATIONS is truthy', async () => {
      env.MONGO_URI = 'mongodb+srv://cluster0.example.mongodb.net/mydb';
      env.MONGO_DB = 'mydb';
      env.ALLOW_CLOUD_INTEGRATIONS = true;
      const mongo = freshMongo();

      await expect(mongo.connectDB()).resolves.toBeDefined();
      expect(constructedWith).toHaveLength(1);
    });

    it('allows mongodb+srv:// when process.env.ALLOW_CLOUD_INTEGRATIONS=true even if env.ALLOW_CLOUD_INTEGRATIONS is false', async () => {
      env.MONGO_URI = 'mongodb+srv://cluster0.example.mongodb.net/mydb';
      env.MONGO_DB = 'mydb';
      env.ALLOW_CLOUD_INTEGRATIONS = false;
      process.env.ALLOW_CLOUD_INTEGRATIONS = 'true';
      const mongo = freshMongo();

      await expect(mongo.connectDB()).resolves.toBeDefined();
    });

    it('allows a plain mongodb:// URI regardless of ALLOW_CLOUD_INTEGRATIONS', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb';
      env.MONGO_DB = 'mydb';
      env.ALLOW_CLOUD_INTEGRATIONS = false;
      const mongo = freshMongo();

      await expect(mongo.connectDB()).resolves.toBeDefined();
      expect(constructedWith).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------
  // encodeMongoURI (exercised via the URI actually passed to MongoClient)
  // ---------------------------------------------------------------------
  describe('encodeMongoURI (password encoding via connectDB)', () => {
    it('URL-encodes a plaintext password containing special characters', async () => {
      env.MONGO_URI = 'mongodb://user:p#ss$word@localhost:27017/mydb';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();

      const uri = constructedWith[0].uri;
      expect(uri).toContain(encodeURIComponent('p#ss$word'));
      expect(uri).not.toContain('p#ss$word@');
    });

    it('leaves an already-encoded password untouched', async () => {
      const encodedPassword = encodeURIComponent('p#ss$word'); // contains %23 %24
      env.MONGO_URI = `mongodb://user:${encodedPassword}@localhost:27017/mydb`;
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();

      const uri = constructedWith[0].uri;
      // password segment should be identical to what was supplied (not double-encoded)
      expect(uri).toContain(`user:${encodedPassword}@`);
    });

    it('passes a URI without credentials through unchanged (aside from ensureMongoUri defaults)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();

      const uri = constructedWith[0].uri;
      expect(uri.startsWith('mongodb://localhost:27017/mydb?')).toBe(true);
      expect(uri).not.toContain('@');
    });
  });

  // ---------------------------------------------------------------------
  // connectDB - missing env var guard clauses
  // ---------------------------------------------------------------------
  describe('connectDB missing-env-var guards', () => {
    it('throws a clear error when MONGO_URI is missing', async () => {
      env.MONGO_URI = undefined;
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await expect(mongo.connectDB()).rejects.toThrow(/MONGO_URI não está definida/);
      expect(constructedWith).toHaveLength(0);
    });

    it('throws a clear error when MONGO_DB is missing', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017';
      env.MONGO_DB = undefined;
      const mongo = freshMongo();

      await expect(mongo.connectDB()).rejects.toThrow(/MONGO_DB não está definida/);
      expect(constructedWith).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // connectNewDB - missing env var guard clauses
  // ---------------------------------------------------------------------
  describe('connectNewDB missing-env-var guards', () => {
    it('throws a clear error when MONGO_URI is missing', async () => {
      env.MONGO_URI = undefined;
      env.MONGO_DB_NOVO = 'novodb';
      const mongo = freshMongo();

      await expect(mongo.connectNewDB()).rejects.toThrow(/MONGO_URI não está definida/);
      expect(constructedWith).toHaveLength(0);
    });

    it('throws a clear error when MONGO_DB_NOVO is missing', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb';
      env.MONGO_DB_NOVO = undefined;
      const mongo = freshMongo();

      await expect(mongo.connectNewDB()).rejects.toThrow(/MONGO_DB_NOVO não está definida/);
      expect(constructedWith).toHaveLength(0);
    });

    it('throws the cloud-URI guard error for mongodb+srv:// without ALLOW_CLOUD_INTEGRATIONS', async () => {
      env.MONGO_URI = 'mongodb+srv://cluster0.example.mongodb.net/mydb';
      env.MONGO_DB_NOVO = 'novodb';
      env.ALLOW_CLOUD_INTEGRATIONS = false;
      const mongo = freshMongo();

      await expect(mongo.connectNewDB()).rejects.toThrow(/mongodb\+srv/);
    });

    it('successfully connects and returns the new db when everything is set', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb';
      env.MONGO_DB_NOVO = 'novodb';
      const mongo = freshMongo();

      const result = await mongo.connectNewDB();

      expect(result).toBeDefined();
      expect(result.__dbName).toBe('novodb');
    });
  });

  // ---------------------------------------------------------------------
  // connectDB - connection reuse / retry behavior (stretch coverage)
  // ---------------------------------------------------------------------
  describe('connectDB connection lifecycle', () => {
    it('reuses an existing live connection instead of reconnecting (ping succeeds)', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      const first = await mongo.connectDB();
      expect(constructedWith).toHaveLength(1);

      // Make the ping succeed on the "admin" db command
      const originalDb = FakeClientInstance.prototype.db;
      FakeClientInstance.prototype.db = function (name) {
        return { __dbName: name, command: vi.fn().mockResolvedValue({ ok: 1 }) };
      };

      const second = await mongo.connectDB();
      expect(constructedWith).toHaveLength(1); // no new client constructed
      expect(second).toBe(first);

      FakeClientInstance.prototype.db = originalDb;
    });

    it('reconnects when the ping on an existing connection fails', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();
      expect(constructedWith).toHaveLength(1);

      const originalDb = FakeClientInstance.prototype.db;
      FakeClientInstance.prototype.db = function (name) {
        return {
          __dbName: name,
          command: vi.fn().mockRejectedValue(new Error('ping failed: connection dead')),
        };
      };

      await mongo.connectDB();
      expect(constructedWith).toHaveLength(2); // reconnected with a fresh client

      FakeClientInstance.prototype.db = originalDb;
    });

    it('retries with the unencoded URI when the first attempt fails with an authentication error', async () => {
      env.MONGO_URI = 'mongodb://user:p#ss$word@localhost:27017/mydb';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      let attempt = 0;
      FakeClientInstance.connectBehavior = async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error('Authentication failed');
        }
      };

      const result = await mongo.connectDB();

      expect(result).toBeDefined();
      expect(constructedWith).toHaveLength(2);
      // Retry attempt uses the normalized-but-not-password-encoded URI
      expect(constructedWith[1].uri).toContain('p#ss$word@');
    });

    it('propagates a non-authentication connection error without retrying', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      FakeClientInstance.connectBehavior = async () => {
        throw new Error('ECONNREFUSED');
      };

      await expect(mongo.connectDB()).rejects.toThrow('ECONNREFUSED');
      expect(constructedWith).toHaveLength(1); // no retry attempt for non-auth errors
    });
  });

  // ---------------------------------------------------------------------
  // closeConnection
  // ---------------------------------------------------------------------
  describe('closeConnection', () => {
    it('closes an active client connection', async () => {
      env.MONGO_URI = 'mongodb://localhost:27017/mydb';
      env.MONGO_DB = 'mydb';
      const mongo = freshMongo();

      await mongo.connectDB();
      await expect(mongo.closeConnection()).resolves.toBeUndefined();
    });

    it('is a no-op when there is no active client', async () => {
      const mongo = freshMongo();
      await expect(mongo.closeConnection()).resolves.toBeUndefined();
    });
  });
});
