import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mongodb = require('mongodb');

const scriptPath = require.resolve('../../src/scripts/migrateSecurityConfigCanonicalKeys.js');

const envKeys = ['MONGODB_URI', 'MONGO_URI', 'MONGODB_DB_NAME', 'MONGO_DB', 'MONGO_DB_NOVO'];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

function loadScriptWithClient(fakeClient) {
  // mongodb@6 exports MongoClient through an accessor. Spy on the getter
  // itself (rather than on the constructor returned by that getter) before
  // requiring the script fresh; its top-level destructuring then captures
  // this deterministic constructor for the test.
  const MongoClientMock = function MongoClientMock(uri) {
    fakeClient.uri = uri;
    return fakeClient;
  };
  const ctorSpy = vi
    .spyOn(mongodb, 'MongoClient', 'get')
    .mockReturnValue(MongoClientMock);
  delete require.cache[scriptPath];
  const mod = require(scriptPath);
  ctorSpy.mockRestore();
  return mod;
}

function fakeMongo({ current = null, afterRename = null, updateError = null, connectError = null } = {}) {
  const findOne = vi.fn()
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce(afterRename);
  const updateOne = updateError
    ? vi.fn().mockRejectedValue(updateError)
    : vi.fn().mockResolvedValue({ acknowledged: true });
  const collection = { findOne, updateOne };
  const db = { collection: vi.fn(() => collection) };
  const client = {
    connect: connectError
      ? vi.fn().mockRejectedValue(connectError)
      : vi.fn().mockResolvedValue(undefined),
    db: vi.fn(() => db),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { client, db, collection };
}

beforeEach(() => {
  vi.restoreAllMocks();
  restoreEnv();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  restoreEnv();
  delete require.cache[scriptPath];
  vi.restoreAllMocks();
});

describe('migrateSecurityConfigCanonicalKeys item 8 coverage', () => {
  it('fails closed when no Mongo URI is configured and never constructs a client', async () => {
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;
    const { client } = fakeMongo();
    const { migrateSecurityConfigCanonicalKeys } = loadScriptWithClient(client);

    await expect(migrateSecurityConfigCanonicalKeys())
      .rejects.toThrow('MONGODB_URI ou MONGO_URI não encontrada');

    expect(client.connect).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      'Variáveis de ambiente disponíveis:',
      expect.any(Array)
    );
  });

  it('returns the expected no-document result and closes the client', async () => {
    process.env.MONGODB_URI = 'mongodb://primary.example/test';
    process.env.MONGO_URI = 'mongodb://fallback.example/test';
    process.env.MONGODB_DB_NAME = 'security_primary';
    process.env.MONGO_DB = 'security_fallback';

    const { client, db, collection } = fakeMongo({ current: null });
    const { migrateSecurityConfigCanonicalKeys } = loadScriptWithClient(client);

    const result = await migrateSecurityConfigCanonicalKeys();

    expect(result).toEqual({
      documentFound: false,
      keysRenamed: 0,
      metadataRemoved: false,
    });
    expect(client.uri).toBe('mongodb://primary.example/test');
    expect(client.db).toHaveBeenCalledWith('security_primary');
    expect(db.collection).toHaveBeenCalledWith('security_config');
    expect(collection.updateOne).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('takes MONGO_URI/MONGO_DB fallbacks and leaves an already canonical document unchanged', async () => {
    delete process.env.MONGODB_URI;
    process.env.MONGO_URI = 'mongodb://fallback.example/test';
    delete process.env.MONGODB_DB_NAME;
    process.env.MONGO_DB = 'security_db';
    delete process.env.MONGO_DB_NOVO;

    const current = {
      _id: 'main',
      authentication: { lockoutDurationMinutes: 15 },
      loginAttempts: { lockoutDurationMinutes: 15 },
      session: { maxSessionDurationHours: 8 },
    };
    const { client, collection } = fakeMongo({
      current,
      afterRename: current,
    });
    const { migrateSecurityConfigCanonicalKeys } = loadScriptWithClient(client);

    const result = await migrateSecurityConfigCanonicalKeys();

    expect(result).toEqual({
      documentFound: true,
      keysRenamed: 0,
      metadataRemoved: false,
    });
    expect(client.uri).toBe('mongodb://fallback.example/test');
    expect(client.db).toHaveBeenCalledWith('security_db');
    expect(collection.updateOne).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      'Todas as chaves já estão na grafia canônica — nada a migrar.'
    );
  });

  it('uses MONGO_DB_NOVO and finally the default database name when higher-precedence names are absent', async () => {
    delete process.env.MONGODB_URI;
    process.env.MONGO_URI = 'mongodb://fallback.example/test';
    delete process.env.MONGODB_DB_NAME;
    delete process.env.MONGO_DB;

    process.env.MONGO_DB_NOVO = 'security_new';
    let fixture = fakeMongo({ current: null });
    let script = loadScriptWithClient(fixture.client);
    await script.migrateSecurityConfigCanonicalKeys();
    expect(fixture.client.db).toHaveBeenCalledWith('security_new');

    delete process.env.MONGO_DB_NOVO;
    fixture = fakeMongo({ current: null });
    script = loadScriptWithClient(fixture.client);
    await script.migrateSecurityConfigCanonicalKeys();
    expect(fixture.client.db).toHaveBeenCalledWith('bioadvanced');
  });

  it('renames all legacy keys and removes an empty metadata group in a second update', async () => {
    process.env.MONGO_URI = 'mongodb://localhost/test';
    process.env.MONGO_DB = 'bioadvanced';

    const current = {
      _id: 'main',
      authentication: { lockoutDuration: 15 },
      loginAttempts: { lockoutDuration: 30 },
      session: { maxSessionDuration: 8 },
      metadata: {
        version: '1.0.0',
        lastUpdated: '2026-01-01T00:00:00Z',
        lastUpdatedBy: 'admin',
      },
    };
    const afterRename = {
      _id: 'main',
      authentication: { lockoutDurationMinutes: 15 },
      loginAttempts: { lockoutDurationMinutes: 30 },
      session: { maxSessionDurationHours: 8 },
      metadata: {},
    };
    const { client, collection } = fakeMongo({ current, afterRename });
    const { migrateSecurityConfigCanonicalKeys, RENAMES } = loadScriptWithClient(client);

    const result = await migrateSecurityConfigCanonicalKeys();

    expect(result).toEqual({
      documentFound: true,
      keysRenamed: 6,
      metadataRemoved: true,
    });
    expect(collection.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: 'main' },
      { $rename: RENAMES }
    );
    expect(collection.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: 'main' },
      { $unset: { metadata: '' } }
    );
    expect(console.log).toHaveBeenCalledWith('Grupo metadata (vazio) removido');
  });

  it('renames only present legacy keys and preserves noncanonical metadata leftovers for manual inspection', async () => {
    process.env.MONGO_URI = 'mongodb://localhost/test';

    const current = {
      _id: 'main',
      authentication: { lockoutDuration: 10 },
      // Deliberately omit loginAttempts/session to exercise absent group branches.
      metadata: { version: '1.0.0', customLegacyKey: 'preserve-me' },
    };
    const afterRename = {
      _id: 'main',
      authentication: { lockoutDurationMinutes: 10 },
      configVersion: '1.0.0',
      metadata: { customLegacyKey: 'preserve-me' },
    };
    const { client, collection } = fakeMongo({ current, afterRename });
    const { migrateSecurityConfigCanonicalKeys } = loadScriptWithClient(client);

    const result = await migrateSecurityConfigCanonicalKeys();

    expect(result).toEqual({
      documentFound: true,
      keysRenamed: 2,
      metadataRemoved: false,
    });
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    expect(collection.updateOne.mock.calls[0][1].$rename).toEqual({
      'authentication.lockoutDuration': 'authentication.lockoutDurationMinutes',
      'metadata.version': 'configVersion',
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('customLegacyKey')
    );
  });

  it('covers the after-rename document disappearing without attempting metadata cleanup', async () => {
    process.env.MONGO_URI = 'mongodb://localhost/test';

    const current = {
      _id: 'main',
      authentication: { lockoutDuration: 10 },
    };
    const { client, collection } = fakeMongo({ current, afterRename: null });
    const { migrateSecurityConfigCanonicalKeys } = loadScriptWithClient(client);

    const result = await migrateSecurityConfigCanonicalKeys();

    expect(result.documentFound).toBe(true);
    expect(result.keysRenamed).toBe(1);
    expect(result.metadataRemoved).toBe(false);
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
  });

  it('rethrows connection/update errors while closing an already-created client', async () => {
    process.env.MONGO_URI = 'mongodb://localhost/test';

    let fixture = fakeMongo({ connectError: new Error('connect failed') });
    let script = loadScriptWithClient(fixture.client);
    await expect(script.migrateSecurityConfigCanonicalKeys()).rejects.toThrow('connect failed');
    expect(fixture.client.close).toHaveBeenCalledTimes(1);

    fixture = fakeMongo({
      current: { _id: 'main', authentication: { lockoutDuration: 10 } },
      afterRename: null,
      updateError: new Error('update failed'),
    });
    script = loadScriptWithClient(fixture.client);
    await expect(script.migrateSecurityConfigCanonicalKeys()).rejects.toThrow('update failed');
    expect(fixture.client.close).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('Erro na migração:', expect.any(Error));
  });
});
