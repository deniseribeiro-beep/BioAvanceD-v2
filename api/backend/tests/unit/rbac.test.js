import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { requireRole, requirePermission, requireOrganizationScope, permissions } = require('../../src/infrastructure/middleware/rbac');
const auditLogger = require('../../src/utils/auditLogger');
const { createCollectionMock } = require('../factories/db.factory');

function flushSetImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

function matchesQuery(doc, query = {}) {
  return Object.entries(query).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in cond) {
      return cond.$in.includes(doc[key]);
    }
    return doc[key] === cond;
  });
}

/**
 * #421: real query-matching mocks (findOne/find honor the actual filter,
 * not canned data) for roles/permissions/userRoleAssignments — this repo's
 * "real backend" proof bar for a backend-internal slice (no live-Mongo
 * tier exists here; see build-loop's local-env overlay).
 */
function buildRbacDb({ roles = [], permissionDocs = [], assignments = [] } = {}) {
  const rolesCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => roles.find((r) => matchesQuery(r, query)) || null),
    find: vi.fn((query = {}) => ({
      toArray: vi.fn().mockResolvedValue(roles.filter((r) => matchesQuery(r, query))),
    })),
  });
  const permissionsCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => permissionDocs.find((p) => matchesQuery(p, query)) || null),
    find: vi.fn((query = {}) => ({
      toArray: vi.fn().mockResolvedValue(permissionDocs.filter((p) => matchesQuery(p, query))),
    })),
  });
  const assignmentsCollection = createCollectionMock({
    findOne: vi.fn(async (query = {}) => assignments.find((a) => matchesQuery(a, query)) || null),
    find: vi.fn((query = {}) => ({
      toArray: vi.fn().mockResolvedValue(assignments.filter((a) => matchesQuery(a, query))),
    })),
  });

  return {
    collection: (name) => {
      if (name === 'roles') return rolesCollection;
      if (name === 'permissions') return permissionsCollection;
      if (name === 'userRoleAssignments') return assignmentsCollection;
      return createCollectionMock();
    },
  };
}

const coordinatorRole = {
  roleId: 'role-coordinator',
  roleCode: 'coordinator',
  hierarchyLevel: 3,
  roleStatus: 'active',
  permissionIds: ['perm-createUser'],
};
const externalRole = {
  roleId: 'role-external',
  roleCode: 'external_user',
  hierarchyLevel: 1,
  roleStatus: 'active',
  permissionIds: ['perm-viewReports'],
};
const permissionDocs = [
  { permissionId: 'perm-createUser', permissionCode: 'createUser' },
  { permissionId: 'perm-viewReports', permissionCode: 'viewReports' },
];

function activeAssignment(userAccountId, roleId) {
  return { userAccountId, roleId, assignmentStatus: 'active', validUntil: null };
}

describe('RBAC middleware (#421 - UserRoleAssignment -> Role -> Permission)', () => {
  const createRes = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  });

  let req;
  let res;
  let next;

  beforeEach(() => {
    // #631: requirePermission now derives an action from req.method when
    // no explicit override is passed — default to POST (createUser's
    // allowedActions cover all four actions post-#630, so any method
    // works for the tests below that don't care about the action check).
    req = { user: null, app: { locals: {} }, method: 'POST' };
    res = createRes();
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve negar acesso sem usuário autenticado em requireRole', async () => {
    await requireRole(4)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve negar acesso sem usuário autenticado em requirePermission', async () => {
    await requirePermission('createUser')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve retornar 500 quando req.app.locals.db está indisponível', async () => {
    req.user = { userID: 'u1' };

    await requireRole(3)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve permitir coordenador em requireRole(3) via UserRoleAssignment ativo', async () => {
    req.user = { userID: 'u1' };
    req.app.locals.db = buildRbacDb({
      roles: [coordinatorRole],
      assignments: [activeAssignment('u1', 'role-coordinator')],
    });

    await requireRole(3)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('deve negar em requireRole quando a assignment ativa aponta para outro nível', async () => {
    req.user = { userID: 'u2' };
    req.app.locals.db = buildRbacDb({
      roles: [externalRole],
      assignments: [activeAssignment('u2', 'role-external')],
    });

    await requireRole(4)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve negar em requireRole quando não há nenhuma assignment ativa', async () => {
    req.user = { userID: 'u3' };
    req.app.locals.db = buildRbacDb({});

    await requireRole(1)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve permitir requirePermission(createUser) quando o papel ativo tem a permissão', async () => {
    req.user = { userID: 'u1' };
    req.app.locals.db = buildRbacDb({
      roles: [coordinatorRole],
      permissionDocs,
      assignments: [activeAssignment('u1', 'role-coordinator')],
    });

    await requirePermission('createUser')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('deve negar requirePermission(createUser) quando o papel ativo não tem a permissão', async () => {
    req.user = { userID: 'u2' };
    req.app.locals.db = buildRbacDb({
      roles: [externalRole],
      permissionDocs,
      assignments: [activeAssignment('u2', 'role-external')],
    });

    await requirePermission('createUser')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve ignorar assignment expirada (validUntil no passado)', async () => {
    req.user = { userID: 'u4' };
    req.app.locals.db = buildRbacDb({
      roles: [coordinatorRole],
      permissionDocs,
      assignments: [{ userAccountId: 'u4', roleId: 'role-coordinator', assignmentStatus: 'active', validUntil: new Date('2020-01-01') }],
    });

    await requirePermission('createUser')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve retornar 500 para permissão inexistente', async () => {
    req.user = { userID: 'u5' };
    req.app.locals.db = buildRbacDb({});

    await requirePermission('doesNotExist')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('deve expor mapa de permissões esperado (nomes válidos)', () => {
    expect(permissions.createUser).toBe(true);
    expect(permissions.manageBackup).toBe(true);
    expect(permissions.viewReports).toBe(true);
    expect(permissions.manageTemperature).toBe(true);
    expect(permissions.manageOrganizations).toBe(true);
  });

  it('#436: deve expor todas as permissões do PERMISSION_CATALOG, incluindo viewAuditLogs (#429)', () => {
    const { PERMISSION_CATALOG } = require('../../src/services/rbac-catalog-seed.service');

    for (const permissionCode of Object.keys(PERMISSION_CATALOG)) {
      expect(permissions[permissionCode]).toBe(true);
    }
  });

  it('deve registrar tentativa de acesso negado no audit log quando db está disponível', async () => {
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    req.user = { userID: 'u2' };
    req.app.locals.db = buildRbacDb({
      roles: [externalRole],
      permissionDocs,
      assignments: [activeAssignment('u2', 'role-external')],
    });

    await requirePermission('createUser')(req, res, next);
    await flushSetImmediate();

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'FORBIDDEN',
      resourceType: 'Access'
    }));
  });

  // #631: requirePermission also enforces PERMISSION_CATALOG's
  // allowedActions, per-verb -- action derived from req.method by
  // default, or the explicit second arg when a route passes one (see
  // #630's audit for which call sites need the override).
  describe('requirePermission — enforcement per allowedActions (#631)', () => {
    const withdrawRole = {
      roleId: 'role-withdraw',
      roleCode: 'technician',
      hierarchyLevel: 2,
      roleStatus: 'active',
      permissionIds: ['perm-withdrawSample'],
    };
    const withdrawPermissionDocs = [
      { permissionId: 'perm-withdrawSample', permissionCode: 'withdrawSample' },
    ];

    it('permite GET viewReports — ação READ derivada do método, sem override', async () => {
      req.user = { userID: 'u1' };
      req.method = 'GET';
      req.app.locals.db = buildRbacDb({
        roles: [externalRole],
        permissionDocs,
        assignments: [activeAssignment('u1', 'role-external')],
      });

      await requirePermission('viewReports')(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('nega POST withdrawSample sem override — CREATE derivado do método não está em allowedActions (["UPDATE"])', async () => {
      req.user = { userID: 'u1' };
      req.method = 'POST';
      req.app.locals.db = buildRbacDb({
        roles: [withdrawRole],
        permissionDocs: withdrawPermissionDocs,
        assignments: [activeAssignment('u1', 'role-withdraw')],
      });

      await requirePermission('withdrawSample')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('permite POST withdrawSample com override explícito UPDATE, mesmo o método sendo POST', async () => {
      req.user = { userID: 'u1' };
      req.method = 'POST';
      req.app.locals.db = buildRbacDb({
        roles: [withdrawRole],
        permissionDocs: withdrawPermissionDocs,
        assignments: [activeAssignment('u1', 'role-withdraw')],
      });

      await requirePermission('withdrawSample', 'UPDATE')(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // #340 (RF003 AC#3): org-scope enforcement gate for sample/patient
  // list+detail endpoints. Product decisions confirmed 2026-08-18: an
  // org-less user hard-403s (not empty-list), only a hierarchyLevel-4
  // (Administrador) assignment bypasses scoping.
  describe('requireOrganizationScope', () => {
    const adminRole = { roleId: 'role-admin', roleCode: 'administrador', hierarchyLevel: 4, roleStatus: 'active' };

    it('deve negar acesso sem usuário autenticado', async () => {
      await requireOrganizationScope(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve retornar 500 quando db indisponível', async () => {
      req.user = { userID: 'u1' };

      await requireOrganizationScope(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve negar com 403 quando o usuário não tem nenhuma assignment ativa (scope none)', async () => {
      req.user = { userID: 'u1' };
      req.app.locals.db = buildRbacDb({});

      await requireOrganizationScope(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve negar com 403 quando a assignment organization-scoped não tem scopeId (unassigned)', async () => {
      req.user = { userID: 'u1' };
      req.app.locals.db = buildRbacDb({
        roles: [coordinatorRole],
        assignments: [{ userAccountId: 'u1', roleId: 'role-coordinator', scopeType: 'organization', scopeId: null, assignmentStatus: 'active', validUntil: null }],
      });

      await requireOrganizationScope(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('deve seguir adiante com scope global para Administrador (hierarchyLevel 4)', async () => {
      req.user = { userID: 'u1' };
      req.app.locals.db = buildRbacDb({
        roles: [adminRole],
        assignments: [{ userAccountId: 'u1', roleId: 'role-admin', scopeType: 'global', scopeId: null, assignmentStatus: 'active', validUntil: null }],
      });

      await requireOrganizationScope(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.organizationScope).toEqual({ scope: 'global', organizationIds: [] });
    });

    it('deve seguir adiante com scope organization e anexar organizationIds em req.organizationScope', async () => {
      req.user = { userID: 'u1' };
      req.app.locals.db = buildRbacDb({
        roles: [coordinatorRole],
        assignments: [{ userAccountId: 'u1', roleId: 'role-coordinator', scopeType: 'organization', scopeId: 'org-1', assignmentStatus: 'active', validUntil: null }],
      });

      await requireOrganizationScope(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.organizationScope).toEqual({ scope: 'organization', organizationIds: ['org-1'] });
    });
  });
});
