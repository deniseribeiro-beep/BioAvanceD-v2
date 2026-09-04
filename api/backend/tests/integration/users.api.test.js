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

// #1031: user.routes.js requires auditLogger LAZILY inside its handlers, so a
// spy on the shared CJS module object is observed at call time -- the pattern
// #1017/#1025 established for this directory. vi.mock would not work here even
// at the correct depth: vitest's mock registry is not consulted by the require
// a handler actually executes.
const auditLogger = require('../../src/utils/auditLogger');

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


// #1031: reset-mfa writes no explicit audit row, so the only record of it is
// the generic middleware row -- and that row is derived from the PATH, with a
// payload of {method, path, statusCode, duration, query} and no response body.
// Since f24b853e (#933) this one path does two materially different things:
// a full reset that destroys a second factor and revokes every session, and an
// unlock that clears two counters. Both answer 200 on the same path, so the
// two rows are identical apart from the target id. Before #933 the admin
// branch answered 400, so status code alone separated them; making the
// operation succeed is what collapsed them.
describe('reset-mfa writes a distinguishable audit row per branch (#1031)', () => {
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
  function buildCollections(assignments) {
    return {
      roles: queryableCollectionMock([
        { roleId: 'role-administrator', roleCode: 'administrator', hierarchyLevel: 4, roleStatus: 'active', permissionIds: ['perm-resetMFA'] },
        { roleId: 'role-tecnico', roleCode: 'tecnico', hierarchyLevel: 2, roleStatus: 'active', permissionIds: [] },
      ]),
      permissions: queryableCollectionMock(Object.entries(PERMISSION_CATALOG).map(([permissionCode, entry]) => ({
        permissionId: `perm-${permissionCode}`, permissionCode, ...entry,
      }))),
      userRoleAssignments: queryableCollectionMock(assignments.map((a) => ({
        userAccountId: a.userAccountId, roleId: a.roleId, assignmentStatus: 'active', validUntil: null,
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
  function auditRowsFor(resourceId) {
    return auditLogger.log.mock.calls
      .map((call) => call[0])
      .filter((row) => row && row.resourceType === 'User' && row.resourceId === resourceId);
  }

  let logSpy;

  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
    vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue({ revoked: 0 });
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function givenTarget(id, roleId, doc) {
    const usersCollection = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: id, ...doc }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    });
    app.locals.db = createDbMock({
      users: usersCollection,
      ...buildCollections([
        { userAccountId: 'qa-admin-caller', roleId: 'role-administrator' },
        { userAccountId: id, roleId },
      ]),
    });
    return usersCollection;
  }

  it('the UNLOCK branch writes a row naming the unlock and the preserved enrolment', async () => {
    givenTarget('admin-target-1', 'role-administrator', {
      roleName: 'Administrador', mfaEnabled: true, mfaSecret: 'S', mfaLocked: true, mfaFailedAttempts: 5,
    });

    const response = await request(app)
      .post('/api/users/admin-target-1/reset-mfa')
      .set('Authorization', `Bearer ${adminCallerToken()}`);

    expect(response.status).toBe(200);
    const rows = auditRowsFor('admin-target-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ operation: 'unlock', enrolmentPreserved: true });
    // #1042: pins the `secondFactorActive: true` at the unlock call site.
    // It was behaviour-preserving when #1033 introduced it -- unlock graded
    // 'info' before and after -- so NOTHING was pinning it. Deleting that one
    // property (plausible in a refactor: it reads as redundant beside
    // `enrolmentPreserved: true`) silently regraded every MFA unlock as
    // 'critical'. This assertion is what goes red if it disappears.
    expect(rows[0].severity).toBe('info');
    expect(rows[0].payload).toMatchObject({ secondFactorActive: true });
  });

  it('the FULL RESET branch writes a row naming the reset and the removed enrolment', async () => {
    givenTarget('tecnico-target-1', 'role-tecnico', {
      roleName: 'Tecnico', mfaEnabled: true, mfaSecret: 'S', mfaLocked: true, mfaFailedAttempts: 5,
    });

    const response = await request(app)
      .post('/api/users/tecnico-target-1/reset-mfa')
      .set('Authorization', `Bearer ${adminCallerToken()}`);

    expect(response.status).toBe(200);
    const rows = auditRowsFor('tecnico-target-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ operation: 'reset', enrolmentPreserved: false });
    // #1042: same gap as the unlock pin above -- reset graded 'critical'
    // before and after #1033, so its flag was unpinned too. Note this one
    // would NOT catch a deletion (undefined and false both yield 'critical');
    // it pins the intent, and the type guard in writeMfaResetAudit is what
    // catches the omission.
    expect(rows[0].severity).toBe('critical');
    expect(rows[0].payload).toMatchObject({ secondFactorActive: false });
  });

  // CONTROL: unchanged by this fix, must be GREEN before and after (#695).
  // If this is red the harness is wrong, not the product.
  it('CONTROL: the unlock branch still leaves mfaSecret and mfaEnabled untouched', async () => {
    const usersCollection = givenTarget('admin-target-2', 'role-administrator', {
      roleName: 'Administrador', mfaEnabled: true, mfaSecret: 'S', mfaLocked: true, mfaFailedAttempts: 5,
    });

    const response = await request(app)
      .post('/api/users/admin-target-2/reset-mfa')
      .set('Authorization', `Bearer ${adminCallerToken()}`);

    expect(response.status).toBe(200);
    const $set = usersCollection.updateOne.mock.calls[0][1].$set;
    expect($set.mfaLocked).toBe(false);
    expect($set).not.toHaveProperty('mfaSecret');
  });
});

// #1033: disable-mfa and force-password-reset both write consequential
// changes to another user's account and, before this fix, relied entirely on
// audit.middleware's generic row -- {method, path, statusCode, duration,
// query}, no response body. audit.middleware classifies by PATH substring
// ('/mfa' -> 'MFA'), so disable-mfa landed in the SAME bucket as reset-mfa's
// two branches despite being a third, materially different operation (it
// deliberately KEEPS mfaSecret). force-password-reset contains no special
// substring, so it fell through to the bare HTTP-verb mapping (POST ->
// 'CREATE'), which is misleading for a write against an existing account.
describe('disable-mfa and force-password-reset write their own distinguishable audit rows (#1033)', () => {
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
  function buildCollections(assignments) {
    return {
      roles: queryableCollectionMock([
        {
          roleId: 'role-administrator', roleCode: 'administrator', hierarchyLevel: 4, roleStatus: 'active',
          permissionIds: ['perm-disableMFA', 'perm-forcePasswordReset'],
        },
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
  function auditRowsFor(resourceId) {
    return auditLogger.log.mock.calls
      .map((call) => call[0])
      .filter((row) => row && row.resourceType === 'User' && row.resourceId === resourceId);
  }

  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
    vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue({ revoked: 0 });
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function givenTarget(id, roleId, doc) {
    const usersCollection = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: id, ...doc }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    });
    app.locals.db = createDbMock({
      users: usersCollection,
      ...buildCollections([
        { userAccountId: 'qa-admin-caller', roleId: 'role-administrator' },
        { userAccountId: id, roleId },
      ]),
    });
    return usersCollection;
  }

  it('disable-mfa writes a row naming the disable and the preserved enrolment, distinct from reset-mfa', async () => {
    givenTarget('admin-target-1', 'role-administrator', {
      roleName: 'Administrador', mfaEnabled: true, mfaSecret: 'S', mfaLocked: true, mfaFailedAttempts: 5,
    });

    const response = await request(app)
      .post('/api/users/admin-target-1/disable-mfa')
      .set('Authorization', `Bearer ${adminCallerToken()}`);

    expect(response.status).toBe(200);
    const rows = auditRowsFor('admin-target-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ operation: 'disable', enrolmentPreserved: true });
    // Must not collide with either reset-mfa branch's operation value.
    expect(rows[0].payload.operation).not.toBe('unlock');
    expect(rows[0].payload.operation).not.toBe('reset');
  });

  it('force-password-reset writes its own row naming the forceReset flag, and it is not action MFA', async () => {
    givenTarget('tecnico-target-1', 'role-tecnico', {
      roleName: 'Tecnico', mfaEnabled: false,
    });

    const response = await request(app)
      .post('/api/users/tecnico-target-1/force-password-reset')
      .set('Authorization', `Bearer ${adminCallerToken()}`);

    expect(response.status).toBe(200);
    const rows = auditRowsFor('tecnico-target-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].action).not.toBe('MFA');
    expect(rows[0].payload).toMatchObject({ fieldsSet: expect.arrayContaining(['forceReset']) });
  });

  // #1033 follow-up: severity must track whether the account is left with an
  // ACTIVE second factor, not whether the enrolment SECRET survives. Those two
  // coincided across reset-mfa's original pair -- unlock kept both, reset
  // destroyed both -- which is why the helper could derive one from the other.
  // disable-mfa is the case where they come apart.
  //
  // [ran it] auth.service.js:507 gates the entire MFA challenge on
  // `if (user.mfaEnabled)`, and disable-mfa sets mfaEnabled:false. So the
  // account is left SINGLE-FACTOR, exactly as reset-mfa's destructive branch
  // leaves it -- the preserved secret is inert until someone re-enables the
  // flag. Grading it 'info' put "an admin turned off a peer admin's second
  // factor" in the same severity bucket as clearing two counters, in a field
  // LogsPage.tsx offers to operators as a filter.
  it('grades disable-mfa critical: it leaves the account single-factor, as reset does', async () => {
    givenTarget('admin-target-2', 'role-administrator', {
      roleName: 'Administrador', mfaEnabled: true, mfaSecret: 'S', mfaLocked: true, mfaFailedAttempts: 5,
    });

    const response = await request(app)
      .post('/api/users/admin-target-2/disable-mfa')
      .set('Authorization', `Bearer ${adminCallerToken()}`);

    expect(response.status).toBe(200);
    const rows = auditRowsFor('admin-target-2');
    expect(rows).toHaveLength(1);
    // Control: unchanged by this fix, so it must be green BEFORE it too.
    expect(rows[0].payload.operation).toBe('disable');
    // The fix itself:
    expect(rows[0].severity).toBe('critical');
    expect(rows[0].payload).toMatchObject({ secondFactorActive: false, enrolmentPreserved: true });
  });

  // #1042: the two pins above catch a DELETED flag at an existing call site.
  // They cannot catch a NEW call site that never passes it -- that is a
  // different failure class and it is what this guard is for. The guard runs
  // before auditLogger is even required, so no db/req fixture is needed.
  describe('#1042: writeMfaResetAudit refuses a non-boolean secondFactorActive', () => {
    const { writeMfaResetAudit } = require('../../src/interface/routes/user.routes');

    const basePayload = {
      operation: 'unlock',
      enrolmentPreserved: true,
      fieldsCleared: ['mfaFailedAttempts', 'mfaLocked'],
      sessionsRevoked: false,
      message: 'irrelevante para o guard'
    };

    it('throws when the flag is OMITTED, rather than grading the row critical', async () => {
      await expect(
        writeMfaResetAudit({}, {}, { _id: 'guard-target' }, { ...basePayload })
      ).rejects.toThrow(/secondFactorActive/);
    });

    it('throws when the flag is present but not a boolean', async () => {
      await expect(
        writeMfaResetAudit({}, {}, { _id: 'guard-target' }, { ...basePayload, secondFactorActive: 'true' })
      ).rejects.toThrow(/secondFactorActive/);
    });

    it('CONTROL: passes the guard for both boolean values, so the guard is about the TYPE and not the value', async () => {
      // Reaching past the guard means auditLogger.log is attempted with these
      // empty fixtures, which is expected to fail for its OWN reasons. What is
      // being asserted is only that the failure is no longer the guard's.
      for (const secondFactorActive of [true, false]) {
        let thrown = null;
        try {
          await writeMfaResetAudit({}, {}, { _id: 'guard-target' }, { ...basePayload, secondFactorActive });
        } catch (error) {
          thrown = error;
        }
        expect(thrown?.message ?? '').not.toMatch(/secondFactorActive/);
      }
    });
  });
});
