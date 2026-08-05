import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
const require2 = createRequire(import.meta.url);
const { buildRbacCollections } = require2('../factories/rbac.factory');

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

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: '507f1f77bcf86cd799439012', accessType: 2 },
    ]);

    db = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'access') return accessCollection;
        if (name === 'logs') return logsCollection;
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
