import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const scriptPath = require.resolve('../../src/scripts/clearMfaLockForUser');
const mongodbPath = require.resolve('mongodb');

const originalEnv = { ...process.env };

function loadScriptWithFakeMongo({ connect, db }) {
  const originalMongoModuleRecord = require.cache[mongodbPath];
  const { ObjectId } = require('mongodb');

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
    exports: { MongoClient: FakeMongoClient, ObjectId },
  };

  delete require.cache[scriptPath];
  const mod = require('../../src/scripts/clearMfaLockForUser');

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
  return require('../../src/scripts/clearMfaLockForUser');
}

function fakeDb(user) {
  const findOne = vi.fn().mockResolvedValue(user);
  const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const collection = vi.fn().mockReturnValue({ findOne, updateOne });
  return { collection, findOne, updateOne };
}

describe('scripts/clearMfaLockForUser', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('throws when no user identifier is given (missing CLI argument)', async () => {
    const mod = loadScriptWithoutFakeMongo();

    await expect(mod.clearMfaLockForUser()).rejects.toThrow(
      /Identificador do usuário não informado/,
    );
    await expect(mod.clearMfaLockForUser('   ')).rejects.toThrow(
      /Identificador do usuário não informado/,
    );
  });

  it('throws when neither MONGODB_URI nor MONGO_URI is set', async () => {
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;

    const mod = loadScriptWithoutFakeMongo();

    await expect(mod.clearMfaLockForUser('some-id')).rejects.toThrow(
      /MONGODB_URI ou MONGO_URI não encontrada/,
    );
  });

  it('throws and reports no match when no user matches the identifier', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const dbApi = fakeDb(null);
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await expect(mod.clearMfaLockForUser('no-such-user')).rejects.toThrow(
        /Nenhum usuário encontrado para o identificador 'no-such-user'/,
      );
      expect(dbApi.updateOne).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('builds the same $or filter as user.routes.js buildUserFilterById for a plausible ObjectId', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';
    const { ObjectId } = require('mongodb');
    const hexId = new ObjectId().toString();

    const dbApi = fakeDb(null);
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await expect(mod.clearMfaLockForUser(hexId)).rejects.toThrow(/Nenhum usuário encontrado/);

      expect(dbApi.findOne).toHaveBeenCalledTimes(1);
      const filterUsed = dbApi.findOne.mock.calls[0][0];
      expect(filterUsed.$or).toEqual([
        { _id: new ObjectId(hexId) },
        { _id: hexId },
        { id: hexId },
        { userID: hexId },
      ]);
    } finally {
      restore();
    }
  });

  it('clears mfaLocked and mfaFailedAttempts for the matched user, leaving mfaEnabled/mfaSecret untouched, and reports who was unlocked', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';
    process.env.MONGODB_DB_NAME = 'custom-db';

    const user = {
      _id: { toString: () => 'user-1' },
      email: 'admin@example.com',
      username: 'admin',
      mfaLocked: true,
      mfaFailedAttempts: 5,
      mfaEnabled: true,
      mfaSecret: 'SECRET-1',
    };
    const dbApi = fakeDb(user);
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      // Identifier is id-shaped (what buildUserFilterById actually matches
      // on) -- 'admin@example.com' below is display data on the found
      // document, not the lookup key.
      const result = await mod.clearMfaLockForUser('user-1');

      expect(db).toHaveBeenCalledWith('custom-db');
      expect(dbApi.collection).toHaveBeenCalledWith('users');
      expect(result).toEqual({ userId: 'user-1', email: 'admin@example.com', username: 'admin' });

      expect(dbApi.updateOne).toHaveBeenCalledTimes(1);
      expect(dbApi.updateOne).toHaveBeenCalledWith(
        { _id: user._id },
        { $set: { mfaLocked: false, mfaFailedAttempts: 0 } },
      );
      const setPayload = dbApi.updateOne.mock.calls[0][1].$set;
      expect(setPayload).not.toHaveProperty('mfaEnabled');
      expect(setPayload).not.toHaveProperty('mfaSecret');

      // The script must print who it unlocked -- the whole point is an
      // auditable deliberate act, not a silent sweep.
      const printedLines = logSpy.mock.calls.map((call) => call.join(' '));
      expect(printedLines.some((line) => line.includes('user-1') && line.includes('admin@example.com'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('a second run on the same already-cleared user is safe (no error, same update reapplied)', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const alreadyClearedUser = {
      _id: { toString: () => 'user-1' },
      email: 'admin@example.com',
      mfaLocked: false,
      mfaFailedAttempts: 0,
      mfaEnabled: true,
      mfaSecret: 'SECRET-1',
    };
    const dbApi = fakeDb(alreadyClearedUser);
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.clearMfaLockForUser('user-1');

      expect(result).toEqual({ userId: 'user-1', email: 'admin@example.com', username: null });
      expect(dbApi.updateOne).toHaveBeenCalledWith(
        { _id: alreadyClearedUser._id },
        { $set: { mfaLocked: false, mfaFailedAttempts: 0 } },
      );
    } finally {
      restore();
    }
  });

  it('still closes the client when the query fails', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const queryError = new Error('mongo query failed');
    const findOne = vi.fn().mockRejectedValue(queryError);
    const collection = vi.fn().mockReturnValue({ findOne, updateOne: vi.fn() });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection });

    const { mod, FakeMongoClient, restore } = loadScriptWithFakeMongo({ connect, db });
    const closeSpy = FakeMongoClient.prototype.close;
    try {
      await expect(mod.clearMfaLockForUser('some-id')).rejects.toThrow('mongo query failed');
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

    const dbApi = fakeDb(null);
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await expect(mod.clearMfaLockForUser('some-id')).rejects.toThrow(/Nenhum usuário encontrado/);
      expect(db).toHaveBeenCalledWith('bioadvanced');
    } finally {
      restore();
    }
  });

  it('is wired as an npm script pointing at this exact file (#933: unwired scripts never effectively run)', () => {
    const pkg = require('../../package.json');

    expect(pkg.scripts['mfa:clear-lock']).toBe('node src/scripts/clearMfaLockForUser.js');
    expect(pkg.scripts['mfa:migrate-stale-locks']).toBe('node src/scripts/migrateClearStaleMfaLocks.js');
  });
});
