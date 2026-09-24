import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const scriptPath = require.resolve('../../src/scripts/migrateRoleAssignmentScopes');
const mongodbPath = require.resolve('mongodb');
const { ObjectId: RealObjectId } = require('mongodb');

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
    exports: { MongoClient: FakeMongoClient, ObjectId: RealObjectId },
  };

  delete require.cache[scriptPath];
  const mod = require('../../src/scripts/migrateRoleAssignmentScopes');

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
  return require('../../src/scripts/migrateRoleAssignmentScopes');
}

function fakeDb({ users = [], roles = [], assignments = [], organizations }) {
  const usersFindOne = vi.fn(async (query) => users.find((u) => String(u._id) === String(query._id)) || null);
  const usersCollection = { findOne: usersFindOne };

  const rolesToArray = vi.fn().mockResolvedValue(roles);
  const rolesFind = vi.fn().mockReturnValue({ toArray: rolesToArray });
  const rolesCollection = { find: rolesFind };

  const assignmentsToArray = vi.fn().mockResolvedValue(assignments);
  const assignmentsFind = vi.fn().mockReturnValue({ toArray: assignmentsToArray });
  const assignmentsUpdateOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const assignmentsCollection = { find: assignmentsFind, updateOne: assignmentsUpdateOne };

  // #627: default resolves any organizationId lookup as found, so
  // pre-existing tests passing a fabricated organizationId (e.g. 'org-1')
  // keep working — pass `organizations: []` to exercise the not-found path.
  const organizationsFindOne = vi.fn(async (query) => {
    if (!organizations) return { organizationId: query.organizationId };
    return organizations.find((o) => o.organizationId === query.organizationId) || null;
  });
  const organizationsCollection = { findOne: organizationsFindOne };

  const collection = vi.fn((name) => {
    if (name === 'userAccounts') return usersCollection;
    if (name === 'roles') return rolesCollection;
    if (name === 'organizations') return organizationsCollection;
    return assignmentsCollection; // 'userRoleAssignments'
  });

  return { collection, usersFindOne, rolesFind, assignmentsFind, assignmentsUpdateOne, organizationsFindOne };
}

const coordinatorRole = { roleId: 'role-coord', roleCode: 'coordinator', hierarchyLevel: 3 };
const administratorRole = { roleId: 'role-admin', roleCode: 'administrator', hierarchyLevel: 4 };

describe('scripts/migrateRoleAssignmentScopes', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('throws when neither MONGODB_URI nor MONGO_URI is set', async () => {
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;

    const mod = loadScriptWithoutFakeMongo();

    await expect(mod.migrateRoleAssignmentScopes()).rejects.toThrow(
      /MONGODB_URI ou MONGO_URI não encontrada/,
    );
  });

  it('exclui roleIds de hierarchyLevel 4 (Administrador) do filtro de candidatos', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const dbApi = fakeDb({ roles: [coordinatorRole, administratorRole], assignments: [] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await mod.migrateRoleAssignmentScopes();

      const query = dbApi.assignmentsFind.mock.calls[0][0];
      expect(query.scopeType).toBe('global');
      expect(query.roleId.$in).toContain('role-coord');
      expect(query.roleId.$in).not.toContain('role-admin');
    } finally {
      restore();
    }
  });

  it('atualiza uma assignment não-admin para scopeType organization com o organizationId do usuário', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const users = [{ _id: 'user-1', organizationId: 'org-1' }];
    const assignments = [{ assignmentId: 'a1', userAccountId: 'user-1', roleId: 'role-coord', scopeType: 'global' }];
    const dbApi = fakeDb({ users, roles: [coordinatorRole, administratorRole], assignments });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateRoleAssignmentScopes();

      expect(result).toEqual({ assignmentsUpdated: 1, assignmentsWithNullScope: 0, assignmentsWithInvalidOrganizationId: 0, usersNotFound: 0 });
      expect(dbApi.assignmentsUpdateOne).toHaveBeenCalledWith(
        { assignmentId: 'a1' },
        { $set: { scopeType: 'organization', scopeId: 'org-1' } },
      );
    } finally {
      restore();
    }
  });

  it('usa organizationIds[0] quando organizationId singular está vazio', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const users = [{ _id: 'user-1', organizationId: null, organizationIds: ['org-2', 'org-3'] }];
    const assignments = [{ assignmentId: 'a1', userAccountId: 'user-1', roleId: 'role-coord', scopeType: 'global' }];
    const dbApi = fakeDb({ users, roles: [coordinatorRole], assignments });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateRoleAssignmentScopes();

      expect(result.assignmentsWithNullScope).toBe(0);
      expect(dbApi.assignmentsUpdateOne).toHaveBeenCalledWith(
        { assignmentId: 'a1' },
        { $set: { scopeType: 'organization', scopeId: 'org-2' } },
      );
    } finally {
      restore();
    }
  });

  it('sem organizationId/organizationIds resolvível, grava scopeId null e conta em assignmentsWithNullScope', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const users = [{ _id: 'user-1', organizationId: null, organizationIds: [] }];
    const assignments = [{ assignmentId: 'a1', userAccountId: 'user-1', roleId: 'role-coord', scopeType: 'global' }];
    const dbApi = fakeDb({ users, roles: [coordinatorRole], assignments });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateRoleAssignmentScopes();

      expect(result).toEqual({ assignmentsUpdated: 1, assignmentsWithNullScope: 1, assignmentsWithInvalidOrganizationId: 0, usersNotFound: 0 });
      expect(dbApi.assignmentsUpdateOne).toHaveBeenCalledWith(
        { assignmentId: 'a1' },
        { $set: { scopeType: 'organization', scopeId: null } },
      );
    } finally {
      restore();
    }
  });

  // #627: mirrors #617/#622's organizationId referential check — this
  // script writes scopeId via raw Mongo, bypassing rbac-assignment.service.js
  // entirely, so it needs its own inline validation against `organizations`.
  it('organizationId do usuário não resolve a uma Organization real: grava scopeId null e conta em assignmentsWithInvalidOrganizationId', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const users = [{ _id: 'user-1', organizationId: 'org-inexistente' }];
    const assignments = [{ assignmentId: 'a1', userAccountId: 'user-1', roleId: 'role-coord', scopeType: 'global' }];
    const dbApi = fakeDb({ users, roles: [coordinatorRole], assignments, organizations: [] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateRoleAssignmentScopes();

      expect(result).toEqual({ assignmentsUpdated: 1, assignmentsWithNullScope: 1, assignmentsWithInvalidOrganizationId: 1, usersNotFound: 0 });
      expect(dbApi.assignmentsUpdateOne).toHaveBeenCalledWith(
        { assignmentId: 'a1' },
        { $set: { scopeType: 'organization', scopeId: null } },
      );
    } finally {
      restore();
    }
  });

  it('pula assignments cujo usuário não é encontrado, sem lançar erro', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const assignments = [{ assignmentId: 'a1', userAccountId: 'missing-user', roleId: 'role-coord', scopeType: 'global' }];
    const dbApi = fakeDb({ users: [], roles: [coordinatorRole], assignments });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateRoleAssignmentScopes();

      expect(result).toEqual({ assignmentsUpdated: 0, assignmentsWithNullScope: 0, assignmentsWithInvalidOrganizationId: 0, usersNotFound: 1 });
      expect(dbApi.assignmentsUpdateOne).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('não faz nada quando não há assignments candidatas (rerun idempotente)', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const dbApi = fakeDb({ roles: [coordinatorRole], assignments: [] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection: dbApi.collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      const result = await mod.migrateRoleAssignmentScopes();

      expect(result).toEqual({ assignmentsUpdated: 0, assignmentsWithNullScope: 0, assignmentsWithInvalidOrganizationId: 0, usersNotFound: 0 });
      expect(dbApi.assignmentsUpdateOne).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('propagates a query error and still closes the client', async () => {
    process.env.MONGODB_URI = 'mongodb://primary-host/db';

    const queryError = new Error('mongo query failed');
    const rolesFind = vi.fn().mockReturnValue({ toArray: vi.fn().mockRejectedValue(queryError) });
    const collection = vi.fn().mockReturnValue({ find: rolesFind, findOne: vi.fn(), updateOne: vi.fn() });
    const connect = vi.fn().mockResolvedValue(undefined);
    const db = vi.fn().mockReturnValue({ collection });

    const { mod, restore } = loadScriptWithFakeMongo({ connect, db });
    try {
      await expect(mod.migrateRoleAssignmentScopes()).rejects.toThrow('mongo query failed');
    } finally {
      restore();
    }
  });
});
