import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
const require2 = createRequire(import.meta.url);
const { buildRbacCollections } = require2('../factories/rbac.factory');
const { createCollectionMock } = require2('../factories/db.factory');

function matchesAssignmentQuery(doc, query = {}) {
  return Object.entries(query).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in cond) return cond.$in.includes(doc[key]);
    return doc[key] === cond;
  });
}

// #615: a mutable userRoleAssignments mock seeded with explicit
// scopeType/scopeId docs — buildRbacCollections' synthesized assignments
// don't set scopeType at all, so it can't exercise updateAssignmentScope's
// `doc.scopeType !== 'organization'` branch.
function queryableAssignmentsMock(docs) {
  return createCollectionMock({
    findOne: vi.fn(async (query = {}) => docs.find((d) => matchesAssignmentQuery(d, query)) || null),
    find: vi.fn((query = {}) => ({ toArray: vi.fn().mockResolvedValue(docs.filter((d) => matchesAssignmentQuery(d, query))) })),
    insertOne: vi.fn(async (doc) => { docs.push(doc); return { insertedId: doc.assignmentId }; }),
    updateOne: vi.fn(async (filter, update) => {
      const doc = docs.find((d) => matchesAssignmentQuery(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    }),
  });
}

const authServiceMock = vi.hoisted(() => ({
  registerUser: vi.fn(async (_db, body) => ({
    _id: 'user-registered',
    ...body,
  })),
  getRoleName: vi.fn((accessType) => {
    const map = {
      1: 'Usuário Externo',
      2: 'Técnico',
      3: 'Coordenador',
      4: 'Administrador',
    };
    return map[accessType] || 'Técnico';
  }),
  getAccessTypeForRole: vi.fn((roleName) => {
    const map = {
      'Usuário Externo': 1,
      'Técnico': 2,
      'Coordenador': 3,
      'Administrador': 4,
    };
    return map[roleName] || 2;
  }),
}));

const auditLoggerMock = vi.hoisted(() => ({
  init: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  logPermissionChange: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/auth.service', () => authServiceMock);
vi.mock('../../../src/utils/auditLogger', () => auditLoggerMock);

const userRoutesModule = await import('../../../src/interface/routes/user.routes');
const accessRoutesModule = await import('../../../src/interface/routes/access.routes');

const userRoutes = userRoutesModule.default || userRoutesModule;
const accessRoutes = accessRoutesModule.default || accessRoutesModule;

function getHandler(router, method, path) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods?.[method]);
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };

  return response;
}

function createRequest({ body = {}, params = {}, query = {}, user = { userID: '507f1f77bcf86cd799439011', accessType: 4, roleName: 'Administrador' } } = {}) {
  return {
    body,
    params,
    query,
    user,
    t: (key) => key,
    app: {
      locals: {
        db: null,
      },
    },
  };
}

describe('Users and Access routes', () => {
  let usersCollection;
  let accessCollection;
  let logsCollection;
  let organizationsCollection;
  let sessionsCollection;
  let db;

  beforeEach(() => {
    usersCollection = {
      find: vi.fn(),
      findOne: vi.fn(),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'user-registered' }),
      updateOne: vi.fn(),
      deleteOne: vi.fn(),
    };

    accessCollection = {
      find: vi.fn(),
      findOne: vi.fn(),
      insertOne: vi.fn(),
      updateOne: vi.fn(),
      deleteOne: vi.fn(),
    };

    logsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-1' }),
    };

    // #617: organizationId is now validated against a real Organization at
    // write time — default resolves any lookup as found so pre-existing
    // tests passing a fabricated organizationId (e.g. 'org-old'/'org-new')
    // keep working; only the dedicated #617 tests override this to null.
    organizationsCollection = {
      find: vi.fn(),
      findOne: vi.fn().mockResolvedValue({ organizationId: 'default-org' }),
      insertOne: vi.fn(),
      updateOne: vi.fn(),
      deleteOne: vi.fn(),
    };

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: '507f1f77bcf86cd799439012', accessType: 2 },
    ]);

    // #963: named and memoized, deliberately. The fallback below returns a
    // FRESH object per db.collection() call and has no updateMany, so a
    // session revoke would (a) throw a TypeError that
    // invalidateUserSessions' inner catch swallows into a logger.warn, and
    // (b) leave nothing for a test to assert against even once updateMany
    // existed. Both halves have to be fixed for a revoke to be provable here.
    sessionsCollection = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      findOne: vi.fn(),
      insertOne: vi.fn(),
      updateOne: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      deleteOne: vi.fn(),
    };

    db = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'access') return accessCollection;
        if (name === 'logs') return logsCollection;
        if (name === 'organizations') return organizationsCollection;
        if (name === 'sessions') return sessionsCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          findOne: vi.fn(),
          insertOne: vi.fn(),
          updateOne: vi.fn(),
          deleteOne: vi.fn(),
        };
      }),
    };

    vi.clearAllMocks();
  });

  it('GET /api/users deve retornar lista sanitizada', async () => {
    const handler = getHandler(userRoutes, 'get', '/');
    usersCollection.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: 'user-1',
          name: 'Administrador',
          email: 'admin@bioavanced.com.br',
          username: 'admin',
          password: 'secret',
          accessType: 4,
          status: 'active',
        },
      ]),
    });

    const req = createRequest();
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data).toHaveLength(1);
    expect(res.payload.data[0].password).toBeUndefined();
    expect(res.payload.data[0].id).toBe('user-1');
  });

  it('POST /api/users/register deve normalizar status, telefone e organizationId', async () => {
    const handler = getHandler(userRoutes, 'post', '/register');
    const req = createRequest({
      body: {
        name: 'Novo Usuário',
        email: 'new@example.com',
        username: 'newuser',
        password: 'Senha@123',
        accessType: 2,
        status: 'Ativo',
        phone: '(11) 99876-5432',
        organizationId: '   ',
      },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.payload.success).toBe(true);
    expect(req.body.status).toBe('active');
    expect(req.body.phone).toBe('11998765432');
    expect(req.body.organizationId).toBeNull();
  });

  it('#617: POST /api/users/register rejeita organizationId que não resolve a uma Organization real', async () => {
    const handler = getHandler(userRoutes, 'post', '/register');
    organizationsCollection.findOne.mockResolvedValueOnce(null);
    const req = createRequest({
      body: {
        name: 'Novo Usuário',
        email: 'new@example.com',
        username: 'newuser',
        password: 'Senha@123',
        accessType: 2,
        organizationId: 'org-inexistente',
      },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
    expect(String(res.payload.message || '')).toContain('org-inexistente');
    expect(organizationsCollection.findOne).toHaveBeenCalledWith({ organizationId: 'org-inexistente' });
  });

  it('POST /api/users/register deve negar usuário sem permissão', async () => {
    const handler = getHandler(userRoutes, 'post', '/register');
    const req = createRequest({
      user: { userID: '507f1f77bcf86cd799439012', accessType: 2, roleName: 'Técnico' },
      body: {
        name: 'Novo Usuário',
        email: 'new@example.com',
        username: 'newuser',
        password: 'Senha@123',
        accessType: 2,
      },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.payload.success).toBe(true);
  });

  it('POST /api/users/:id/reset-mfa deve resetar MFA de usuário não-admin', async () => {
    // #426: o admin-gate agora resolve via UserRoleAssignment (o requester
    // '...011' já tem role administrator ativa no rbacCollections do
    // beforeEach) -- não é mais lido de volta de um findOne('users').
    const handler = getHandler(userRoutes, 'post', '/:id/reset-mfa');
    usersCollection.findOne
      .mockResolvedValueOnce({
        _id: 'user-target-1',
        accessType: 2,
        roleName: 'Técnico',
        mfaEnabled: true,
      });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = createRequest({ params: { id: 'user-target-1' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalled();
  });

  // #933: these three guards had NO test. That is the finding, independent of
  // whether direction 2 (letting reset-mfa clear mfaLocked on an admin target)
  // is ever built: the refusals could have regressed at any point undetected,
  // and a change to them should have to be deliberate. Pinning CURRENT
  // behaviour here is deliberately NOT an endorsement of it -- #933 argues the
  // admin-target refusal is too broad, since it blocks the unlock and the
  // secret-reset together and only the second is sensitive.
  it('#933: reset-mfa REFUSES an administrator target, writing nothing', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/reset-mfa');
    usersCollection.findOne.mockResolvedValueOnce({
      _id: '507f1f77bcf86cd799439011',
      accessType: 4, roleName: 'Administrador', mfaEnabled: true,
    });

    const req = createRequest({ params: { id: '507f1f77bcf86cd799439011' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    // The refusal returns BEFORE the $set, so the whole mutation is blocked --
    // mfaLocked and mfaFailedAttempts included, which is #933 direction 2's
    // entire point.
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  it('#933: disable-mfa REFUSES a non-administrator caller', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/disable-mfa');

    const req = createRequest({
      params: { id: '507f1f77bcf86cd799439011' },
      user: { userID: '507f1f77bcf86cd799439012', accessType: 2, roleName: 'Técnico' },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    // This is the half that makes the all-admins-locked estate unrecoverable
    // in-app: the endpoint needs an admin who is already logged in, and the
    // mfaLocked gate is what prevents that.
    expect(res.statusCode).toBe(403);
  });

  it('#933: disable-mfa REFUSES a non-administrator target -- it is admin-to-admin only', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/disable-mfa');
    usersCollection.findOne.mockResolvedValueOnce({
      _id: '507f1f77bcf86cd799439012',
      accessType: 2, roleName: 'Técnico', mfaEnabled: true,
    });

    const req = createRequest({ params: { id: '507f1f77bcf86cd799439012' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    // The half #933's body omits: both directions are gated, so disable-mfa is
    // exactly the endpoint an all-admins-locked estate needs and exactly the
    // one it cannot reach.
    expect(res.statusCode).toBe(403);
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  // #963 (RF003 AC#5, "Revogar sessões"): an admin resets MFA precisely
  // because they believe the second factor is compromised. Nothing on the
  // request path re-reads mfaEnabled -- the JWT still carries
  // mfaVerified:true and middleware/auth.js's only live-DB re-check reads
  // roleValidUntil and nothing else -- so without this the session the reset
  // was meant to kill survives, renewable indefinitely.
  it('POST /api/users/:id/reset-mfa revoga as sessões do alvo (#963)', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/reset-mfa');
    usersCollection.findOne.mockResolvedValueOnce({
      _id: 'user-target-1',
      accessType: 2,
      roleName: 'Técnico',
      mfaEnabled: true,
    });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = createRequest({ params: { id: 'user-target-1' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // Assert the FILTER's id value, not merely that updateMany ran. The
    // sessions collection keys its owner as a string (`Session.js` coerces
    // with String(data.userID), fed from auth.service.js's
    // user._id.toString()), so revoking with a non-string id matches
    // nothing, throws nothing and still returns 200 -- a silent no-op.
    expect(sessionsCollection.updateMany).toHaveBeenCalledWith(
      { userID: 'user-target-1', isActive: true },
      expect.objectContaining({
        $set: expect.objectContaining({ isActive: false, isRevoked: true }),
      })
    );
  });

  // RF014 AC#4 (#648): admin-initiated -- flags the target user's account so
  // their next login requires setting a new password (auth.service.js's
  // processLogin gate). Same handler shape as reset-mfa above.
  it('POST /api/users/:id/force-password-reset deve marcar forceReset no usuário alvo', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/force-password-reset');
    usersCollection.findOne
      .mockResolvedValueOnce({
        _id: 'user-target-1',
        accessType: 2,
        roleName: 'Técnico',
        forceReset: false,
      });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = createRequest({ params: { id: 'user-target-1' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ forceReset: true }) })
    );
  });

  it('POST /api/users/:id/force-password-reset retorna 404 quando o usuário alvo não existe', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/force-password-reset');
    usersCollection.findOne.mockResolvedValueOnce(null);

    const req = createRequest({ params: { id: 'no-such-user' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  it('POST /api/users/:id/disable-mfa deve desativar MFA de admin', async () => {
    // #426: both the requester ('...011') and the target ('user-target-2')
    // need an active administrator UserRoleAssignment for this scenario --
    // the shared beforeEach rbacCollections only grants '...011', so this
    // test builds its own db with both.
    const handler = getHandler(userRoutes, 'post', '/:id/disable-mfa');
    usersCollection.findOne
      .mockResolvedValueOnce({
        _id: 'user-target-2',
        accessType: 4,
        roleName: 'Administrador',
        mfaEnabled: true,
      });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-2', accessType: 4 },
    ]);
    const dbWithTargetAdmin = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({ params: { id: 'user-target-2' } });
    req.app.locals.db = dbWithTargetAdmin;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalled();
  });

  // #427: PUT /:id stops dual-writing accessType/roleName onto the User
  // document — only used to resolve the UserRoleAssignment change (#421),
  // and the response's roleName is resolved from that assignment.
  it('PUT /api/users/:id nao persiste accessType/roleName e resolve roleName da RBAC assignment na resposta', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-3',
      name: 'Alvo',
      email: 'alvo@bioavanced.com.br',
      username: 'alvo',
      status: 'active',
      accessType: 2,
      roleName: 'Técnico',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser) // busca inicial (targetUser)
      .mockResolvedValueOnce({ ...targetUser, accessType: 4 }); // apos update
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-3', accessType: 4 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-3' },
      body: { accessType: 4, roleName: 'Administrador' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload).not.toHaveProperty('accessType');
    expect(setPayload).not.toHaveProperty('roleName');
    expect(res.payload.data.roleName).toBe('Administrador');
  });

  it('#617: PUT /api/users/:id rejeita organizationId que não resolve a uma Organization real', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-3b',
      name: 'Alvo Org Inválida',
      email: 'alvo-org-invalida@bioavanced.com.br',
      username: 'alvoorginvalida',
      status: 'active',
      accessType: 2,
    };
    usersCollection.findOne.mockResolvedValueOnce(targetUser);

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-3b', accessType: 2 },
    ]);
    const invalidOrgCollection = {
      findOne: vi.fn().mockResolvedValue(null),
    };
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'organizations') return invalidOrgCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-3b' },
      body: { organizationId: 'org-inexistente' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
    expect(String(res.payload.message || '')).toContain('org-inexistente');
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  // #429: PUT /:id's `auditorRole` flag grants/revokes the additive
  // `auditor` RBAC role via grantAdditionalRole/revokeAdditionalRole,
  // stacking alongside (not replacing) the user's accessType-derived role,
  // and is never persisted onto the User document.
  it('PUT /api/users/:id com auditorRole=true concede a role auditor sem persistir o campo no documento', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-4',
      name: 'Alvo Auditor',
      email: 'alvo-auditor@bioavanced.com.br',
      username: 'alvoauditor',
      status: 'active',
      accessType: 2,
      roleName: 'Técnico',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-4', accessType: 2 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-4' },
      body: { auditorRole: true },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload).not.toHaveProperty('auditorRole');
    expect(rbacCollections.userRoleAssignments.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ userAccountId: 'user-target-4', roleId: 'role-auditor', assignmentStatus: 'active' })
    );
  });

  // #615: accessType and organizationId change together -> changeUserRole's
  // revoke+re-grant must scope the new assignment to the new organizationId.
  it('PUT /api/users/:id com accessType e organizationId alterados escopa a nova assignment ao novo organizationId', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-5',
      name: 'Alvo Escopo',
      email: 'alvo-escopo@bioavanced.com.br',
      username: 'alvoescopo',
      status: 'active',
      accessType: 2,
      organizationId: 'org-old',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ ...targetUser, accessType: 3, organizationId: 'org-new' });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([]);
    const assignmentDocs = [
      { assignmentId: 'assign-5', userAccountId: 'user-target-5', roleId: 'role-technician', scopeType: 'organization', scopeId: 'org-old', assignmentStatus: 'active', validUntil: null },
    ];
    const assignmentsMock = queryableAssignmentsMock(assignmentDocs);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'roles') return rbacCollections.roles;
        if (name === 'permissions') return rbacCollections.permissions;
        if (name === 'userRoleAssignments') return assignmentsMock;
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-5' },
      body: { accessType: 3, organizationId: 'org-new' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const newAssignment = assignmentDocs.find((a) => a.assignmentStatus === 'active' && a.roleId === 'role-coordinator');
    expect(newAssignment).toBeTruthy();
    expect(newAssignment.scopeType).toBe('organization');
    expect(newAssignment.scopeId).toBe('org-new');
    expect(assignmentDocs.find((a) => a.assignmentId === 'assign-5').assignmentStatus).toBe('revoked');
  });

  // #615: organizationId changes but accessType doesn't -> updateAssignmentScope
  // resyncs the existing assignment's scopeId in place, no revoke/re-grant.
  it('PUT /api/users/:id com apenas organizationId alterado atualiza o scopeId da assignment existente sem revogar', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-6',
      name: 'Alvo Org',
      email: 'alvo-org@bioavanced.com.br',
      username: 'alvoorg',
      status: 'active',
      accessType: 2,
      organizationId: 'org-old',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ ...targetUser, organizationId: 'org-new' });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([]);
    const assignmentDocs = [
      { assignmentId: 'assign-6', userAccountId: 'user-target-6', roleId: 'role-technician', scopeType: 'organization', scopeId: 'org-old', assignmentStatus: 'active', validUntil: null },
    ];
    const assignmentsMock = queryableAssignmentsMock(assignmentDocs);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'roles') return rbacCollections.roles;
        if (name === 'permissions') return rbacCollections.permissions;
        if (name === 'userRoleAssignments') return assignmentsMock;
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-6' },
      body: { organizationId: 'org-new' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(assignmentDocs).toHaveLength(1); // no revoke/re-grant -- same assignment, updated in place
    const assignment = assignmentDocs[0];
    expect(assignment.assignmentId).toBe('assign-6');
    expect(assignment.assignmentStatus).toBe('active');
    expect(assignment.scopeId).toBe('org-new');
  });

  // #615: organizationId cleared to empty (route normalizes '' -> null) ->
  // scopeId goes null, the state #340/#341's resolver reads as 'unassigned'.
  it('PUT /api/users/:id com organizationId limpo zera o scopeId da assignment existente', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-7',
      name: 'Alvo Limpo',
      email: 'alvo-limpo@bioavanced.com.br',
      username: 'alvolimpo',
      status: 'active',
      accessType: 2,
      organizationId: 'org-old',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ ...targetUser, organizationId: null });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([]);
    const assignmentDocs = [
      { assignmentId: 'assign-7', userAccountId: 'user-target-7', roleId: 'role-technician', scopeType: 'organization', scopeId: 'org-old', assignmentStatus: 'active', validUntil: null },
    ];
    const assignmentsMock = queryableAssignmentsMock(assignmentDocs);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'roles') return rbacCollections.roles;
        if (name === 'permissions') return rbacCollections.permissions;
        if (name === 'userRoleAssignments') return assignmentsMock;
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-7' },
      body: { organizationId: '' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(assignmentDocs[0].scopeId).toBeNull();
  });

  // #875: PUT /:id used to $set req.body directly, so any key on the
  // request body reached the driver untouched. This regression pins the
  // allowlist that closes the route's last mechanical #875 site -- an
  // injected key, a business-key spoof (userID) and an attempt to clear
  // the MFA lockout counter (mfaLocked) must all be dropped from $set,
  // while a legitimate field (name) still goes through.
  it('PUT /api/users/:id descarta chaves nao permitidas (injected/userID/mfaLocked) do $set', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-8',
      name: 'Alvo Original',
      email: 'alvo-injecao@bioavanced.com.br',
      username: 'alvoinjecao',
      status: 'active',
      accessType: 2,
      roleName: 'Técnico',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ ...targetUser, name: 'Alvo Renomeado' });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-8', accessType: 2 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-8' },
      body: { name: 'Alvo Renomeado', injected: 'x', mfaLocked: false, userID: 999, failedLoginAttempts: 0, accountLockedUntil: null },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.name).toBe('Alvo Renomeado');
    expect(setPayload).not.toHaveProperty('injected');
    expect(setPayload).not.toHaveProperty('mfaLocked');
    expect(setPayload).not.toHaveProperty('userID');
    // #952: failedLoginAttempts became load-bearing (RF001 AC#2), so it was
    // removed from ALLOWED_USER_UPDATE_FIELDS -- leaving it there would let any
    // createUser holder clear a target's brute-force counter, and its expiry,
    // through a generic update. Same hazard the mfaLocked exclusion above exists
    // for; that one had a test and this one did not.
    expect(setPayload).not.toHaveProperty('failedLoginAttempts');
    expect(setPayload).not.toHaveProperty('accountLockedUntil');
    expect(Object.keys(setPayload).sort()).toEqual(['name', 'updatedAt']);
  });

  // #982 (RF003 AC#5, "Revogar sessões"): PUT /api/users/:id hashes and $sets
  // an inbound password, and until now revoked nothing. #958 fixed the four
  // paths where the account OWNER changes their own password; this fifth one
  // is an admin write and was outside its frame -- so an admin could replace a
  // user's password while every session that user already held stayed live,
  // authenticated with a password that no longer exists.
  it('#982: PUT /api/users/:id com senha nova revoga as sessões do alvo', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-9',
      name: 'Alvo Senha',
      email: 'alvo-senha@bioavanced.com.br',
      username: 'alvosenha',
      status: 'active',
      accessType: 2,
      roleName: 'Técnico',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-9', accessType: 2 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-9' },
      body: { password: 'NovaSenh@2026' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // The password really was written -- otherwise a revoke assertion could
    // pass on a request that changed nothing.
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.password).toEqual(expect.any(String));
    expect(setPayload.password).not.toBe('NovaSenh@2026');
    // Same filter-value discipline as the reset-mfa revoke above: sessions key
    // their owner as a string, so revoking with a non-string id matches
    // nothing, throws nothing and still returns 200.
    expect(sessionsCollection.updateMany).toHaveBeenCalledWith(
      { userID: 'user-target-9', isActive: true },
      expect.objectContaining({
        $set: expect.objectContaining({
          isActive: false,
          isRevoked: true,
          revocationReason: 'admin_action',
          revokedBy: '507f1f77bcf86cd799439011',
        }),
      })
    );
  });

  // #982: the mirror -- an update that carries no password must NOT revoke.
  // Without this, "revoke on every PUT" would pass the test above while
  // logging users out of every unrelated profile edit.
  it('#982: PUT /api/users/:id sem senha não revoga sessão alguma', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-10',
      name: 'Alvo Sem Senha',
      email: 'alvo-sem-senha@bioavanced.com.br',
      username: 'alvosemsenha',
      status: 'active',
      accessType: 2,
      roleName: 'Técnico',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ ...targetUser, name: 'Renomeado' });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-10', accessType: 2 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-10' },
      body: { name: 'Renomeado' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(sessionsCollection.updateMany).not.toHaveBeenCalled();
  });

  it('GET /api/access deve listar acessos', async () => {
    const handler = getHandler(accessRoutes, 'get', '/');
    accessCollection.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: 'access-1',
          reportID: 1,
          reportType: 'Relatório',
          accessType: 1,
        },
      ]),
    });

    const req = createRequest();
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data).toHaveLength(1);
  });

  it('POST /api/access deve criar acesso válido', async () => {
    const handler = getHandler(accessRoutes, 'post', '/');
    accessCollection.insertOne.mockResolvedValue({ insertedId: 'access-2' });

    const req = createRequest({
      body: {
        reportID: 2,
        reportType: 'Relatório Clínico',
        accessType: 3,
      },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.payload.success).toBe(true);
    expect(accessCollection.insertOne).toHaveBeenCalled();
  });
});
