import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const scriptPath = require.resolve('../../src/scripts/clearMfaLockForUser');
const mongodbPath = require.resolve('mongodb');

const originalEnv = { ...process.env };

function loadScriptWithFakeMongo({ connect, db }) {
  const originalMongoModuleRecord = require.cache[mongodbPath];
  const { ObjectId } = require('mongodb');

  function FakeMongoClient() {}
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
    restore() {
      require.cache[mongodbPath] = originalMongoModuleRecord;
      delete require.cache[scriptPath];
    },
  };
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('clearMfaLockForUser item 8 residual label/email fallbacks', () => {
  it('labels unlock with username when email is absent', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';
    const user = {
      _id: { toString: () => 'user-1' },
      userAccountId: '550e8400-e29b-41d4-a716-446655440010',
      username: 'break-glass-admin',
      mfaLocked: true,
      mfaFailedAttempts: 3,
    };
    const findOne = vi.fn().mockResolvedValue(user);
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({
      collection: () => ({ findOne, updateOne }),
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });

    try {
      const result = await mod.clearMfaLockForUser(user.userAccountId);
      expect(result).toEqual({
        userId: user.userAccountId,
        email: null,
        username: 'break-glass-admin',
      });
      expect(logSpy.mock.calls.some((call) => String(call.join(' ')).includes('break-glass-admin'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('labels unlock with userAccountId when email and username are absent', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';
    const user = {
      _id: { toString: () => 'user-2' },
      userAccountId: '550e8400-e29b-41d4-a716-446655440011',
      mfaLocked: true,
      mfaFailedAttempts: 1,
    };
    const findOne = vi.fn().mockResolvedValue(user);
    const updateOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({
      collection: () => ({ findOne, updateOne }),
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });

    try {
      const result = await mod.clearMfaLockForUser(user.userAccountId);
      expect(result).toEqual({
        userId: user.userAccountId,
        email: null,
        username: null,
      });
      expect(logSpy.mock.calls.some((call) => String(call.join(' ')).includes(user.userAccountId))).toBe(true);
    } finally {
      restore();
    }
  });
});
