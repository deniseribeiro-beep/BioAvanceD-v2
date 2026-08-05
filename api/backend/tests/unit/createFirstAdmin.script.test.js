import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildMutableRbacCollections } = require('../factories/rbac.factory');

const bcrypt = require('bcryptjs');
const { createFirstAdmin, requireBootstrapEnv } = require('../../src/scripts/createFirstAdmin');

function createMockDb(usersCount = 0) {
  const users = {
    createIndex: vi.fn().mockResolvedValue('idx'),
    countDocuments: vi.fn().mockResolvedValue(usersCount),
    insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'admin-user-id' } }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const systemBootstrap = {
    updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
  };
  // #421: createFirstAdmin now seeds the RBAC catalog (idempotent) and
  // grants the admin's UserRoleAssignment atomically with user creation —
  // both need a mutable roles/permissions/userRoleAssignments backing.
  const rbacCollections = buildMutableRbacCollections();

  return {
    users,
    systemBootstrap,
    db: {
      collection: vi.fn((name) => {
        if (name === 'users') return users;
        if (name === 'systemBootstrap') return systemBootstrap;
        if (rbacCollections[name]) return rbacCollections[name];
        throw new Error(`Unexpected collection ${name}`);
      }),
    },
  };
}

const validEnv = {
  BOOTSTRAP_ADMIN_NAME: 'Primeiro Admin',
  BOOTSTRAP_ADMIN_EMAIL: 'Admin.Seguro@BioAvanceD.test',
  BOOTSTRAP_ADMIN_USERNAME: 'admin-seguro',
  BOOTSTRAP_ADMIN_TEMP_PASSWORD: 'SenhaForte@123',
};

describe('createFirstAdmin', () => {
  it('nao cria admin se users ja contem usuario', async () => {
    const { db, users, systemBootstrap } = createMockDb(1);

    const result = await createFirstAdmin({ db, env: validEnv, logger: { info: vi.fn() } });

    expect(result).toEqual({ status: 'skipped', reason: 'users_exist', usersCount: 1 });
    expect(users.insertOne).not.toHaveBeenCalled();
    expect(systemBootstrap.updateOne).not.toHaveBeenCalled();
  });

  it('cria admin com senha hasheada quando users esta vazia', async () => {
    const { db, users, systemBootstrap } = createMockDb(0);

    const result = await createFirstAdmin({ db, env: validEnv, logger: { info: vi.fn() } });

    expect(result.status).toBe('created');
    expect(users.insertOne).toHaveBeenCalledTimes(1);
    const inserted = users.insertOne.mock.calls[0][0];
    expect(inserted.email).toBe('admin.seguro@bioavanced.test');
    expect(inserted.accessType).toBe(4);
    expect(inserted.forceReset).toBe(true);
    expect(inserted.password).not.toBe(validEnv.BOOTSTRAP_ADMIN_TEMP_PASSWORD);
    await expect(bcrypt.compare(validEnv.BOOTSTRAP_ADMIN_TEMP_PASSWORD, inserted.password)).resolves.toBe(true);
    expect(systemBootstrap.updateOne).toHaveBeenCalledWith(
      { _id: 'first_admin_bootstrap_v1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'created',
          forceReset: true,
        }),
      }),
      { upsert: true }
    );
  });

  it('falha se faltar variavel obrigatoria', async () => {
    const { db, users } = createMockDb(0);
    const env = { ...validEnv, BOOTSTRAP_ADMIN_EMAIL: '' };

    await expect(createFirstAdmin({ db, env, logger: { info: vi.fn() } })).rejects.toThrow('BOOTSTRAP_ADMIN_EMAIL');
    expect(users.insertOne).not.toHaveBeenCalled();
  });

  it('nao registra senha temporaria no logger', async () => {
    const { db } = createMockDb(0);
    const logger = { info: vi.fn() };

    await createFirstAdmin({ db, env: validEnv, logger });

    const logs = logger.info.mock.calls.flat().join(' ');
    expect(logs).not.toContain(validEnv.BOOTSTRAP_ADMIN_TEMP_PASSWORD);
  });

  it('rejeita senha temporaria fraca antes de tocar o banco', async () => {
    const { db, users } = createMockDb(0);
    const env = { ...validEnv, BOOTSTRAP_ADMIN_TEMP_PASSWORD: 'fraca' };

    await expect(createFirstAdmin({ db, env, logger: { info: vi.fn() } })).rejects.toThrow();
    expect(db.collection).not.toHaveBeenCalled();
    expect(users.countDocuments).not.toHaveBeenCalled();
  });
});

describe('requireBootstrapEnv', () => {
  it('lista todas as variaveis ausentes na mensagem de erro', () => {
    expect(() => requireBootstrapEnv({})).toThrow(
      'Variaveis obrigatorias ausentes: BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_TEMP_PASSWORD'
    );
  });

  it('trata valor apenas com espacos como ausente', () => {
    const env = { ...validEnv, BOOTSTRAP_ADMIN_USERNAME: '   ' };
    expect(() => requireBootstrapEnv(env)).toThrow('BOOTSTRAP_ADMIN_USERNAME');
  });

  it('normaliza os valores: trim em nome/username, email em minusculas', () => {
    const config = requireBootstrapEnv({
      BOOTSTRAP_ADMIN_NAME: '  Primeiro Admin  ',
      BOOTSTRAP_ADMIN_EMAIL: '  Admin.Seguro@BioAvanceD.test  ',
      BOOTSTRAP_ADMIN_USERNAME: '  admin-seguro  ',
      BOOTSTRAP_ADMIN_TEMP_PASSWORD: 'SenhaForte@123',
    });

    expect(config).toEqual({
      name: 'Primeiro Admin',
      email: 'admin.seguro@bioavanced.test',
      username: 'admin-seguro',
      password: 'SenhaForte@123',
    });
  });

  it('nao aplica trim na senha (preservada verbatim)', () => {
    const config = requireBootstrapEnv({ ...validEnv, BOOTSTRAP_ADMIN_TEMP_PASSWORD: ' Senha@123 ' });
    expect(config.password).toBe(' Senha@123 ');
  });
});

describe('createFirstAdmin sem options.db (conexao propria)', () => {
  // O source destrutura { connectDB, closeConnection } no escopo de modulo,
  // entao os fakes precisam estar em vigor ANTES de um re-require do script
  // (ver .claude/skills/bioavanced-v2-testing-conventions/references/cjs-mocking.md).
  const mongoPath = require.resolve('../../src/database/mongo');
  const scriptPath = require.resolve('../../src/scripts/createFirstAdmin');
  const realMongo = require('../../src/database/mongo');
  const originalConnectDB = realMongo.connectDB;
  const originalCloseConnection = realMongo.closeConnection;

  function loadScriptWithMongoFakes(db) {
    realMongo.connectDB = vi.fn().mockResolvedValue(db);
    realMongo.closeConnection = vi.fn().mockResolvedValue(undefined);
    delete require.cache[scriptPath];
    const fresh = require(scriptPath);
    return { fresh, connectDB: realMongo.connectDB, closeConnection: realMongo.closeConnection };
  }

  afterEach(() => {
    realMongo.connectDB = originalConnectDB;
    realMongo.closeConnection = originalCloseConnection;
    delete require.cache[scriptPath];
    require(scriptPath);
    expect(require.cache[mongoPath]).toBeDefined();
  });

  it('usa connectDB e fecha a conexao no sucesso', async () => {
    const { db, users } = createMockDb(0);
    const { fresh, connectDB, closeConnection } = loadScriptWithMongoFakes(db);

    const result = await fresh.createFirstAdmin({ env: validEnv, logger: { info: vi.fn() } });

    expect(result.status).toBe('created');
    expect(users.insertOne).toHaveBeenCalledTimes(1);
    expect(connectDB).toHaveBeenCalledTimes(1);
    expect(closeConnection).toHaveBeenCalledTimes(1);
  });

  it('fecha a conexao mesmo quando o corpo lanca erro', async () => {
    const { db, users } = createMockDb(0);
    users.countDocuments.mockRejectedValue(new Error('mongo indisponivel'));
    const { fresh, closeConnection } = loadScriptWithMongoFakes(db);

    await expect(
      fresh.createFirstAdmin({ env: validEnv, logger: { info: vi.fn() } })
    ).rejects.toThrow('mongo indisponivel');
    expect(closeConnection).toHaveBeenCalledTimes(1);
  });

  it('nao fecha a conexao quando options.db foi fornecido', async () => {
    const { db } = createMockDb(1);
    const { fresh, connectDB, closeConnection } = loadScriptWithMongoFakes(db);

    const result = await fresh.createFirstAdmin({ db, env: validEnv, logger: { info: vi.fn() } });

    expect(result.status).toBe('skipped');
    expect(connectDB).not.toHaveBeenCalled();
    expect(closeConnection).not.toHaveBeenCalled();
  });
});
