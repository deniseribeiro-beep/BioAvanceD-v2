import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  grantRoleForAccessType,
  changeUserRole,
  backfillUserRoleAssignments,
  userHasPermission,
  getActiveRoleCodes,
  isAdministrator,
  findUserAccountIdsByRoleCodes,
} = require('../../src/services/rbac-assignment.service');
const { createCollectionMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function matchesQuery(doc, query = {}) {
  return Object.entries(query).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in cond) {
      return cond.$in.includes(doc[key]);
    }
    return doc[key] === cond;
  });
}

function buildDb({ users = [], roles = [], permissionDocs = [], assignments = [] } = {}) {
  const usersCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => users.find((u) => matchesQuery(u, query)) || null),
    find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(users) })),
  });
  const rolesCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => roles.find((r) => matchesQuery(r, query)) || null),
    find: vi.fn((query = {}) => ({ toArray: vi.fn().mockResolvedValue(roles.filter((r) => matchesQuery(r, query))) })),
  });
  const permissionsCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => permissionDocs.find((p) => matchesQuery(p, query)) || null),
  });
  const assignmentsCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => assignments.find((a) => matchesQuery(a, query)) || null),
    find: vi.fn((query = {}) => ({ toArray: vi.fn().mockResolvedValue(assignments.filter((a) => matchesQuery(a, query))) })),
    insertOne: vi.fn(async (doc) => {
      assignments.push(doc);
      return { insertedId: doc.assignmentId };
    }),
    updateOne: vi.fn(async (filter, update) => {
      const doc = assignments.find((a) => matchesQuery(a, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    }),
  });

  return {
    collection: (name) => {
      if (name === 'users') return usersCollection;
      if (name === 'roles') return rolesCollection;
      if (name === 'permissions') return permissionsCollection;
      if (name === 'userRoleAssignments') return assignmentsCollection;
      return createCollectionMock();
    },
  };
}

const coordinatorRole = { roleId: 'role-coord', roleCode: 'coordinator', hierarchyLevel: 3, roleStatus: 'active', permissionIds: ['perm-createUser'] };
const technicianRole = { roleId: 'role-tech', roleCode: 'technician', hierarchyLevel: 2, roleStatus: 'active', permissionIds: [] };
const roles = [coordinatorRole, technicianRole];

describe('rbac-assignment.service (#421)', () => {
  it('grantRoleForAccessType cria uma assignment ativa para o roleCode correspondente', async () => {
    const db = buildDb({ roles, assignments: [] });

    const doc = await grantRoleForAccessType(db, { userAccountId: 'u1', accessType: 3, grantedBy: 'admin1' });

    expect(doc.userAccountId).toBe('u1');
    expect(doc.roleId).toBe('role-coord');
    expect(doc.assignmentStatus).toBe('active');
    expect(doc.grantedBy).toBe('admin1');
  });

  it('grantRoleForAccessType é idempotente: chamar duas vezes não duplica a assignment', async () => {
    const assignments = [];
    const db = buildDb({ roles, assignments });

    await grantRoleForAccessType(db, { userAccountId: 'u1', accessType: 3, grantedBy: 'admin1' });
    await grantRoleForAccessType(db, { userAccountId: 'u1', accessType: 3, grantedBy: 'admin1' });

    expect(assignments.filter((a) => a.userAccountId === 'u1' && a.assignmentStatus === 'active')).toHaveLength(1);
  });

  it('grantRoleForAccessType lança erro se o Role do catálogo não existir (catálogo não semeado)', async () => {
    const db = buildDb({ roles: [], assignments: [] });

    await expect(grantRoleForAccessType(db, { userAccountId: 'u1', accessType: 3, grantedBy: 'admin1' }))
      .rejects.toThrow(/Role não encontrado/);
  });

  it('changeUserRole revoga a assignment ativa anterior e concede a nova', async () => {
    const assignments = [{ assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', assignmentStatus: 'active', validUntil: null }];
    const db = buildDb({ roles, assignments });

    await changeUserRole(db, { userAccountId: 'u1', accessType: 3, changedBy: 'admin1' });

    const revoked = assignments.find((a) => a.assignmentId === 'a1');
    expect(revoked.assignmentStatus).toBe('revoked');
    expect(revoked.revocationReason).toBe('role_changed');
    const active = assignments.filter((a) => a.userAccountId === 'u1' && a.assignmentStatus === 'active');
    expect(active).toHaveLength(1);
    expect(active[0].roleId).toBe('role-coord');
  });

  it('backfillUserRoleAssignments concede uma assignment por usuário existente a partir do accessType', async () => {
    const users = [
      { _id: { toString: () => 'u1' }, accessType: 3 },
      { _id: { toString: () => 'u2' }, accessType: 2 },
    ];
    const db = buildDb({ users, roles, assignments: [] });

    const result = await backfillUserRoleAssignments(db);

    expect(result).toHaveLength(2);
    expect(result.map((a) => a.roleId).sort()).toEqual(['role-coord', 'role-tech'].sort());
  });

  it('backfillUserRoleAssignments rodado duas vezes não duplica assignments (idempotente)', async () => {
    const users = [{ _id: { toString: () => 'u1' }, accessType: 3 }];
    const assignments = [];
    const db = buildDb({ users, roles, assignments });

    await backfillUserRoleAssignments(db);
    await backfillUserRoleAssignments(db);

    expect(assignments.filter((a) => a.assignmentStatus === 'active')).toHaveLength(1);
  });

  it('userHasPermission retorna false quando o usuário não tem nenhuma assignment ativa', async () => {
    const db = buildDb({ roles, permissionDocs: [{ permissionId: 'perm-createUser', permissionCode: 'createUser' }], assignments: [] });

    const result = await userHasPermission(db, 'u1', 'createUser');

    expect(result).toBe(false);
  });
});

describe('rbac-assignment.service readers (#426)', () => {
  function buildDbWithRbac(users = []) {
    const collections = buildRbacCollections(users);
    return { collection: (name) => collections[name] || createCollectionMock() };
  }

  it('getActiveRoleCodes retorna os roleCodes das assignments ativas do usuário', async () => {
    const db = buildDbWithRbac([{ userAccountId: 'admin-1', accessType: 4 }]);

    const codes = await getActiveRoleCodes(db, 'admin-1');

    expect(codes).toEqual(['administrator']);
  });

  it('getActiveRoleCodes retorna array vazio para usuário sem assignment ativa', async () => {
    const db = buildDbWithRbac([]);

    const codes = await getActiveRoleCodes(db, 'nobody');

    expect(codes).toEqual([]);
  });

  it('isAdministrator retorna true apenas para usuário com role administrator ativa', async () => {
    const db = buildDbWithRbac([
      { userAccountId: 'admin-1', accessType: 4 },
      { userAccountId: 'tech-1', accessType: 2 },
    ]);

    expect(await isAdministrator(db, 'admin-1')).toBe(true);
    expect(await isAdministrator(db, 'tech-1')).toBe(false);
    expect(await isAdministrator(db, 'nobody')).toBe(false);
  });

  it('findUserAccountIdsByRoleCodes retorna userAccountIds com assignment ativa em qualquer dos roleCodes', async () => {
    const db = buildDbWithRbac([
      { userAccountId: 'admin-1', accessType: 4 },
      { userAccountId: 'coord-1', accessType: 3 },
      { userAccountId: 'tech-1', accessType: 2 },
      { userAccountId: 'ext-1', accessType: 1 },
    ]);

    const ids = await findUserAccountIdsByRoleCodes(db, ['technician', 'coordinator', 'administrator']);

    expect(ids.sort()).toEqual(['admin-1', 'coord-1', 'tech-1'].sort());
  });

  it('findUserAccountIdsByRoleCodes retorna array vazio quando nenhum roleCode do catálogo bate', async () => {
    const db = buildDbWithRbac([{ userAccountId: 'admin-1', accessType: 4 }]);

    const ids = await findUserAccountIdsByRoleCodes(db, ['nonexistent-role']);

    expect(ids).toEqual([]);
  });
});
