import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const scriptPath = require.resolve('../../src/scripts/migrateUserAnonIds');
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
  const mod = require('../../src/scripts/migrateUserAnonIds');

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
  return require('../../src/scripts/migrateUserAnonIds');
}

describe('scripts/migrateUserAnonIds', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('throws when neither MONGODB_URI nor MONGO_URI is set', async () => {
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;

    const mod = loadScriptWithoutFakeMongo();

    await expect(mod.migrateUserAnonIds()).rejects.toThrow(
      /MONGODB_URI ou MONGO_URI não encontrada/,
    );
  });

  it('falls back to MONGO_URI when MONGODB_URI is unset', async () => {
    delete process.env.MONGODB_URI;
    process.env.MONGO_URI = 'mongodb://fallback-host/db';

    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({ toArray });
    const updateOne = vi.fn();
    const collection = vi.fn().mockReturnValue({ find, updateOne });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await mod.migrateUserAnonIds();
      expect(connect).toHaveBeenCalledTimes(1);
      expect(find).toHaveBeenCalledWith({
        $or: [{ anonId: { $exists: false } }, { anonId: null }],
      });
      expect(updateOne).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('updates every user missing an anonId and closes the client', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';
    process.env.MONGODB_DB_NAME = 'custom-db';

    const users = [
      { _id: { toString: () => 'user-1' } },
      { _id: { toString: () => 'user-2' } },
    ];
    const toArray = vi.fn().mockResolvedValue(users);
    const find = vi.fn().mockReturnValue({ toArray });
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const collection = vi.fn().mockReturnValue({ find, updateOne });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await mod.migrateUserAnonIds();

      expect(db).toHaveBeenCalledWith('custom-db');
      expect(collection).toHaveBeenCalledWith('userAccounts');
      expect(updateOne).toHaveBeenCalledTimes(2);
      expect(updateOne).toHaveBeenNthCalledWith(
        1,
        { _id: users[0]._id },
        { $set: { anonId: expect.any(String) } },
      );
      expect(updateOne).toHaveBeenNthCalledWith(
        2,
        { _id: users[1]._id },
        { $set: { anonId: expect.any(String) } },
      );
      const firstAnonId = updateOne.mock.calls[0][1].$set.anonId;
      const secondAnonId = updateOne.mock.calls[1][1].$set.anonId;
      expect(firstAnonId).not.toBe(secondAnonId);
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
      await expect(mod.migrateUserAnonIds()).rejects.toThrow('mongo query failed');
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
      await expect(mod.migrateUserAnonIds()).rejects.toThrow('connection refused');
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

    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({ toArray });
    const collection = vi.fn().mockReturnValue({ find, updateOne: vi.fn() });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await mod.migrateUserAnonIds();
      expect(db).toHaveBeenCalledWith('bioadvanced');
    } finally {
      restore();
    }
  });
});
