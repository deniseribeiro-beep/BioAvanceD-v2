import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { grantRoleForAccessType, changeUserRole, backfillUserRoleAssignments, userHasPermission, getActiveRoleCodes, isAuditReader, isAdministrator, findUserAccountIdsByRoleCodes, grantAdditionalRole, revokeAdditionalRole, updateAssignmentScope, listOrganizationScopes, grantOrganizationScope, revokeOrganizationScope, resolveUserOrganizationScope, isOrganizationScopeUsable, applyOrganizationScopeFilter, isRecordInOrganizationScope, resolveOrganizationIdForCreate, assertOrganizationFieldNotReparented } = require('../../src/services/rbac-assignment.service');
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

function buildDb({ users = [], roles = [], permissionDocs = [], assignments = [], organizations } = {}) {
  const usersCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => users.find((u) => matchesQuery(u, query)) || null),
    find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(users) })),
  });
  // #622: default resolves any organizationId lookup as found, so
  // pre-existing tests passing a fabricated organizationId (e.g. 'org-1')
  // keep working — pass `organizations: []` to exercise the not-found path.
  const organizationsCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => {
      if (!organizations) return { organizationId: query.organizationId };
      return organizations.find((o) => matchesQuery(o, query)) || null;
    }),
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
      if (name === 'organizations') return organizationsCollection;
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

    expect(result.granted).toHaveLength(2);
    expect(result.granted.map((a) => a.roleId).sort()).toEqual(['role-coord', 'role-tech'].sort());
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

    expect(result.granted).toHaveLength(1);
    expect(result.granted[0].roleId).toBeTruthy();
  });

  // #916/#922-adjacent: post-#427 write paths stopped stamping accessType
  // onto the User document, so a user who somehow ends up without a
  // UserRoleAssignment (and never had accessType to begin with) can no
  // longer be repaired by guessing a role -- roleName isn't on the document
  // either (same change), and every other resolver either defaults to a
  // role that was never granted or is circular (reads the assignment it
  // would be creating). The fix is to surface these users instead of
  // silently skipping them.
  it('backfillUserRoleAssignments marca como skipped (orphan) usuário sem accessType e sem assignment ativa', async () => {
    const users = [{ _id: { toString: () => 'u1' }, accessType: undefined }];
    const db = buildDb({ users, roles, assignments: [] });

    const result = await backfillUserRoleAssignments(db);

    expect(result.granted).toHaveLength(0);
    expect(result.skipped).toEqual([{ userAccountId: 'u1', reason: 'orphan-no-access-type-no-assignment' }]);
  });

  it('backfillUserRoleAssignments marca como skipped (benigno) usuário sem accessType mas com assignment ativa', async () => {
    const users = [{ _id: { toString: () => 'u1' }, accessType: undefined }];
    const assignments = [{ assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', assignmentStatus: 'active', validUntil: null }];
    const db = buildDb({ users, roles, assignments });

    const result = await backfillUserRoleAssignments(db);

    expect(result.granted).toHaveLength(0);
    expect(result.skipped).toEqual([{ userAccountId: 'u1', reason: 'no-access-type-already-assigned' }]);
  });

  it('backfillUserRoleAssignments mistura usuário com accessType (granted) e órfão sem accessType (skipped)', async () => {
    const users = [
      { _id: { toString: () => 'u1' }, accessType: 3 },
      { _id: { toString: () => 'u2' }, accessType: undefined },
    ];
    const db = buildDb({ users, roles, assignments: [] });

    const result = await backfillUserRoleAssignments(db);

    expect(result.granted).toHaveLength(1);
    expect(result.granted[0].userAccountId).toBe('u1');
    expect(result.skipped).toEqual([{ userAccountId: 'u2', reason: 'orphan-no-access-type-no-assignment' }]);
  });

  // #1125: this service's one-shot entry point is src/scripts/backfillUserRoleAssignments.js,
  // and until now it had no npm script, no compose service and no boot path --
  // the class this repo's conventions name outright: a script under
  // src/scripts/ that is neither an npm script nor invoked by a boot path or
  // compose service never runs on any stack.
  //
  // It is the sharpest member of that population because it is the DOCUMENTED
  // EXEMPLAR: docs/architecture/legacy-location-migration-mapping.md names it
  // as the pattern backfillLocationStorage.js was copied from (#461), so the
  // file the repo points at as "how a one-shot migration is shaped here" was
  // itself unrunnable while its copy got wired in #1070.
  //
  // Same shape as location-storage-backfill.service.test.js's #1070 case,
  // which is the precedent this follows.
  it('#1125: is wired as an npm script pointing at its CLI wrapper (#933: unwired scripts never effectively run)', () => {
    const pkg = require('../../package.json');

    expect(pkg.scripts['migrate:user-role-assignments']).toBe('node src/scripts/backfillUserRoleAssignments.js');
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

  // #1056: the admin-or-auditor predicate that decides who may read the
  // RNF009 audit trail. It lived inline in logs.routes.js's requireAuditReader
  // middleware while reports.routes.js reached the same `logs` collection
  // behind `viewReports` alone -- UsuarioExterno's entire permission set. It is
  // exported now so both surfaces call ONE definition and cannot drift apart
  // again; these cases pin the admission rule itself, independent of either
  // router's HTTP shaping.
  it('isAuditReader admite administrador', async () => {
    const db = buildDbWithRbac([{ userAccountId: 'admin-1', accessType: 4 }]);

    expect(await isAuditReader(db, 'admin-1')).toBe(true);
  });

  it('isAuditReader admite um portador do roleCode auditor que nao e administrador', async () => {
    const db = buildDbWithRbac([{ userAccountId: 'coord-1', accessType: 3, roleCodes: ['auditor'] }]);

    expect(await isAuditReader(db, 'coord-1')).toBe(true);
    // ...and the auditor grant is additive, not a promotion.
    expect(await isAdministrator(db, 'coord-1')).toBe(false);
  });

  it('isAuditReader recusa tecnico, coordenador e usuario externo sem grant de auditor', async () => {
    const db = buildDbWithRbac([
      { userAccountId: 'ext-1', accessType: 1 },
      { userAccountId: 'tech-1', accessType: 2 },
      { userAccountId: 'coord-1', accessType: 3 },
    ]);

    expect(await isAuditReader(db, 'ext-1')).toBe(false);
    expect(await isAuditReader(db, 'tech-1')).toBe(false);
    expect(await isAuditReader(db, 'coord-1')).toBe(false);
  });

  it('isAuditReader recusa um usuario sem assignment ativa', async () => {
    const db = buildDbWithRbac([]);

    expect(await isAuditReader(db, 'nobody')).toBe(false);
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

  // #622: mirrors #617's route-level organizationId referential check, but
  // inside rbac-assignment.service.js itself so ops-script callers that
  // bypass the routes (createFirstAdmin.js, backfillUserRoleAssignments)
  // can't write an unvalidated scopeId either.
  it('grantRoleForAccessType rejeita organizationId que não resolve a uma Organization real', async () => {
    const db = buildDb({ roles, assignments: [], organizations: [] });

    await expect(
      grantRoleForAccessType(db, { userAccountId: 'u1', accessType: 3, grantedBy: 'admin1', organizationId: 'org-inexistente' })
    ).rejects.toThrow(/organizationId/);
  });

  it('grantAdditionalRole rejeita organizationId que não resolve a uma Organization real', async () => {
    const assignments = [{ assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', assignmentStatus: 'active', validUntil: null }];
    const db = buildDb({ roles, assignments, organizations: [] });

    await expect(
      grantAdditionalRole(db, { userAccountId: 'u1', roleCode: 'auditor', grantedBy: 'admin1', organizationId: 'org-inexistente' })
    ).rejects.toThrow(/organizationId/);
  });

  it('updateAssignmentScope rejeita organizationId que não resolve a uma Organization real', async () => {
    const assignments = [
      { assignmentId: 'a1', userAccountId: 'u1', roleId: 'role-tech', scopeType: 'organization', scopeId: 'org-1', assignmentStatus: 'active', validUntil: null },
    ];
    const db = buildDb({ roles, assignments, organizations: [] });

    await expect(
      updateAssignmentScope(db, { userAccountId: 'u1', organizationId: 'org-inexistente', updatedBy: 'admin1' })
    ).rejects.toThrow(/organizationId/);
    expect(assignments.find((a) => a.assignmentId === 'a1').scopeId).toBe('org-1');
  });

  it('grantRoleForAccessType para Administrador ignora a checagem de organizationId (bypass global, mesmo com valor inválido)', async () => {
    const db = buildDb({ roles, assignments: [], organizations: [] });

    const doc = await grantRoleForAccessType(db, { userAccountId: 'u1', accessType: 4, grantedBy: 'admin1', organizationId: 'org-inexistente' });

    expect(doc.scopeType).toBe('global');
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

  // #1358: a user's role in several organizations, one assignment per scope.
  describe('#1358: several organization scopes', () => {
    const coordIn = (assignmentId, scopeId) => ({ assignmentId, userAccountId: 'u1', roleId: 'role-coord', scopeType: 'organization', scopeId, assignmentStatus: 'active', validUntil: null });
    const active = (assignments) => assignments.filter((a) => a.assignmentStatus === 'active');

    it('grantOrganizationScope adds an assignment of the primary role for the new organization, and resolveUserOrganizationScope sees both', async () => {
      const assignments = [coordIn('a1', 'org-1')];
      const db = buildDb({ roles, assignments });

      const { assignment, created } = await grantOrganizationScope(db, { userAccountId: 'u1', organizationId: 'org-2', grantedBy: 'admin1' });

      expect(created).toBe(true);
      expect(assignment).toMatchObject({ roleId: 'role-coord', scopeType: 'organization', scopeId: 'org-2', grantedBy: 'admin1' });
      expect(await resolveUserOrganizationScope(db, 'u1')).toEqual({ scope: 'organization', organizationIds: ['org-1', 'org-2'] });
      expect(await listOrganizationScopes(db, 'u1')).toEqual({ global: false, organizationIds: ['org-1', 'org-2'] });
    });

    it('grantOrganizationScope is idempotent for an organization already held', async () => {
      const assignments = [coordIn('a1', 'org-1')];
      const db = buildDb({ roles, assignments });

      const { assignment, created } = await grantOrganizationScope(db, { userAccountId: 'u1', organizationId: 'org-1', grantedBy: 'admin1' });

      expect(created).toBe(false);
      expect(assignment.assignmentId).toBe('a1');
      expect(assignments).toHaveLength(1);
    });

    it('grantOrganizationScope extends the primary role only, never an additive auditor grant', async () => {
      const assignments = [
        { ...coordIn('a1', 'org-1'), roleId: 'role-auditor' },
        { ...coordIn('a2', 'org-1'), roleId: 'role-tech' },
      ];
      const db = buildDb({ roles, assignments });

      const { assignment } = await grantOrganizationScope(db, { userAccountId: 'u1', organizationId: 'org-2', grantedBy: 'admin1' });

      expect(assignment.roleId).toBe('role-tech');
    });

    it('grantOrganizationScope refuses an Administrador (global), a user with no scoped primary role, and an unknown organization', async () => {
      const admin = buildDb({ roles, assignments: [{ ...coordIn('a1', null), roleId: 'role-admin', scopeType: 'global' }] });
      await expect(grantOrganizationScope(admin, { userAccountId: 'u1', organizationId: 'org-2', grantedBy: 'admin1' }))
        .rejects.toMatchObject({ statusCode: 409 });

      const none = buildDb({ roles, assignments: [] });
      await expect(grantOrganizationScope(none, { userAccountId: 'u1', organizationId: 'org-2', grantedBy: 'admin1' }))
        .rejects.toMatchObject({ statusCode: 409 });

      const unknown = buildDb({ roles, assignments: [coordIn('a1', 'org-1')], organizations: [] });
      await expect(grantOrganizationScope(unknown, { userAccountId: 'u1', organizationId: 'org-x', grantedBy: 'admin1' }))
        .rejects.toThrow(/organizationId/);
    });

    it('revokeOrganizationScope revokes that organization and refuses the last one', async () => {
      const assignments = [coordIn('a1', 'org-1'), coordIn('a2', 'org-2')];
      const db = buildDb({ roles, assignments });

      const revoked = await revokeOrganizationScope(db, { userAccountId: 'u1', organizationId: 'org-2', revokedBy: 'admin1' });

      expect(revoked.map((a) => a.assignmentId)).toEqual(['a2']);
      expect(assignments.find((a) => a.assignmentId === 'a2')).toMatchObject({ assignmentStatus: 'revoked', revokedBy: 'admin1', revocationReason: 'scope_removed' });
      expect(await revokeOrganizationScope(db, { userAccountId: 'u1', organizationId: 'org-9', revokedBy: 'admin1' })).toEqual([]);
      await expect(revokeOrganizationScope(db, { userAccountId: 'u1', organizationId: 'org-1', revokedBy: 'admin1' }))
        .rejects.toMatchObject({ statusCode: 409 });
      expect(active(assignments).map((a) => a.scopeId)).toEqual(['org-1']);
    });

    it('updateAssignmentScope given the previous home organization moves only its assignment, and merges into one already held', async () => {
      const assignments = [coordIn('a1', 'org-1'), coordIn('a2', 'org-2')];
      const db = buildDb({ roles, assignments });

      await updateAssignmentScope(db, { userAccountId: 'u1', organizationId: 'org-3', previousOrganizationId: 'org-1', updatedBy: 'admin1' });
      expect(active(assignments).map((a) => a.scopeId).sort()).toEqual(['org-2', 'org-3']);

      await updateAssignmentScope(db, { userAccountId: 'u1', organizationId: 'org-2', previousOrganizationId: 'org-3', updatedBy: 'admin1' });
      expect(active(assignments).map((a) => a.scopeId)).toEqual(['org-2']);
      expect(assignments.find((a) => a.assignmentId === 'a1').revocationReason).toBe('scope_merged');
    });

    it('changeUserRole keeps every organization the old role held', async () => {
      const assignments = [coordIn('a1', 'org-1'), coordIn('a2', 'org-2')];
      const db = buildDb({ roles, assignments });

      await changeUserRole(db, { userAccountId: 'u1', accessType: 2, changedBy: 'admin1', organizationId: 'org-1' });

      const now = active(assignments);
      expect(now.every((a) => a.roleId === 'role-tech')).toBe(true);
      expect(now.map((a) => a.scopeId).sort()).toEqual(['org-1', 'org-2']);
    });

    it('changeUserRole to Administrador leaves one global assignment', async () => {
      const assignments = [coordIn('a1', 'org-1'), coordIn('a2', 'org-2')];
      const db = buildDb({ roles, assignments });

      await changeUserRole(db, { userAccountId: 'u1', accessType: 4, changedBy: 'admin1', organizationId: 'org-1' });

      expect(active(assignments)).toHaveLength(1);
      expect(active(assignments)[0]).toMatchObject({ roleId: 'role-admin', scopeType: 'global' });
    });
  });

  it('backfillUserRoleAssignments usa organizationId do usuário, com fallback para organizationIds[0]', async () => {
    const users = [
      { _id: { toString: () => 'u1' }, accessType: 3, organizationId: 'org-1' },
      { _id: { toString: () => 'u2' }, accessType: 2, organizationId: null, organizationIds: ['org-2', 'org-3'] },
    ];
    const db = buildDb({ users, roles, assignments: [] });

    const result = await backfillUserRoleAssignments(db);

    const byUser = Object.fromEntries(result.granted.map((a) => [a.userAccountId, a]));
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

      // #637: Report.organizationIds is an array field (a single report can
      // span multiple scoped organizations, unlike collectionSite/
      // organizationId's single-org fields) -- an overlap check, not
      // strict equality/membership against a scalar.
      describe('array-valued record field (#637)', () => {
        it('is true when any element of the record field array overlaps the scoped organizations', () => {
          const scope = { scope: 'organization', organizationIds: ['org-1', 'org-2'] };
          expect(isRecordInOrganizationScope({ organizationIds: ['org-9', 'org-2'] }, scope, 'organizationIds')).toBe(true);
        });

        it('is false when no element of the record field array overlaps the scoped organizations', () => {
          const scope = { scope: 'organization', organizationIds: ['org-1'] };
          expect(isRecordInOrganizationScope({ organizationIds: ['org-9'] }, scope, 'organizationIds')).toBe(false);
        });

        it('is false when the record field is an empty array (unstamped/legacy)', () => {
          const scope = { scope: 'organization', organizationIds: ['org-1'] };
          expect(isRecordInOrganizationScope({ organizationIds: [] }, scope, 'organizationIds')).toBe(false);
        });

        it('is true for a global scope regardless of the array field', () => {
          expect(isRecordInOrganizationScope({ organizationIds: [] }, { scope: 'global', organizationIds: [] }, 'organizationIds')).toBe(true);
        });
      });
    });
  });
});

// #1071: resolveOrganizationIdForCreate decides which organizationId a CREATE
// stamps. The multi-organization branch is unreachable through every route
// and script in this repo -- each writer of a UserRoleAssignment scope
// funnels through a single scalar -- so these are the ONLY tests that reach
// it, and they exist because the branch that guesses is the one that would be
// wrong.
describe('#1071: resolveOrganizationIdForCreate', () => {
  it('stamps the single scoped organization and ignores the body', () => {
    const scope = { scope: 'organization', organizationIds: ['org-a'] };
    expect(resolveOrganizationIdForCreate(scope, 'org-b')).toBe('org-a');
  });

  it('stamps the single scoped organization when the body omits it', () => {
    const scope = { scope: 'organization', organizationIds: ['org-a'] };
    expect(resolveOrganizationIdForCreate(scope, undefined)).toBe('org-a');
  });

  it('leaves a global (Administrador) caller unconstrained', () => {
    const scope = { scope: 'global', organizationIds: [] };
    expect(resolveOrganizationIdForCreate(scope, 'org-b')).toBe('org-b');
    expect(resolveOrganizationIdForCreate(scope, undefined)).toBeNull();
  });

  it('accepts a body value that names one of several scoped organizations', () => {
    const scope = { scope: 'organization', organizationIds: ['org-a', 'org-b'] };
    expect(resolveOrganizationIdForCreate(scope, 'org-b')).toBe('org-b');
  });

  it('refuses to guess when several organizations are in scope and the body names none', () => {
    const scope = { scope: 'organization', organizationIds: ['org-a', 'org-b'] };
    expect(() => resolveOrganizationIdForCreate(scope, undefined)).toThrow(/mais de uma organiza/);
  });

  it('refuses a body value outside a multi-organization scope', () => {
    const scope = { scope: 'organization', organizationIds: ['org-a', 'org-b'] };
    expect(() => resolveOrganizationIdForCreate(scope, 'org-z')).toThrow(/mais de uma organiza/);
  });

  // Fail CLOSED: a missing scope means requireOrganizationScope is not on the
  // route. Falling back to the body there would restore exactly the trust
  // this function removes.
  it('throws 403 when no scope was resolved at all', () => {
    expect(() => resolveOrganizationIdForCreate(undefined, 'org-b')).toThrow(/Escopo organizacional/);
    try {
      resolveOrganizationIdForCreate(undefined, 'org-b');
    } catch (error) {
      expect(error.statusCode).toBe(403);
    }
  });

  it('throws 403 for an unassigned scope', () => {
    expect(() => resolveOrganizationIdForCreate({ scope: 'unassigned', organizationIds: [] }, 'org-b'))
      .toThrow(/Sem organiza/);
  });
});

// #1053: the update-side twin. A create CHOOSES an organization; an update
// MOVES a record between them, so the rule is narrower -- an organization-
// scoped caller may re-send the value the record already has, and nothing
// else.
describe('#1053: assertOrganizationFieldNotReparented', () => {
  const scoped = { scope: 'organization', organizationIds: ['org-a'] };

  it('allows an absent value (the field is not being touched)', () => {
    expect(() => assertOrganizationFieldNotReparented(scoped, 'org-a', undefined)).not.toThrow();
  });

  it('allows re-sending the value the record already has', () => {
    expect(() => assertOrganizationFieldNotReparented(scoped, 'org-a', 'org-a')).not.toThrow();
  });

  it('refuses a move to another organization with 403', () => {
    expect(() => assertOrganizationFieldNotReparented(scoped, 'org-a', 'org-b')).toThrow(/outra organiza/);
    try {
      assertOrganizationFieldNotReparented(scoped, 'org-a', 'org-b');
    } catch (error) {
      expect(error.statusCode).toBe(403);
    }
  });

  it('refuses clearing the field to null', () => {
    expect(() => assertOrganizationFieldNotReparented(scoped, 'org-a', null)).toThrow(/outra organiza/);
  });

  it('leaves a global (Administrador) caller unconstrained', () => {
    expect(() => assertOrganizationFieldNotReparented({ scope: 'global', organizationIds: [] }, 'org-a', 'org-b')).not.toThrow();
  });

  it('compares as strings, so a numeric id matching the record is allowed', () => {
    expect(() => assertOrganizationFieldNotReparented(scoped, 7, '7')).not.toThrow();
  });

  it('names the field in the message, so it can be reused for collectionSite', () => {
    expect(() => assertOrganizationFieldNotReparented(scoped, 'a', 'b', 'collectionSite')).toThrow(/collectionSite/);
  });

  // #1183: a missing scope means requireOrganizationScope is not on the
  // route -- every real caller, global included, has a scope object. The
  // create-side twin fails closed on that; this one used to return, a
  // guaranteed no-op on a mis-wired route.
  it('fails closed with 403 when no scope was resolved and the field is being written', () => {
    expect(() => assertOrganizationFieldNotReparented(undefined, 'org-a', 'org-b')).toThrow(/Escopo organizacional/);
    try {
      assertOrganizationFieldNotReparented(null, 'org-a', 'org-a');
    } catch (error) {
      expect(error.statusCode).toBe(403);
      return;
    }
    throw new Error('expected a throw for a missing scope even when the value is unchanged');
  });

  it('CONTROL: a missing scope is harmless when the field is not being written', () => {
    expect(() => assertOrganizationFieldNotReparented(undefined, 'org-a', undefined)).not.toThrow();
  });
});
