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
  grantAdditionalRole,
  revokeAdditionalRole,
  updateAssignmentScope,
  resolveUserOrganizationScope,
  isOrganizationScopeUsable,
  applyOrganizationScopeFilter,
  isRecordInOrganizationScope,
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
    insertOne: vi.fn(async (doc) => {
      roles.push(doc);
      return { insertedId: doc.roleId };
    }),
  });
  const permissionsCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => permissionDocs.find((p) => matchesQuery(p, query)) || null),
    insertOne: vi.fn(async (doc) => {
      permissionDocs.push(doc);
      return { insertedId: doc.permissionId };
    }),
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
const auditorRole = { roleId: 'role-auditor', roleCode: 'auditor', hierarchyLevel: null, roleStatus: 'active', permissionIds: ['perm-viewAuditLogs'] };
const administratorRole = { roleId: 'role-admin', roleCode: 'administrator', hierarchyLevel: 4, roleStatus: 'active', permissionIds: [] };
const roles = [coordinatorRole, technicianRole, auditorRole, administratorRole];

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

  it('#616: changeUserRole preserva uma assignment additiva ativa (auditor) ao trocar o accessType', async () => {
    const assignments = [
      { assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', assignmentStatus: 'active', validUntil: null },
      { assignmentId: 'a2', userAccountId: 'u1', roleId: 'role-auditor', assignmentStatus: 'active', validUntil: null },
    ];
    const db = buildDb({ roles, assignments });

    await changeUserRole(db, { userAccountId: 'u1', accessType: 3, changedBy: 'admin1' });

    const auditorAssignment = assignments.find((a) => a.assignmentId === 'a2');
    expect(auditorAssignment.assignmentStatus).toBe('active');
    const active = assignments.filter((a) => a.userAccountId === 'u1' && a.assignmentStatus === 'active');
    expect(active.map((a) => a.roleId).sort()).toEqual(['role-auditor', 'role-coord'].sort());
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

  it('backfillUserRoleAssignments semeia o catálogo RBAC automaticamente quando ainda não foi semeado (#437)', async () => {
    const users = [{ _id: { toString: () => 'u1' }, accessType: 4 }];
    const db = buildDb({ users, roles: [], permissionDocs: [], assignments: [] });

    const result = await backfillUserRoleAssignments(db);

    expect(result).toHaveLength(1);
    expect(result[0].roleId).toBeTruthy();
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

describe('rbac-assignment.service additive roles (#429)', () => {
  it('grantAdditionalRole concede a role auditor sem revogar a role de accessType existente', async () => {
    const assignments = [{ assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', assignmentStatus: 'active', validUntil: null }];
    const db = buildDb({ roles, assignments });

    const doc = await grantAdditionalRole(db, { userAccountId: 'u1', roleCode: 'auditor', grantedBy: 'admin1' });

    expect(doc.roleId).toBe('role-auditor');
    const active = assignments.filter((a) => a.userAccountId === 'u1' && a.assignmentStatus === 'active');
    expect(active.map((a) => a.roleId).sort()).toEqual(['role-auditor', 'role-tech'].sort());
  });

  it('grantAdditionalRole é idempotente: chamar duas vezes não duplica a assignment', async () => {
    const assignments = [];
    const db = buildDb({ roles, assignments });

    await grantAdditionalRole(db, { userAccountId: 'u1', roleCode: 'auditor', grantedBy: 'admin1' });
    await grantAdditionalRole(db, { userAccountId: 'u1', roleCode: 'auditor', grantedBy: 'admin1' });

    expect(assignments.filter((a) => a.userAccountId === 'u1' && a.assignmentStatus === 'active')).toHaveLength(1);
  });

  it('grantAdditionalRole lança erro se o roleCode não existir no catálogo', async () => {
    const db = buildDb({ roles, assignments: [] });

    await expect(grantAdditionalRole(db, { userAccountId: 'u1', roleCode: 'nonexistent', grantedBy: 'admin1' }))
      .rejects.toThrow(/Role não encontrado/);
  });

  it('revokeAdditionalRole revoga apenas a assignment do roleCode informado', async () => {
    const assignments = [
      { assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', assignmentStatus: 'active', validUntil: null },
      { assignmentId: 'a2', userAccountId: 'u1', roleId: 'role-auditor', assignmentStatus: 'active', validUntil: null },
    ];
    const db = buildDb({ roles, assignments });

    await revokeAdditionalRole(db, { userAccountId: 'u1', roleCode: 'auditor', revokedBy: 'admin1' });

    const tech = assignments.find((a) => a.assignmentId === 'a1');
    const auditor = assignments.find((a) => a.assignmentId === 'a2');
    expect(tech.assignmentStatus).toBe('active');
    expect(auditor.assignmentStatus).toBe('revoked');
  });

  it('revokeAdditionalRole é no-op quando o usuário não tem a role', async () => {
    const assignments = [{ assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', assignmentStatus: 'active', validUntil: null }];
    const db = buildDb({ roles, assignments });

    const revoked = await revokeAdditionalRole(db, { userAccountId: 'u1', roleCode: 'auditor', revokedBy: 'admin1' });

    expect(revoked).toEqual([]);
    expect(assignments.find((a) => a.assignmentId === 'a1').assignmentStatus).toBe('active');
  });
});

describe('rbac-assignment.service organization scoping (#615)', () => {
  it('grantRoleForAccessType com organizationId cria assignment scopeType organization/scopeId correto', async () => {
    const db = buildDb({ roles, assignments: [] });

    const doc = await grantRoleForAccessType(db, { userAccountId: 'u1', accessType: 3, grantedBy: 'admin1', organizationId: 'org-1' });

    expect(doc.scopeType).toBe('organization');
    expect(doc.scopeId).toBe('org-1');
  });

  it('grantRoleForAccessType sem organizationId cria assignment scopeType organization/scopeId null', async () => {
    const db = buildDb({ roles, assignments: [] });

    const doc = await grantRoleForAccessType(db, { userAccountId: 'u1', accessType: 3, grantedBy: 'admin1' });

    expect(doc.scopeType).toBe('organization');
    expect(doc.scopeId).toBeNull();
  });

  it('grantRoleForAccessType para Administrador é sempre scopeType global, mesmo com organizationId informado', async () => {
    const db = buildDb({ roles, assignments: [] });

    const doc = await grantRoleForAccessType(db, { userAccountId: 'u1', accessType: 4, grantedBy: 'admin1', organizationId: 'org-1' });

    expect(doc.scopeType).toBe('global');
    expect(doc.scopeId).toBeNull();
  });

  it('grantAdditionalRole para auditor é scopeType organization (auditor nunca faz bypass)', async () => {
    const assignments = [{ assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', assignmentStatus: 'active', validUntil: null }];
    const db = buildDb({ roles, assignments });

    const doc = await grantAdditionalRole(db, { userAccountId: 'u1', roleCode: 'auditor', grantedBy: 'admin1', organizationId: 'org-1' });

    expect(doc.scopeType).toBe('organization');
    expect(doc.scopeId).toBe('org-1');
  });

  it('updateAssignmentScope atualiza apenas assignments organization-scoped, preservando global', async () => {
    const assignments = [
      { assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', scopeType: 'organization', scopeId: 'org-1', assignmentStatus: 'active', validUntil: null },
      { assignmentId: 'a2', userAccountId: 'u1', roleId: 'role-admin', scopeType: 'global', scopeId: null, assignmentStatus: 'active', validUntil: null },
    ];
    const db = buildDb({ roles, assignments });

    const updated = await updateAssignmentScope(db, { userAccountId: 'u1', organizationId: 'org-2', updatedBy: 'admin1' });

    expect(updated).toEqual(['a1']);
    expect(assignments.find((a) => a.assignmentId === 'a1').scopeId).toBe('org-2');
    expect(assignments.find((a) => a.assignmentId === 'a2').scopeType).toBe('global');
    expect(assignments.find((a) => a.assignmentId === 'a2').scopeId).toBeNull();
  });

  it('updateAssignmentScope com organizationId null limpa o scopeId (usuário volta a estar sem organização)', async () => {
    const assignments = [
      { assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', scopeType: 'organization', scopeId: 'org-1', assignmentStatus: 'active', validUntil: null },
    ];
    const db = buildDb({ roles, assignments });

    await updateAssignmentScope(db, { userAccountId: 'u1', organizationId: null, updatedBy: 'admin1' });

    expect(assignments.find((a) => a.assignmentId === 'a1').scopeId).toBeNull();
  });

  it('resolveUserOrganizationScope retorna global quando há assignment ativa de Administrador', async () => {
    const assignments = [{ assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-admin', scopeType: 'global', scopeId: null, assignmentStatus: 'active', validUntil: null }];
    const db = buildDb({ roles, assignments });

    expect(await resolveUserOrganizationScope(db, 'u1')).toEqual({ scope: 'global', organizationIds: [] });
  });

  it('resolveUserOrganizationScope retorna organization com os scopeIds das assignments ativas', async () => {
    const assignments = [{ assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', scopeType: 'organization', scopeId: 'org-1', assignmentStatus: 'active', validUntil: null }];
    const db = buildDb({ roles, assignments });

    expect(await resolveUserOrganizationScope(db, 'u1')).toEqual({ scope: 'organization', organizationIds: ['org-1'] });
  });

  it('resolveUserOrganizationScope retorna unassigned quando a assignment organization-scoped tem scopeId nulo', async () => {
    const assignments = [{ assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', scopeType: 'organization', scopeId: null, assignmentStatus: 'active', validUntil: null }];
    const db = buildDb({ roles, assignments });

    expect(await resolveUserOrganizationScope(db, 'u1')).toEqual({ scope: 'unassigned', organizationIds: [] });
  });

  it('resolveUserOrganizationScope retorna none quando o usuário não tem nenhuma assignment ativa', async () => {
    const db = buildDb({ roles, assignments: [] });

    expect(await resolveUserOrganizationScope(db, 'u1')).toEqual({ scope: 'none', organizationIds: [] });
  });

  it('backfillUserRoleAssignments usa organizationId do usuário, com fallback para organizationIds[0]', async () => {
    const users = [
      { _id: { toString: () => 'u1' }, accessType: 3, organizationId: 'org-1' },
      { _id: { toString: () => 'u2' }, accessType: 2, organizationId: null, organizationIds: ['org-2', 'org-3'] },
    ];
    const db = buildDb({ users, roles, assignments: [] });

    const result = await backfillUserRoleAssignments(db);

    const byUser = Object.fromEntries(result.map((a) => [a.userAccountId, a]));
    expect(byUser.u1.scopeId).toBe('org-1');
    expect(byUser.u2.scopeId).toBe('org-2');
  });

  describe('#340: organization-scope query helpers', () => {
    describe('isOrganizationScopeUsable', () => {
      it('is true for global and organization scopes', () => {
        expect(isOrganizationScopeUsable({ scope: 'global', organizationIds: [] })).toBe(true);
        expect(isOrganizationScopeUsable({ scope: 'organization', organizationIds: ['org-1'] })).toBe(true);
      });

      it('is false for none and unassigned scopes', () => {
        expect(isOrganizationScopeUsable({ scope: 'none', organizationIds: [] })).toBe(false);
        expect(isOrganizationScopeUsable({ scope: 'unassigned', organizationIds: [] })).toBe(false);
      });
    });

    describe('applyOrganizationScopeFilter', () => {
      it('merges an $in filter on fieldName for an organization scope', () => {
        const query = { specimenStatus: 'available' };
        const result = applyOrganizationScopeFilter(query, { scope: 'organization', organizationIds: ['org-1', 'org-2'] }, 'collectionSite');

        expect(result).toBe(query);
        expect(query).toEqual({ specimenStatus: 'available', collectionSite: { $in: ['org-1', 'org-2'] } });
      });

      it('is a no-op for a global scope', () => {
        const query = { specimenStatus: 'available' };
        applyOrganizationScopeFilter(query, { scope: 'global', organizationIds: [] }, 'collectionSite');

        expect(query).toEqual({ specimenStatus: 'available' });
      });
    });

    describe('isRecordInOrganizationScope', () => {
      it('is true for a global scope regardless of the record', () => {
        expect(isRecordInOrganizationScope({ collectionSite: 'org-9' }, { scope: 'global', organizationIds: [] }, 'collectionSite')).toBe(true);
        expect(isRecordInOrganizationScope({}, { scope: 'global', organizationIds: [] }, 'collectionSite')).toBe(true);
      });

      it('is true when the record field is one of the scoped organizations', () => {
        const scope = { scope: 'organization', organizationIds: ['org-1', 'org-2'] };
        expect(isRecordInOrganizationScope({ collectionSite: 'org-2' }, scope, 'collectionSite')).toBe(true);
      });

      it('is false when the record field is a different organization', () => {
        const scope = { scope: 'organization', organizationIds: ['org-1'] };
        expect(isRecordInOrganizationScope({ collectionSite: 'org-9' }, scope, 'collectionSite')).toBe(false);
      });

      it('is false when the record has no value in fieldName (never assigned an organization)', () => {
        const scope = { scope: 'organization', organizationIds: ['org-1'] };
        expect(isRecordInOrganizationScope({ collectionSite: null }, scope, 'collectionSite')).toBe(false);
        expect(isRecordInOrganizationScope({}, scope, 'collectionSite')).toBe(false);
      });
    });
  });
});
