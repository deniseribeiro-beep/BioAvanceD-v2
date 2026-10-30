import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const authService = require('../../src/services/auth.service');
const sensorService = require('../../src/services/sensor.service');
const sampleService = require('../../src/services/sample.service');
const consentValidator = require('../../src/services/consent.validator');
const auditLogger = require('../../src/utils/auditLogger');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1384: user.routes.js joins the organization-scope sweep. A Coordenador
// (createUser) manages the users of its own organizations; a user's
// organizations are its active assignment scope ids. The Administrador
// (global) manages every user. See
// docs/decisions/2026-10-17-org-scoped-user-management.md.
//
// #1229: the seed no longer gives the Coordenador any user-account code
// (RF003 names the Administrador only), so the organization-scoped caller
// here is a Coordenador that an extra role grants them to. The tenancy
// rule is the route's, whoever holds the codes; a plain seeded Coordenador
// is refused at the gate (the last case).

const COORD = 'qa-coord-a';
const ADMIN = 'qa-admin-1';
const ORPHAN_COORD = 'qa-coord-none';

function token({ userID, accessType, roleName }) {
  return jwt.sign(
    { userID, accessType, roleName, name: `QA ${roleName}`, mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}
const coordToken = () => token({ userID: COORD, accessType: 3, roleName: 'Coordenador' });
const adminToken = () => token({ userID: ADMIN, accessType: 4, roleName: 'Administrador' });

const USER_CODES = ['createUser', 'readUser', 'updateUser', 'deleteUser'];
const USER_MANAGER_ROLE = { roleCode: 'user_manager', hierarchyLevel: null, permissions: USER_CODES };
const PLAIN_COORD = 'qa-coord-plain';

// An org-a caller holding every user-management permission the Coordenador
// lacks, so each target check is reached past its requirePermission.
const OPERATOR = 'qa-operator-a';
const operatorToken = () => token({ userID: OPERATOR, accessType: 2, roleName: 'Técnico' });
const OPERATOR_ROLE = {
  roleCode: 'user_operator',
  hierarchyLevel: null,
  permissions: [...USER_CODES, 'assignRole', 'revokeSessions', 'forcePasswordReset', 'setUserPassword', 'disableMFA'],
};

const DEFAULT_RBAC_USERS = [
  { userAccountId: ADMIN, accessType: 4 },
  { userAccountId: COORD, accessType: 3, organizationId: 'org-a' },
  { userAccountId: COORD, roleCodes: ['user_manager'], organizationId: 'org-a' },
  { userAccountId: PLAIN_COORD, accessType: 3, organizationId: 'org-a' },
  { userAccountId: 'user-in-org-a', accessType: 2, organizationId: 'org-a' },
  { userAccountId: 'user-in-org-b', accessType: 2, organizationId: 'org-b' },
  { userAccountId: ORPHAN_COORD, accessType: 3 },
  { userAccountId: ORPHAN_COORD, roleCodes: ['user_manager'] },
];

function matchesUser(doc, query = {}) {
  if (Array.isArray(query.$or)) return query.$or.some((clause) => matchesUser(doc, clause));
  return Object.entries(query).every(([key, value]) => String(doc[key]) === String(value));
}

describe('#1384: user management is limited to the caller\'s organizations', () => {
  let userDocs;
  let usersCollection;
  let reportsCollection;
  let rbac;

  async function givenUsers({ rbacUsers, extraRoles = [], extraUsers = [] } = {}) {
    userDocs = [
      { _id: COORD, name: 'Coord A', organizationId: 'org-a' },
      { _id: 'user-in-org-a', name: 'Tec A', organizationId: 'org-a' },
      { _id: 'user-in-org-b', name: 'Tec B', organizationId: 'org-b' },
      { _id: ADMIN, name: 'Admin', organizationId: null },
      ...extraUsers,
    ].map((doc) => ({ ...doc, email: `${doc._id}@example.com`, username: `qa.${doc._id}`, accountStatus: 'active' }));
    usersCollection = createCollectionMock({
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(userDocs.map((doc) => ({ ...doc }))) })),
      findOne: vi.fn(async (query) => {
        const doc = userDocs.find((d) => matchesUser(d, query));
        return doc ? { ...doc } : null;
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    });
    reportsCollection = createCollectionMock({
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'report-1' }),
    });
    rbac = buildRbacCollections(rbacUsers || DEFAULT_RBAC_USERS, [USER_MANAGER_ROLE, ...extraRoles]);
    // The factory defaults every organization assignment's scopeId; an
    // org-less Coordenador holds the role with no organization ('unassigned').
    for (const doc of await rbac.userRoleAssignments.find({ userAccountId: ORPHAN_COORD }).toArray()) {
      doc.scopeId = null;
    }
    app.locals.db = createDbMock({
      users: usersCollection,
      reports: reportsCollection,
      organizations: createCollectionMock({
        findOne: vi.fn(async (query) => (['org-a', 'org-b'].includes(query.organizationId) ? query : null)),
      }),
      ...rbac,
    });
  }

  beforeEach(async () => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
    vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue(0);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logUpdate').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logDelete').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logPermissionChange').mockResolvedValue(undefined);
    await givenUsers();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('a Coordenador lists only the users of its own organization', async () => {
    const response = await request(app).get('/api/users').set('Authorization', `Bearer ${coordToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((user) => user.id).sort()).toEqual([COORD, 'user-in-org-a'].sort());
  });

  it('a Coordenador gets 403 reading a user of another organization', async () => {
    const response = await request(app).get('/api/users/user-in-org-b').set('Authorization', `Bearer ${coordToken()}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Este usuário pertence a outra organização');
  });

  it('a Coordenador gets 403 renaming a user of another organization, and nothing is written', async () => {
    const response = await request(app)
      .put('/api/users/user-in-org-b')
      .set('Authorization', `Bearer ${coordToken()}`)
      .send({ name: 'Renamed' });

    expect(response.status).toBe(403);
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  it('a Coordenador gets 403 deactivating a user of another organization, and nothing is written', async () => {
    const response = await request(app).delete('/api/users/user-in-org-b').set('Authorization', `Bearer ${coordToken()}`);

    expect(response.status).toBe(403);
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
    expect(sessionService.invalidateUserSessions).not.toHaveBeenCalled();
  });

  it('a Coordenador reads, renames and deactivates a user of its own organization', async () => {
    const read = await request(app).get('/api/users/user-in-org-a').set('Authorization', `Bearer ${coordToken()}`);
    expect(read.status).toBe(200);

    const renamed = await request(app)
      .put('/api/users/user-in-org-a')
      .set('Authorization', `Bearer ${coordToken()}`)
      .send({ name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalledTimes(1);

    const deleted = await request(app).delete('/api/users/user-in-org-a').set('Authorization', `Bearer ${coordToken()}`);
    expect(deleted.status).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalledTimes(2);
  });

  it('a Coordenador gets 403 moving a user of its own organization to another, and nothing is written', async () => {
    const response = await request(app)
      .put('/api/users/user-in-org-a')
      .set('Authorization', `Bearer ${coordToken()}`)
      .send({ organizationId: 'org-b' });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Não é permitido mover o usuário para outra organização');
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  it('a Coordenador gets 403 moving a user it shares into its own organization, and the other organization is kept', async () => {
    // Home org-b, also granted org-a by an Administrador: in the
    // Coordenador's reach, but its org-b assignment is not the Coordenador's.
    await givenUsers({
      rbacUsers: [
        ...DEFAULT_RBAC_USERS,
        { userAccountId: 'user-shared', accessType: 2, organizationId: 'org-b' },
        { userAccountId: 'user-shared', accessType: 2, organizationId: 'org-a' },
      ],
      extraUsers: [{ _id: 'user-shared', name: 'Tec Shared', organizationId: 'org-b' }],
    });

    const response = await request(app)
      .put('/api/users/user-shared')
      .set('Authorization', `Bearer ${coordToken()}`)
      .send({ organizationId: 'org-a' });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Não é permitido mover o usuário para outra organização');
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
    expect(rbac.userRoleAssignments.updateOne).not.toHaveBeenCalled();
  });

  describe('every target route refuses a user of another organization, with no write', () => {
    beforeEach(async () => {
      await givenUsers({
        rbacUsers: [...DEFAULT_RBAC_USERS, { userAccountId: OPERATOR, roleCodes: ['user_operator'], organizationId: 'org-a' }],
        extraRoles: [OPERATOR_ROLE],
      });
    });

    function expectNoWrite() {
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
      expect(rbac.userRoleAssignments.insertOne).not.toHaveBeenCalled();
      expect(rbac.userRoleAssignments.updateOne).not.toHaveBeenCalled();
      expect(sessionService.invalidateUserSessions).not.toHaveBeenCalled();
    }

    // The /organizations bodies name org-a, the caller's own, so only the
    // target check stands between the call and the grant or revoke.
    it.each([
      ['GET', '/api/users/user-in-org-b/validate-status', undefined],
      ['POST', '/api/users/user-in-org-b/revoke-sessions', {}],
      ['POST', '/api/users/user-in-org-b/force-password-reset', {}],
      ['POST', '/api/users/user-in-org-b/set-password', { password: 'Outra@Senha-forte-1384' }],
      ['GET', '/api/users/user-in-org-b/organizations', undefined],
      ['POST', '/api/users/user-in-org-b/organizations', { organizationId: 'org-a' }],
      ['DELETE', '/api/users/user-in-org-b/organizations/org-a', undefined],
    ])('%s %s answers 403', async (method, path, body) => {
      let call = request(app)[method.toLowerCase()](path).set('Authorization', `Bearer ${operatorToken()}`);
      if (body !== undefined) call = call.send(body);
      const response = await call;

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Este usuário pertence a outra organização');
      expectNoWrite();
    });

    // disable-mfa refuses every caller but an Administrador first (its
    // isAdministrator check), and an Administrador is global, so its target
    // check is defence in depth no non-global caller reaches.
    it('POST /:id/disable-mfa answers 403 to a non-global caller', async () => {
      const response = await request(app)
        .post('/api/users/user-in-org-b/disable-mfa')
        .set('Authorization', `Bearer ${operatorToken()}`);

      expect(response.status).toBe(403);
      expectNoWrite();
    });

    it('POST /:id/organizations refuses granting another organization to a user of its own', async () => {
      const response = await request(app)
        .post('/api/users/user-in-org-a/organizations')
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ organizationId: 'org-b' });

      expect(response.status).toBe(403);
      expectNoWrite();
    });

    it('DELETE /:id/organizations refuses revoking another organization from a user of its own', async () => {
      const response = await request(app)
        .delete('/api/users/user-in-org-a/organizations/org-b')
        .set('Authorization', `Bearer ${operatorToken()}`);

      expect(response.status).toBe(403);
      expectNoWrite();
    });

    it('POST /register naming another organization stamps the caller\'s own', async () => {
      const registerUser = vi.spyOn(authService, 'registerUser').mockResolvedValue({ _id: 'new-user', id: 'new-user' });

      const response = await request(app)
        .post('/api/users/register')
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ name: 'New', email: 'new@example.com', username: 'qa.new', password: 'Nova@Senha-forte-1384', organizationId: 'org-b' });

      expect(response.status).toBe(201);
      expect(registerUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: 'org-a' }), OPERATOR);
    });
  });

  it('an organization-scoped role granted resetMFA gets 403 on a user of another organization', async () => {
    await givenUsers({
      rbacUsers: [
        { userAccountId: 'qa-mfa-operator', roleCodes: ['mfa_operator'], organizationId: 'org-a' },
        { userAccountId: 'user-in-org-b', accessType: 2, organizationId: 'org-b' },
      ],
      extraRoles: [{ roleCode: 'mfa_operator', hierarchyLevel: null, permissions: ['resetMFA'] }],
    });

    const response = await request(app)
      .post('/api/users/user-in-org-b/reset-mfa')
      .set('Authorization', `Bearer ${token({ userID: 'qa-mfa-operator', accessType: 2, roleName: 'Técnico' })}`);

    expect(response.status).toBe(403);
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  it('POST /register-sensor by a Coordenador naming another organization stamps its own', async () => {
    const createSensor = vi.spyOn(sensorService, 'createSensor').mockResolvedValue({ _id: 'sensor-1' });

    const response = await request(app)
      .post('/api/users/register-sensor')
      .set('Authorization', `Bearer ${coordToken()}`)
      .send({ sensorId: 'S-1', organizationId: 'org-b' });

    expect(response.status).toBe(201);
    expect(createSensor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: 'org-a' }));
  });

  it('POST /generate-report stamps the Coordenador\'s organizations on the report', async () => {
    const response = await request(app)
      .post('/api/users/generate-report')
      .set('Authorization', `Bearer ${coordToken()}`)
      .send({ reportType: 'samples' });

    expect(response.status).toBe(201);
    expect(reportsCollection.insertOne).toHaveBeenCalledWith(expect.objectContaining({ organizationIds: ['org-a'] }));
  });

  it('POST /record-withdrawal of a sample of another organization answers 403 before any check or write', async () => {
    vi.spyOn(sampleService, 'getSample').mockResolvedValue({ _id: '507f1f77bcf86cd799439013', organizationId: 'org-b' });
    const validateAccess = vi.spyOn(consentValidator, 'validateAccess').mockResolvedValue(true);
    const withdrawSample = vi.spyOn(sampleService, 'withdrawSample').mockResolvedValue({});

    const response = await request(app)
      .post('/api/users/record-withdrawal')
      .set('Authorization', `Bearer ${coordToken()}`)
      .send({ sampleID: '507f1f77bcf86cd799439013' });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Esta amostra pertence a outra organização');
    expect(validateAccess).not.toHaveBeenCalled();
    expect(withdrawSample).not.toHaveBeenCalled();
  });

  it('control: the Administrador lists every user and reads one of another organization', async () => {
    const listed = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken()}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((user) => user.id).sort()).toEqual([ADMIN, COORD, 'user-in-org-a', 'user-in-org-b'].sort());

    const read = await request(app).get('/api/users/user-in-org-b').set('Authorization', `Bearer ${adminToken()}`);
    expect(read.status).toBe(200);
  });

  it('control: a Coordenador with no organization gets the gate\'s 403', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token({ userID: ORPHAN_COORD, accessType: 3, roleName: 'Coordenador' })}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Sem organização atribuída');
  });

  // #1229: the seeded Coordenador holds no user-account code, so each user
  // route refuses it at requirePermission, before any organization check.
  it.each([
    ['GET', '/api/users'],
    ['GET', '/api/users/user-in-org-a'],
    ['PUT', '/api/users/user-in-org-a'],
    ['DELETE', '/api/users/user-in-org-a'],
  ])('#1229: a seeded Coordenador with no user code gets 403 on %s %s, and nothing is written', async (method, path) => {
    let call = request(app)[method.toLowerCase()](path)
      .set('Authorization', `Bearer ${token({ userID: PLAIN_COORD, accessType: 3, roleName: 'Coordenador' })}`);
    if (method === 'PUT') call = call.send({ name: 'Renamed' });
    const response = await call;

    expect(response.status).toBe(403);
    expect(response.body.message).not.toBe('Este usuário pertence a outra organização');
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });
});
