import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const scriptPath = require.resolve('../../src/scripts/migrateUserOrganizations');
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
  const mod = require('../../src/scripts/migrateUserOrganizations');

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
  return require('../../src/scripts/migrateUserOrganizations');
}

function fakeDb({ users, organizations }) {
  const usersToArray = vi.fn().mockResolvedValue(users);
  const usersFind = vi.fn().mockReturnValue({ toArray: usersToArray });
  const usersUpdateOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const usersCollection = { find: usersFind, updateOne: usersUpdateOne };

  const orgsToArray = vi.fn().mockResolvedValue(organizations);
  const orgsFind = vi.fn().mockReturnValue({ toArray: orgsToArray });
  const orgsInsertOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const organizationsCollection = { find: orgsFind, insertOne: orgsInsertOne };

  const collection = vi.fn((name) => (name === 'users' ? usersCollection : organizationsCollection));

  return { collection, usersFind, usersUpdateOne, orgsFind, orgsInsertOne };
}

describe('scripts/migrateUserOrganizations', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('throws when neither MONGODB_URI nor MONGO_URI is set', async () => {
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;

    const mod = loadScriptWithoutFakeMongo();

    await expect(mod.migrateUserOrganizations()).rejects.toThrow(
      /MONGODB_URI ou MONGO_URI não encontrada/,
    );
  });

  it('does nothing when no user has institution/institutionalScope', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const dbApi = fakeDb({ users: [], organizations: [] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateUserOrganizations();
      expect(result).toEqual({ usersUpdated: 0, organizationsCreated: 0 });
      expect(dbApi.usersUpdateOne).not.toHaveBeenCalled();
      expect(dbApi.orgsInsertOne).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('creates one Organization per distinct institution and rewrites the user with organizationId, dropping the old field', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const users = [
      { _id: { toString: () => 'user-1' }, institution: 'Hospital Central' },
      { _id: { toString: () => 'user-2' }, institution: 'hospital central' }, // dedupe: same normalized name
    ];
    const dbApi = fakeDb({ users, organizations: [] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateUserOrganizations();

      expect(result.usersUpdated).toBe(2);
      expect(result.organizationsCreated).toBe(1);
      expect(dbApi.orgsInsertOne).toHaveBeenCalledTimes(1);

      const createdOrg = dbApi.orgsInsertOne.mock.calls[0][0];
      expect(createdOrg.officialName).toBe('Hospital Central');

      const firstUpdate = dbApi.usersUpdateOne.mock.calls[0];
      const secondUpdate = dbApi.usersUpdateOne.mock.calls[1];
      expect(firstUpdate[1].$set.organizationId).toBe(createdOrg.organizationId);
      expect(secondUpdate[1].$set.organizationId).toBe(createdOrg.organizationId);
      expect(firstUpdate[1].$unset).toEqual({ institution: '', institutionalScope: '' });
    } finally {
      restore();
    }
  });

  it('reuses an existing Organization matched by normalizedName instead of creating a duplicate', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const users = [
      { _id: { toString: () => 'user-1' }, institution: 'Biobanco Norte' },
    ];
    const existingOrg = { organizationId: 'org-existing-1', normalizedName: 'BIOBANCO NORTE' };
    const dbApi = fakeDb({ users, organizations: [existingOrg] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateUserOrganizations();

      expect(result.organizationsCreated).toBe(0);
      expect(dbApi.orgsInsertOne).not.toHaveBeenCalled();
      expect(dbApi.usersUpdateOne).toHaveBeenCalledWith(
        { _id: users[0]._id },
        {
          $set: { organizationId: 'org-existing-1', organizationIds: [] },
          $unset: { institution: '', institutionalScope: '' },
        },
      );
    } finally {
      restore();
    }
  });

  it('resolves institutionalScope entries to a deduped organizationIds array', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const users = [
      {
        _id: { toString: () => 'user-1' },
        institutionalScope: ['Hospital Central', 'Biobanco Norte', 'hospital central'],
      },
    ];
    const dbApi = fakeDb({ users, organizations: [] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateUserOrganizations();

      expect(result.organizationsCreated).toBe(2);
      const update = dbApi.usersUpdateOne.mock.calls[0][1];
      expect(update.$set.organizationIds).toHaveLength(2);
      expect(new Set(update.$set.organizationIds).size).toBe(2);
      expect(update.$set.organizationId).toBeNull();
    } finally {
      restore();
    }
  });

  it('ignores blank institution strings (resolves to null, not an empty-string Organization)', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const users = [
      { _id: { toString: () => 'user-1' }, institution: '   ' },
    ];
    const dbApi = fakeDb({ users, organizations: [] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateUserOrganizations();

      expect(result.organizationsCreated).toBe(0);
      expect(dbApi.usersUpdateOne).toHaveBeenCalledWith(
        { _id: users[0]._id },
        {
          $set: { organizationId: null, organizationIds: [] },
          $unset: { institution: '', institutionalScope: '' },
        },
      );
    } finally {
      restore();
    }
  });

  it('propagates a query error and still closes the client', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const queryError = new Error('mongo query failed');
    const usersToArray = vi.fn().mockRejectedValue(queryError);
    const usersFind = vi.fn().mockReturnValue({ toArray: usersToArray });
    const collection = vi.fn().mockReturnValue({ find: usersFind, updateOne: vi.fn(), insertOne: vi.fn() });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await expect(mod.migrateUserOrganizations()).rejects.toThrow('mongo query failed');
    } finally {
      restore();
    }
  });
});
