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
      // #998: the CALLER's own assignment. This fixture never needed one --
      // nothing on this route resolved the caller's level until the #998 floor
      // landed, so an unassigned caller was indistinguishable from an
      // administrator. It now fails closed, which is correct for a privilege
      // gate and is why this line is a fixture completion rather than a
      // loosening: createRequest's default caller is the accessType-4
      // administrator, and this makes the mock say so.
      { assignmentId: 'assign-5-caller', userAccountId: '507f1f77bcf86cd799439011', roleId: 'role-administrator', scopeType: 'global', scopeId: null, assignmentStatus: 'active', validUntil: null },
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

  // #993: mfaSecret/mfaActivationDate sat on ALLOWED_USER_UPDATE_FIELDS, and
  // the admin branch above keeps whatever the caller sent when mfaEnabled is
  // explicitly true. So one PUT could set a target's password AND replace
  // their TOTP secret with one the caller generated -- a silent account
  // takeover, and the victim's next login fails against a secret they no
  // longer hold. The route only ever legitimately writes these two fields as
  // a server-set null (the disable-MFA clear); it must never carry a
  // caller-supplied value.
  it('#993: PUT /api/users/:id nunca aceita mfaSecret do chamador, mesmo com mfaEnabled=true em alvo admin', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-11',
      name: 'Alvo Admin',
      email: 'alvo-admin@bioavanced.com.br',
      username: 'alvoadmin',
      status: 'active',
      accessType: 4,
      roleName: 'Administrador',
      mfaEnabled: true,
      mfaSecret: 'SEGREDO-LEGITIMO-DO-ALVO',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-11', accessType: 4 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-11' },
      body: {
        mfaEnabled: true,
        mfaSecret: 'SEGREDO-DO-ATACANTE',
        mfaActivationDate: '2026-01-01T00:00:00.000Z',
      },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    // Assert the VALUE is absent, not merely that it differs -- writing the
    // attacker's string would be the takeover, and writing any other
    // caller-derived value would be the same defect wearing a new shape.
    expect(setPayload).not.toHaveProperty('mfaSecret');
    expect(setPayload).not.toHaveProperty('mfaActivationDate');
    expect(JSON.stringify(setPayload)).not.toContain('SEGREDO-DO-ATACANTE');
  });

  // #993: the clear must survive the fix above. Disabling MFA on an admin
  // target is the ONE legitimate write to these two fields on this route, and
  // it is server-set -- so a blanket removal from the allowlist would have
  // left a stale secret behind an mfaEnabled:false flag.
  it('#993: PUT /api/users/:id ainda zera mfaSecret/mfaActivationDate ao desabilitar MFA de um admin', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-12',
      name: 'Alvo Admin 2',
      email: 'alvo-admin2@bioavanced.com.br',
      username: 'alvoadmin2',
      status: 'active',
      accessType: 4,
      roleName: 'Administrador',
      mfaEnabled: true,
      mfaSecret: 'SEGREDO-A-SER-LIMPO',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-12', accessType: 4 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-12' },
      body: { mfaEnabled: false, mfaSecret: 'SEGREDO-DO-ATACANTE' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.mfaEnabled).toBe(false);
    expect(setPayload.mfaSecret).toBeNull();
    expect(setPayload.mfaActivationDate).toBeNull();
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

  // #998 (RF003, RNF008 AC#1): role assignment is Administrador-only.
  //
  // requirePermission('createUser') is the ONLY gate on the three routes that
  // can grant a role, and rbac-catalog-seed grants 'createUser' to the seeded
  // Coordenador as its first permission. Nothing in requirePermission, in the
  // handlers, or in rbac-assignment.service checked the CALLER's level against
  // the level being granted -- so every Coordenador in a default-seeded
  // deployment could make anyone, including themselves, an Administrador.
  //
  // RF003 (requisitos-index.md:37-50) names Administrador as the actor for
  // "gerenciar ... seus papéis" and AC#3 "Atribuir papel com vigência e escopo
  // institucional". RNF008 AC#1 is deny-by-default and AC#4 says the frontend
  // guard does not substitute for backend validation -- which is what
  // App.tsx's requiredRole was doing alone.
  //
  // The gate follows this repo's own precedent: the in-handler
  // isAdministrator(db, req.user.userID) check that POST /:id/disable-mfa
  // already uses, rather than a new permission code.
  describe('#998: only an Administrador may assign a role', () => {
    function callerCoordenador() {
      return { userID: '507f1f77bcf86cd799439013', accessType: 3, roleName: 'Coordenador' };
    }

    // Arrange block lifted from the #982 PUT test above rather than written
    // fresh: a thinner targetUser fails UserModel.validate and the route
    // answers 422 before it ever reaches the role logic, which reads as a
    // reproduction while measuring nothing.
    function seedTarget(id) {
      const targetUser = {
        _id: id,
        name: 'Alvo 998',
        email: 'alvo-998@bioavanced.com.br',
        username: 'alvo998',
        status: 'active',
        accessType: 2,
        roleName: 'Técnico',
      };
      usersCollection.findOne
        .mockResolvedValueOnce(targetUser)
        .mockResolvedValueOnce(targetUser);
      usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      return targetUser;
    }

    function dbWith(callers) {
      const rbacCollections = buildRbacCollections(callers);
      return {
        collection: vi.fn((name) => {
          if (name === 'users') return usersCollection;
          if (rbacCollections[name]) return rbacCollections[name];
          return db.collection(name);
        }),
      };
    }

    it('refuses a Coordenador promoting a target to Administrador through PUT /:id', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-998');

      const req = createRequest({
        params: { id: 'user-target-998' },
        body: { roleName: 'Administrador' },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439013', accessType: 3 },
        { userAccountId: 'user-target-998', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      // The role must not have been granted, not merely the response changed.
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
    });

    it('refuses a Coordenador creating an Administrador through POST /register', async () => {
      const handler = getHandler(userRoutes, 'post', '/register');

      const req = createRequest({
        body: { name: 'Novo', email: 'novo@b.c', username: 'novo', password: 'Str0ng!Pass', roleName: 'Administrador' },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([{ userAccountId: '507f1f77bcf86cd799439013', accessType: 3 }]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      expect(authServiceMock.registerUser).not.toHaveBeenCalled();
    });

    // The negative halves. Without these the pair above cannot distinguish a
    // working caller check from a gate that refuses every role assignment, or
    // from one that refuses every PUT.
    it('still allows an Administrador to promote a target to Administrador', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-998b');

      const req = createRequest({
        params: { id: 'user-target-998b' },
        body: { roleName: 'Administrador' },
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
        { userAccountId: 'user-target-998b', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
    });

    // What separates the floor that shipped from an Administrador-only gate.
    // RF003 points at Administrador-only, which is #998 direction 2 and a
    // larger change; the floor closes the escalation without deciding whether
    // Coordenador should hold createUser at all. If direction 2 later lands,
    // this test is the one that must flip.
    it('still allows a Coordenador to assign a level at or below their own', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-998d');

      const req = createRequest({
        params: { id: 'user-target-998d' },
        body: { roleName: 'Coordenador' },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439013', accessType: 3 },
        { userAccountId: 'user-target-998d', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
    });

    it('still allows a Coordenador to edit a user without touching their role', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-998c');

      const req = createRequest({
        params: { id: 'user-target-998c' },
        body: { name: 'Alvo Renomeado' },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439013', accessType: 3 },
        { userAccountId: 'user-target-998c', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(usersCollection.updateOne).toHaveBeenCalled();
    });
  });

  // #1009: the promotion guard compared `requestedAccessType` against
  // `targetUser.accessType` -- a field #427/#432 dropped from the User
  // document. It is `undefined` on every real user, so the comparison
  // degenerated to Boolean(requestedAccessType) and fired changeUserRole (a
  // revoke + re-grant pair, attributed to the editing admin) on every edit
  // that merely carried roleName back unchanged -- which NewUserPage does on
  // every save, since it seeds its form with {...editingUser}.
  //
  // The target fixture below deliberately OMITS `accessType`, unlike every
  // other block in this file. Supplying it is precisely what made the
  // existing tests unable to see this: the mock hands the route the field
  // whose absence IS the bug (same shape as #994's getMongo).
  describe('#1009: changeUserRole fires only on a real level change', () => {
    const CALLER_ID = '507f1f77bcf86cd799439011';

    function seedTargetWithoutAccessType(id) {
      // Lifted from #998's seedTarget so a thin document cannot fail
      // UserModel.validate and answer 422 before reaching the role logic --
      // minus the one field under test.
      const targetUser = {
        _id: id,
        name: 'Alvo 1009',
        email: 'alvo-1009@bioavanced.com.br',
        username: 'alvo1009',
        status: 'active',
        roleName: 'Técnico',
      };
      usersCollection.findOne
        .mockResolvedValueOnce(targetUser)
        .mockResolvedValueOnce(targetUser);
      usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      return targetUser;
    }

    function assignmentsFor(targetId) {
      return [
        { assignmentId: 'assign-caller-1009', userAccountId: CALLER_ID, roleId: 'role-administrator', assignmentStatus: 'active', validUntil: null },
        { assignmentId: 'assign-target-1009', userAccountId: targetId, roleId: 'role-technician', assignmentStatus: 'active', validUntil: null },
      ];
    }

    function dbWithAssignments(assignmentDocs) {
      const rbacCollections = buildRbacCollections([]);
      const assignmentsMock = queryableAssignmentsMock(assignmentDocs);
      return {
        collection: vi.fn((name) => {
          if (name === 'users') return usersCollection;
          if (name === 'roles') return rbacCollections.roles;
          if (name === 'permissions') return rbacCollections.permissions;
          if (name === 'userRoleAssignments') return assignmentsMock;
          return db.collection(name);
        }),
      };
    }

    it('#1009: an edit that carries the SAME roleName back does not revoke or re-grant the assignment', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTargetWithoutAccessType('user-target-1009a');
      const assignmentDocs = assignmentsFor('user-target-1009a');

      const req = createRequest({
        params: { id: 'user-target-1009a' },
        body: { name: 'Renomeado', roleName: 'Técnico' },
      });
      req.app.locals.db = dbWithAssignments(assignmentDocs);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      // No spurious revoke + grant pair: the same assignment, untouched.
      expect(assignmentDocs).toHaveLength(2);
      const targetAssignment = assignmentDocs.find((d) => d.userAccountId === 'user-target-1009a');
      expect(targetAssignment.assignmentId).toBe('assign-target-1009');
      expect(targetAssignment.assignmentStatus).toBe('active');
      expect(targetAssignment.revokedBy).toBeUndefined();
      expect(targetAssignment.revocationReason).toBeUndefined();
      // NOTE: the natural extra assertion here -- that a plain rename routes
      // to logUpdate rather than logPermissionChange -- cannot be written in
      // this file. `auditLoggerMock` is never installed: the route requires
      // auditLogger lazily inside the handler, and vi.mock does not intercept
      // that here. A deliberately bogus mock path behaves identically, so the
      // miss is silent. Filed separately.
    });

    it('#1009: an org-only edit on a target holding a role still re-scopes without revoking', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      const targetUser = {
        _id: 'user-target-1009d',
        name: 'Alvo 1009 Org',
        email: 'alvo-1009d@bioavanced.com.br',
        username: 'alvo1009d',
        status: 'active',
        organizationId: 'org-old',
      };
      usersCollection.findOne
        .mockResolvedValueOnce(targetUser)
        .mockResolvedValueOnce({ ...targetUser, organizationId: 'org-new' });
      usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      const assignmentDocs = assignmentsFor('user-target-1009d');
      assignmentDocs[1].scopeType = 'organization';
      assignmentDocs[1].scopeId = 'org-old';

      const req = createRequest({
        params: { id: 'user-target-1009d' },
        body: { organizationId: 'org-new', roleName: 'Técnico' },
      });
      req.app.locals.db = dbWithAssignments(assignmentDocs);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      // The issue body called this the trap: it feared tightening the guard
      // would stop org re-scoping. It does not -- updateAssignmentScope runs
      // unconditionally on any real organizationId change and never consulted
      // the guard. Before the fix this case ALSO fired changeUserRole, so the
      // scope landed on a brand-new assignment instead of the existing one.
      expect(assignmentDocs).toHaveLength(2);
      const targetAssignment = assignmentDocs.find((d) => d.userAccountId === 'user-target-1009d');
      expect(targetAssignment.assignmentId).toBe('assign-target-1009');
      expect(targetAssignment.assignmentStatus).toBe('active');
      expect(targetAssignment.scopeId).toBe('org-new');
    });

    // Control: expected behaviour is IDENTICAL before and after the fix, so
    // this must be green in the pre-fix run. A red one here would mean the
    // fixture is wrong (a 422 from UserModel.validate, or a missing caller
    // assignment tripping #998's floor) rather than the bug reproducing.
    it('#1009 control: a real level change still revokes the old assignment and grants the new one', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTargetWithoutAccessType('user-target-1009c');
      const assignmentDocs = assignmentsFor('user-target-1009c');

      const req = createRequest({
        params: { id: 'user-target-1009c' },
        body: { roleName: 'Coordenador' },
      });
      req.app.locals.db = dbWithAssignments(assignmentDocs);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const old = assignmentDocs.find((d) => d.assignmentId === 'assign-target-1009');
      expect(old.assignmentStatus).toBe('revoked');
      expect(old.revocationReason).toBe('role_changed');
      const granted = assignmentDocs.filter(
        (d) => d.userAccountId === 'user-target-1009c' && d.assignmentStatus === 'active'
      );
      expect(granted).toHaveLength(1);
      expect(granted[0].roleId).toBe('role-coordinator');
    });
  });
});
