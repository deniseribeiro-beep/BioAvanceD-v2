import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const scriptPath = require.resolve('../../src/scripts/migrateClearStaleMfaLocks');
const mongodbPath = require.resolve('mongodb');

const originalEnv = { ...process.env };

function loadScriptWithFakeMongo({ connect, db }) {
  const originalMongoModuleRecord = require.cache[mongodbPath];

  function FakeMongoClient(uri) {
    this.uri = uri;
  }
  FakeMongoClient.prototype.connect = connect;
  FakeMongoClient.prototype.db = db;
  FakeMongoClient.prototype.close = vi.fn().mockResolvedValue(undefined);

  require.cache[mongodbPath] = {
    id: mongodbPath,
    filename: mongodbPath,
    loaded: true,
    exports: { MongoClient: FakeMongoClient },
  };

  delete require.cache[scriptPath];
  const mod = require('../../src/scripts/migrateClearStaleMfaLocks');

  return {
    mod,
    FakeMongoClient,
    restore() {
      require.cache[mongodbPath] = originalMongoModuleRecord;
      delete require.cache[scriptPath];
    },
  };
}

function loadScriptWithoutFakeMongo() {
  delete require.cache[scriptPath];
  return require('../../src/scripts/migrateClearStaleMfaLocks');
}

function fakeDb(users) {
  const toArray = vi.fn().mockResolvedValue(users);
  const find = vi.fn().mockReturnValue({ toArray });
  const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const collection = vi.fn().mockReturnValue({ find, updateOne });
  return { collection, find, updateOne };
}

describe('scripts/migrateClearStaleMfaLocks', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('throws when neither MONGODB_URI nor MONGO_URI is set', async () => {
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;

    const mod = loadScriptWithoutFakeMongo();

    await expect(mod.migrateClearStaleMfaLocks()).rejects.toThrow(
      /MONGODB_URI ou MONGO_URI não encontrada/,
    );
  });

  it('does nothing when no user has mfaLocked:true', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const dbApi = fakeDb([]);
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateClearStaleMfaLocks();

      expect(result).toEqual({ usersUpdated: 0 });
      expect(dbApi.find).toHaveBeenCalledWith({ mfaLocked: true });
      expect(dbApi.updateOne).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('clears mfaLocked and mfaFailedAttempts for every locked user, leaving mfaEnabled/mfaSecret untouched', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';
    process.env.MONGODB_DB_NAME = 'custom-db';

    const users = [
      {
        _id: { toString: () => 'user-1' },
        mfaLocked: true,
        mfaFailedAttempts: 7,
        mfaEnabled: true,
        mfaSecret: 'SECRET-1',
      },
      {
        _id: { toString: () => 'user-2' },
        mfaLocked: true,
        mfaFailedAttempts: 5,
        mfaEnabled: false,
        mfaSecret: null,
      },
    ];
    const dbApi = fakeDb(users);
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateClearStaleMfaLocks();

      expect(db).toHaveBeenCalledWith('custom-db');
      expect(dbApi.collection).toHaveBeenCalledWith('users');
      expect(result).toEqual({ usersUpdated: 2 });
      expect(dbApi.updateOne).toHaveBeenCalledTimes(2);
      expect(dbApi.updateOne).toHaveBeenNthCalledWith(
        1,
        { _id: users[0]._id },
        { $set: { mfaLocked: false, mfaFailedAttempts: 0 } },
      );
      expect(dbApi.updateOne).toHaveBeenNthCalledWith(
        2,
        { _id: users[1]._id },
        { $set: { mfaLocked: false, mfaFailedAttempts: 0 } },
      );
      // mfaEnabled/mfaSecret are never part of the $set payload -- clearing
      // the lock must not disable or re-enable anyone's MFA.
      for (const call of dbApi.updateOne.mock.calls) {
        expect(call[1].$set).not.toHaveProperty('mfaEnabled');
        expect(call[1].$set).not.toHaveProperty('mfaSecret');
      }
    } finally {
      restore();
    }
  });

  it('a second run is a no-op once mfaLocked is false (idempotency via the query filter)', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    // Simulates the post-migration state: the query filter itself excludes
    // already-cleared documents, same convention as
    // migrateUserOrganizations.js's $unset-driven idempotency.
    const dbApi = fakeDb([]);
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateClearStaleMfaLocks();
      expect(result).toEqual({ usersUpdated: 0 });
      expect(dbApi.updateOne).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('propagates a query error and still closes the client', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const queryError = new Error('mongo query failed');
    const toArray = vi.fn().mockRejectedValue(queryError);
    const find = vi.fn().mockReturnValue({ toArray });
    const collection = vi.fn().mockReturnValue({ find, updateOne: vi.fn() });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await expect(mod.migrateClearStaleMfaLocks()).rejects.toThrow('mongo query failed');
    } finally {
      restore();
    }
  });

  it('still closes the client when connect() itself rejects', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const connectError = new Error('connection refused');
    const connect = vi.fn().mockRejectedValue(connectError);
    const db = vi.fn();

    const { mod, FakeMongoClient, restore } = loadScriptWithFakeMongo({ connect, db });
    const closeSpy = FakeMongoClient.prototype.close;
    try {
      await expect(mod.migrateClearStaleMfaLocks()).rejects.toThrow('connection refused');
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('defaults the db name to bioadvanced when no db-name env var is set', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';
    delete process.env.MONGODB_DB_NAME;
    delete process.env.MONGO_DB;
    delete process.env.MONGO_DB_NOVO;

    const dbApi = fakeDb([]);
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await mod.migrateClearStaleMfaLocks();
      expect(db).toHaveBeenCalledWith('bioadvanced');
    } finally {
      restore();
    }
  });
});
