import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildUser, buildUserRegistrationPayload } = require('../factories/user.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function createCoordinatorToken() {
  return jwt.sign(
    {
      userID: 'qa-coord-1',
      accessType: 3,
      roleName: 'Coordenador',
      name: 'QA Coordenador',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('RF003 - POST /api/users/register', () => {
  function givenAuthenticatedSession() {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
  }

  function givenUsersCollection(overrides = {}) {
    const usersCollection = createCollectionMock(overrides);
    app.locals.db = createDbMock({
      users: usersCollection,
      ...buildRbacCollections([{ userAccountId: 'qa-coord-1', accessType: 3 }]),
    });
    return usersCollection;
  }

  async function whenRegisterUser(payload) {
    return request(app)
      .post('/api/users/register')
      .set('Authorization', `Bearer ${createCoordinatorToken()}`)
      .send(payload);
  }

  beforeEach(() => {
    givenAuthenticatedSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve bloquear criação de usuário com senha fraca (regex)', async () => {
    // Given
    givenUsersCollection({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn(),
      updateOne: vi.fn(),
    });

    // When
    const response = await whenRegisterUser(
      buildUserRegistrationPayload({
        name: 'Usuário Fraco',
        email: 'fraco.qa@example.com',
        username: 'fraco.qa',
        password: '12345678',
      })
    );

    // Then
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(String(response.body.message || '').toLowerCase()).toContain('password');
    expect(String(response.body.message || '').toLowerCase()).toContain('senha');
  });

  it('deve bloquear criação de usuário com e-mail já existente', async () => {
    // Given
    const findOne = vi.fn().mockResolvedValueOnce(
      buildUser({
        _id: 'existing-user-1',
        email: 'duplicado.qa@example.com',
        username: 'ja.existe',
      })
    );
    const insertOne = vi.fn();
    givenUsersCollection({ findOne, insertOne, updateOne: vi.fn() });

    // When
    const response = await whenRegisterUser(
      buildUserRegistrationPayload({
        name: 'Usuário Duplicado',
        email: 'duplicado.qa@example.com',
        username: 'novo.username',
      })
    );

    // Then
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(String(response.body.message || '').toLowerCase()).toContain('já cadastrado');
    expect(insertOne).not.toHaveBeenCalled();
  });

  it('#615: cria a UserRoleAssignment com scopeType/scopeId a partir do organizationId do payload', async () => {
    // Given
    const usersCollection = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-user-1' }),
      updateOne: vi.fn(),
    });
    const rbacCollections = buildRbacCollections([{ userAccountId: 'qa-coord-1', accessType: 3 }]);
    const organizationsCollection = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ organizationId: 'org-1' }),
    });
    app.locals.db = createDbMock({ users: usersCollection, organizations: organizationsCollection, ...rbacCollections });

    // When
    const response = await whenRegisterUser(
      buildUserRegistrationPayload({
        name: 'Usuário Escopo',
        email: 'escopo.qa@example.com',
        username: 'escopo.qa',
        accessType: 2,
        organizationId: 'org-1',
      })
    );

    // Then
    expect(response.status).toBe(201);
    expect(rbacCollections.userRoleAssignments.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: 'organization', scopeId: 'org-1' })
    );
  });

  it('#617: rejeita organizationId que não resolve a uma Organization real', async () => {
    // Given
    const usersCollection = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn(),
      updateOne: vi.fn(),
    });
    const rbacCollections = buildRbacCollections([{ userAccountId: 'qa-coord-1', accessType: 3 }]);
    const organizationsCollection = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
    });
    app.locals.db = createDbMock({ users: usersCollection, organizations: organizationsCollection, ...rbacCollections });

    // When
    const response = await whenRegisterUser(
      buildUserRegistrationPayload({
        name: 'Usuário Org Inválida',
        email: 'org-invalida.qa@example.com',
        username: 'org.invalida.qa',
        accessType: 2,
        organizationId: 'org-inexistente',
      })
    );

    // Then
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(String(response.body.message || '')).toContain('org-inexistente');
    expect(usersCollection.insertOne).not.toHaveBeenCalled();
  });
});

describe('resetMFA permission enforcement (#632)', () => {
  const { PERMISSION_CATALOG } = require('../../src/services/rbac-catalog-seed.service');

  function matchesQuery(doc, query = {}) {
    return Object.entries(query).every(([key, cond]) => {
      if (cond && typeof cond === 'object' && '$in' in cond) return cond.$in.includes(doc[key]);
      return doc[key] === cond;
    });
  }
  function queryableCollectionMock(docs) {
    return createCollectionMock({
      findOne: vi.fn(async (query = {}) => docs.find((d) => matchesQuery(d, query)) || null),
      find: vi.fn((query = {}) => ({ toArray: vi.fn().mockResolvedValue(docs.filter((d) => matchesQuery(d, query))) })),
    });
  }
  // #632: today's hand-rolled `isAdministrator()` check gates strictly on
  // roleCode === 'administrator' — it ignores the RBAC Permission catalog
  // entirely, so a non-administrator role explicitly granted `resetMFA`
  // (the same additive-role shape #429's `auditor` already uses for
  // `viewAuditLogs`) is wrongly denied. requirePermission('resetMFA')
  // must allow it.
  function buildMfaOperatorCollections() {
    const permissionDocs = Object.entries(PERMISSION_CATALOG).map(([permissionCode, entry]) => ({
      permissionId: `perm-${permissionCode}`,
      permissionCode,
      ...entry,
    }));
    return {
      roles: queryableCollectionMock([
        { roleId: 'role-mfa-operator', roleCode: 'mfa_operator', hierarchyLevel: null, roleStatus: 'active', permissionIds: ['perm-resetMFA'] },
      ]),
      permissions: queryableCollectionMock(permissionDocs),
      userRoleAssignments: queryableCollectionMock([
        { userAccountId: 'qa-mfa-operator', roleId: 'role-mfa-operator', assignmentStatus: 'active', validUntil: null },
      ]),
    };
  }
  function mfaOperatorToken() {
    return jwt.sign(
      { userID: 'qa-mfa-operator', accessType: 2, roleName: 'Técnico', name: 'QA MFA Operator', mfaVerified: true },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('allows a non-administrator role explicitly granted resetMFA', async () => {
    const usersCollection = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: 'user-target-1', accessType: 2, roleName: 'Técnico', mfaEnabled: true }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    });
    app.locals.db = createDbMock({ users: usersCollection, ...buildMfaOperatorCollections() });

    const response = await request(app)
      .post('/api/users/user-target-1/reset-mfa')
      .set('Authorization', `Bearer ${mfaOperatorToken()}`);

    expect(response.status).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalled();
  });
});

// #933 direction 2: POST /:id/reset-mfa refused an administrator target
// outright (400, no write), which is the one branch that leaves a locked
// administrator with no non-destructive in-app remedy. `disable-mfa` does
// clear the lock for an admin target, but only by switching the second
// factor OFF (mfaEnabled:false) -- so nothing in the application could
// clear mfaLocked while LEAVING the enrolment intact, for any target.
//
// RF003 AC#5 (docs/docs-7-27-2026/extracted/requisitos-index.md:49) asks for
// "Revogar sessoes e permitir redefinicao CONTROLADA do MFA", and RF003's
// own requirement line (:39) puts MFA lifecycle for user accounts under the
// Administrador with no carve-out excluding administrator targets. The
// sensitive half is the secret (dict-02 P1X-0197, "Nunca retornar na API de
// consulta"), not the lock flags (P1X-0199/P1X-0200) -- so the refusal is
// narrowed to the secret rather than applied to the whole operation.
describe('reset-mfa on an administrator target unlocks without re-enrolling (#933)', () => {
  const { PERMISSION_CATALOG } = require('../../src/services/rbac-catalog-seed.service');

  function matchesQuery(doc, query = {}) {
    return Object.entries(query).every(([key, cond]) => {
      if (cond && typeof cond === 'object' && '$in' in cond) return cond.$in.includes(doc[key]);
      return doc[key] === cond;
    });
  }
  function queryableCollectionMock(docs) {
    return createCollectionMock({
      findOne: vi.fn(async (query = {}) => docs.find((d) => matchesQuery(d, query)) || null),
      find: vi.fn((query = {}) => ({ toArray: vi.fn().mockResolvedValue(docs.filter((d) => matchesQuery(d, query))) })),
    });
  }

  const permissionDocs = () => Object.entries(PERMISSION_CATALOG).map(([permissionCode, entry]) => ({
    permissionId: `perm-${permissionCode}`,
    permissionCode,
    ...entry,
  }));

  // `assignments` decides which userAccountIds resolve to roleCode
  // 'administrator' -- which is exactly what isAdministrator() reads, for the
  // CALLER (permission) and for the TARGET (the refusal under test).
  function buildCollections(assignments) {
    return {
      roles: queryableCollectionMock([
        { roleId: 'role-administrator', roleCode: 'administrator', hierarchyLevel: 4, roleStatus: 'active', permissionIds: ['perm-resetMFA'] },
        { roleId: 'role-tecnico', roleCode: 'tecnico', hierarchyLevel: 2, roleStatus: 'active', permissionIds: [] },
      ]),
      permissions: queryableCollectionMock(permissionDocs()),
      userRoleAssignments: queryableCollectionMock(assignments.map((a) => ({
        userAccountId: a.userAccountId,
        roleId: a.roleId,
        assignmentStatus: 'active',
        validUntil: null,
      }))),
    };
  }

  function adminCallerToken() {
    return jwt.sign(
      { userID: 'qa-admin-caller', accessType: 4, roleName: 'Administrador', name: 'QA Admin', mfaVerified: true },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  function setFrom(updateOneMock) {
    return updateOneMock.mock.calls[0][1].$set;
  }

  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
    vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue({ revoked: 0 });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('clears the lock flags on an administrator target and preserves mfaSecret/mfaEnabled', async () => {
    const usersCollection = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({
        _id: 'admin-target-1', roleName: 'Administrador',
        mfaEnabled: true, mfaSecret: 'SECRET-DO-NOT-CLEAR', mfaLocked: true, mfaFailedAttempts: 5,
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    });
    app.locals.db = createDbMock({
      users: usersCollection,
      ...buildCollections([
        { userAccountId: 'qa-admin-caller', roleId: 'role-administrator' },
        { userAccountId: 'admin-target-1', roleId: 'role-administrator' },
      ]),
    });

    const response = await request(app)
      .post('/api/users/admin-target-1/reset-mfa')
      .set('Authorization', `Bearer ${adminCallerToken()}`);

    expect(response.status).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalledTimes(1);

    const $set = setFrom(usersCollection.updateOne);
    expect($set.mfaLocked).toBe(false);
    expect($set.mfaFailedAttempts).toBe(0);
    // The enrolment is deliberately untouched: this is an unlock, not a reset.
    expect($set).not.toHaveProperty('mfaSecret');
    expect($set).not.toHaveProperty('mfaEnabled');
    expect($set).not.toHaveProperty('lastLogin');
  });

  // CONTROL: the non-administrator path is unchanged by this fix and must be
  // green both before and after it. A red control here means the harness, not
  // the bug (#695).
  it('CONTROL: a non-administrator target still gets the full reset, secret nulled', async () => {
    const usersCollection = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({
        _id: 'tecnico-target-1', roleName: 'Tecnico',
        mfaEnabled: true, mfaSecret: 'SECRET-SHOULD-BE-CLEARED', mfaLocked: true, mfaFailedAttempts: 5,
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    });
    app.locals.db = createDbMock({
      users: usersCollection,
      ...buildCollections([
        { userAccountId: 'qa-admin-caller', roleId: 'role-administrator' },
        { userAccountId: 'tecnico-target-1', roleId: 'role-tecnico' },
      ]),
    });

    const response = await request(app)
      .post('/api/users/tecnico-target-1/reset-mfa')
      .set('Authorization', `Bearer ${adminCallerToken()}`);

    expect(response.status).toBe(200);
    const $set = setFrom(usersCollection.updateOne);
    expect($set.mfaSecret).toBeNull();
    expect($set.mfaEnabled).toBe(false);
    expect($set.mfaLocked).toBe(false);
    expect(sessionService.invalidateUserSessions).toHaveBeenCalled();
  });
});
