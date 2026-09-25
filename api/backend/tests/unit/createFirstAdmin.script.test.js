import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildMutableRbacCollections } = require('../factories/rbac.factory');

const bcrypt = require('bcryptjs');
const { createFirstAdmin, requireBootstrapEnv } = require('../../src/scripts/createFirstAdmin');
const { BIOAVANCED_SYSTEM_ACTOR_ID } = require('../../src/foundation/systemActorSeedV2');

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
  const actorDocs = [];
  const actors = {
    updateOne: vi.fn(async (_filter, update) => {
      if (!actorDocs.some((actor) => actor.actorId === update.$setOnInsert.actorId)) actorDocs.push(update.$setOnInsert);
    }),
    insertOne: vi.fn(async (actor) => { actorDocs.push(actor); }),
    findOne: vi.fn(async ({ actorId }) => actorDocs.find((actor) => actor.actorId === actorId) || null),
  };
  // #421: createFirstAdmin now seeds the RBAC catalog (idempotent) and
  // grants the admin's UserRoleAssignment atomically with user creation —
  // both need a mutable roles/permissions/userRoleAssignments backing.
  const rbacCollections = buildMutableRbacCollections();

  return {
    users,
    systemBootstrap,
    actors,
    rbacCollections,
    db: {
      collection: vi.fn((name) => {
        if (name === 'userAccounts') return users;
        if (name === 'systemBootstrap') return systemBootstrap;
        if (name === 'actors') return actors;
        if (rbacCollections[name]) return rbacCollections[name];
        throw new Error(`Unexpected collection ${name}`);
      }),
    },
  };
}

// #1028: a db whose `roles` collection rejects every write, so
// seedRolesAndPermissions fails. Used to pin that the seed now runs BEFORE
// insertOne -- see the ordering test at the bottom of this file.
function createMockDbWithFailingSeed() {
  const parts = createMockDb(0);
  // `then` must stay undefined: `getCollection` awaits the collection object,
  // and a Proxy that answers every property with a function makes it look
  // THENABLE -- await then calls it as (resolve, reject), it returns a
  // rejected promise instead of calling reject, and the await never settles.
  // That is a 5000ms timeout, not a rejection, and it cost a debug cycle here.
  const failing = new Proxy({}, {
    get: (_target, prop) => (
      typeof prop === 'symbol' || prop === 'then'
        ? undefined
        : vi.fn().mockRejectedValue(new Error('roles collection indisponível'))
    ),
  });
  return {
    ...parts,
    db: {
      collection: vi.fn((name) => {
        if (name === 'userAccounts') return parts.users;
        if (name === 'systemBootstrap') return parts.systemBootstrap;
        if (name === 'actors') return parts.actors;
        if (name === 'roles') return failing;
        if (parts.rbacCollections[name]) return parts.rbacCollections[name];
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
    const { db, users, systemBootstrap, actors } = createMockDb(0);

    const result = await createFirstAdmin({ db, env: validEnv, logger: { info: vi.fn() } });

    expect(result.status).toBe('created');
    expect(users.insertOne).toHaveBeenCalledTimes(1);
    const inserted = users.insertOne.mock.calls[0][0];
    expect(inserted.email).toBe('admin.seguro@bioavanced.test');
    expect(inserted.actorId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(actors.insertOne).toHaveBeenCalledWith(expect.objectContaining({ actorId: inserted.actorId, actorType: 'user' }));
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

  // RF014 AC#4 (#648): explicit, isolated opt-out for a controlled/automated
  // bootstrap (compose.test.yml's BOOTSTRAP_ADMIN_FORCE_RESET: "false") --
  // never inferred from NODE_ENV, same shape AUTH_RATE_LIMIT_RELAXED uses.
  it('respeita BOOTSTRAP_ADMIN_FORCE_RESET=false (bootstrap automatizado, ex.: e2e)', async () => {
    const { db, users, systemBootstrap } = createMockDb(0);
    const env = { ...validEnv, BOOTSTRAP_ADMIN_FORCE_RESET: 'false' };

    const result = await createFirstAdmin({ db, env, logger: { info: vi.fn() } });

    expect(result.forceReset).toBe(false);
    const inserted = users.insertOne.mock.calls[0][0];
    expect(inserted.forceReset).toBe(false);
    expect(systemBootstrap.updateOne).toHaveBeenCalledWith(
      { _id: 'first_admin_bootstrap_v1' },
      expect.objectContaining({ $set: expect.objectContaining({ forceReset: false }) }),
      { upsert: true }
    );
  });

  it('mantem forceReset:true quando BOOTSTRAP_ADMIN_FORCE_RESET nao e a string "false" (ex.: ausente, ou um valor inesperado)', async () => {
    const { db, users } = createMockDb(0);
    const env = { ...validEnv, BOOTSTRAP_ADMIN_FORCE_RESET: 'nope' };

    await createFirstAdmin({ db, env, logger: { info: vi.fn() } });

    expect(users.insertOne.mock.calls[0][0].forceReset).toBe(true);
  });

  // #427: accessType/roleName are no longer written to the User document —
  // only used transiently to grant the matching UserRoleAssignment (#421).
  it('nao persiste accessType/roleName no documento do usuario, mas concede a UserRoleAssignment de administrator', async () => {
    const { db, users, rbacCollections, actors } = createMockDb(0);

    await createFirstAdmin({ db, env: validEnv, logger: { info: vi.fn() } });

    const inserted = users.insertOne.mock.calls[0][0];
    expect(inserted).not.toHaveProperty('accessType');
    expect(inserted).not.toHaveProperty('roleName');

    const assignments = await rbacCollections.userRoleAssignments.find({}).toArray();
    const roles = await rbacCollections.roles.find({}).toArray();
    const adminRole = roles.find((r) => r.roleCode === 'administrator');
    expect(assignments.some((a) => /^[0-9a-f-]{36}$/i.test(a.userAccountId) && a.roleId === adminRole.roleId && a.assignmentStatus === 'active')).toBe(true);
    expect(assignments[0].grantedBy).toBe(BIOAVANCED_SYSTEM_ACTOR_ID);
    expect(actors.updateOne.mock.invocationCallOrder[0]).toBeLessThan(users.insertOne.mock.invocationCallOrder[0]);
    expect(actors.insertOne.mock.invocationCallOrder[0]).toBeLessThan(users.insertOne.mock.invocationCallOrder[0]);
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

  it('usa process.env quando options.env e omitido', async () => {
    const { db, users } = createMockDb(0);
    const previous = {};
    for (const [key, value] of Object.entries(validEnv)) {
      previous[key] = process.env[key];
      process.env[key] = value;
    }
    try {
      const result = await createFirstAdmin({ db, logger: { info: vi.fn() } });
      expect(result.status).toBe('created');
      expect(users.insertOne).toHaveBeenCalledTimes(1);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('usa console como logger quando options.logger e omitido', async () => {
    const { db } = createMockDb(1);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const result = await createFirstAdmin({ db, env: validEnv });
      expect(result.status).toBe('skipped');
      expect(info).toHaveBeenCalledWith(expect.stringContaining('[ADMIN_BOOTSTRAP]'));
    } finally {
      info.mockRestore();
    }
  });

  it('rejeita senha temporaria fraca antes de tocar o banco', async () => {
    const { db, users } = createMockDb(0);
    const env = { ...validEnv, BOOTSTRAP_ADMIN_TEMP_PASSWORD: 'fraca' };

    await expect(createFirstAdmin({ db, env, logger: { info: vi.fn() } })).rejects.toThrow();
    expect(db.collection).not.toHaveBeenCalled();
    expect(users.countDocuments).not.toHaveBeenCalled();
  });

  // #1028: the seed used to sit BETWEEN insertOne and grantRoleForAccessType,
  // so a seed failure orphaned the admin -- and the idempotence guard above
  // then returns `skipped/users_exist` forever, on a stack whose only user
  // cannot authorize anything. Stuck-forever, not lower-risk.
  //
  // The seed needs nothing from the insert (it takes only `db`), which is what
  // makes hoisting it safe. This pins the ordering: a failing seed must leave
  // NO user behind.
  it('#1028: a failing RBAC seed leaves no orphaned admin -- the seed runs before insertOne', async () => {
    const { users, db } = createMockDbWithFailingSeed();

    await expect(
      createFirstAdmin({ db, env: validEnv, logger: { info: vi.fn() } })
    ).rejects.toThrow(/roles collection indispon/);

    expect(users.insertOne).not.toHaveBeenCalled();
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
