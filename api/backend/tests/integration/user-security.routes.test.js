import { describe, it, expect, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';

const serviceMocks = vi.hoisted(() => ({
  getSecurityStatus: vi.fn().mockResolvedValue({ securityScore: 90, overallLevel: 'strong', alternativeMethodsCount: 1 }),
  getMFAStatus: vi.fn().mockResolvedValue({ primaryEnabled: true, recoveryCodes: { remaining: 5 } }),
  getPasswordStatus: vi.fn().mockResolvedValue({ strength: 'strong', strengthScore: 4 }),
  getSessions: vi.fn().mockResolvedValue([
    { id: 'session-1', deviceName: 'Desktop', browser: 'Chrome', os: 'Windows', lastAccess: new Date().toISOString(), isCurrent: true },
  ]),
  getActivities: vi.fn().mockResolvedValue([]),
  updatePassword: vi.fn().mockResolvedValue(undefined),
  generateRecoveryCodes: vi.fn().mockResolvedValue(['CODE-1', 'CODE-2']),
  revokeSession: vi.fn().mockResolvedValue(undefined),
  revokeAllSessions: vi.fn().mockResolvedValue(undefined),
  requestPasswordReset: vi.fn().mockResolvedValue(undefined),
}));

const auditLoggerMock = vi.hoisted(() => ({
  init: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  extractRequestInfo: vi.fn(() => ({ ipAddress: '127.0.0.1', userAgent: 'test' })),
}));

vi.mock('../../../src/services/user-security.service', () => serviceMocks);
vi.mock('../../../src/utils/auditLogger', () => auditLoggerMock);

const userSecurityControllerModule = await import('../../../src/controllers/user-security.controller');
const userSecurityController = userSecurityControllerModule.default || userSecurityControllerModule;

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

function createRequest({ body = {}, params = {}, query = {}, userID = '507f1f77bcf86cd799439011' } = {}) {
  return {
    body,
    params,
    query,
    user: {
      userID,
      accessType: 4,
      roleName: 'Administrador',
    },
    headers: {
      authorization: 'Bearer token',
    },
    t: (key) => key,
    app: {
      locals: {
        db: {
          collection: vi.fn(() => ({
            findOne: vi.fn(),
            updateOne: vi.fn(),
            deleteMany: vi.fn(),
            find: vi.fn(),
          })),
        },
      },
    },
  };
}

describe('User security routes', () => {
  let db;
  let usersCollection;
  let sessionsCollection;
  let recoveryCodesCollection;
  let activityCollection;
  const hashedPassword = bcrypt.hashSync('Senha@123', 10);

  beforeEach(() => {
    usersCollection = {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      find: vi.fn(),
    };

    sessionsCollection = {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              sessionID: 'session-1',
              token: 'Bearer token',
              isActive: true,
              lastActivity: new Date('2024-01-01T00:00:00.000Z'),
              metadata: { userAgent: 'Chrome/123 Windows', ip: '127.0.0.1' },
            },
          ]),
        }),
      }),
    };

    recoveryCodesCollection = {
      findOne: vi.fn().mockResolvedValue({ remaining: 5 }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };

    activityCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };

    db = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'sessions') return sessionsCollection;
        if (name === 'recovery_codes') return recoveryCodesCollection;
        if (name === 'user_activities') return activityCollection;
        if (name === 'logs') return { insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-1' }) };
        return {
          findOne: vi.fn(),
          updateOne: vi.fn(),
          updateMany: vi.fn(),
          deleteMany: vi.fn(),
          find: vi.fn(),
          insertOne: vi.fn(),
        };
      }),
    };

    vi.clearAllMocks();
  });

  it('GET /api/user/security/status deve retornar status de segurança', async () => {
    const req = createRequest();
    req.app.locals.db = db;
    req.user.userID = '507f1f77bcf86cd799439011';
    usersCollection.findOne.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      mfaEnabled: true,
      password: hashedPassword,
      passwordChangedAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    const res = createResponse();

    await userSecurityController.getStatus(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data.securityScore).toBeGreaterThan(0);
  });

  it('GET /api/user/security/mfa deve retornar status MFA', async () => {
    const req = createRequest();
    req.app.locals.db = db;
    usersCollection.findOne.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      mfaEnabled: true,
      mfaSetupDate: new Date('2024-01-01T00:00:00.000Z'),
    });
    const res = createResponse();

    await userSecurityController.getMFAStatus(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data.primaryEnabled).toBe(true);
  });

  it('GET /api/user/security/password deve retornar status de senha', async () => {
    const req = createRequest();
    req.app.locals.db = db;
    usersCollection.findOne.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      password: hashedPassword,
      passwordChangedAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    const res = createResponse();

    await userSecurityController.getPasswordStatus(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data.strength).toBe('strong');
  });

  it('GET /api/user/security/sessions deve retornar sessões', async () => {
    const req = createRequest();
    req.app.locals.db = db;
    const res = createResponse();

    await userSecurityController.getSessions(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data).toHaveLength(1);
  });

  it('PUT /api/user/security/password deve exigir campos obrigatórios', async () => {
    const req = createRequest({ body: { currentPassword: 'abc' } });
    req.app.locals.db = db;
    const res = createResponse();

    await userSecurityController.updatePassword(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
  });

  it('PUT /api/user/security/password deve atualizar senha quando payload é válido', async () => {
    const req = createRequest({ body: { currentPassword: 'Senha@123', newPassword: 'NovaSenha@123' } });
    req.app.locals.db = db;
    usersCollection.findOne.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      password: hashedPassword,
    });
    const res = createResponse();

    await userSecurityController.updatePassword(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
  });

  it('POST /api/user/security/recovery-codes deve gerar códigos', async () => {
    const req = createRequest();
    req.app.locals.db = db;
    const res = createResponse();

    await userSecurityController.generateRecoveryCodes(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.payload.data.codes).toHaveLength(10);
  });

  it('DELETE /api/user/security/sessions/:id deve revogar sessão específica', async () => {
    const req = createRequest({ params: { id: 'session-1' } });
    req.app.locals.db = db;
    const res = createResponse();

    await userSecurityController.revokeSession(req, res);

    expect(res.statusCode).toBe(200);
    expect(sessionsCollection.updateOne).toHaveBeenCalled();
  });

  it('DELETE /api/user/security/sessions deve revogar todas as sessões', async () => {
    const req = createRequest();
    req.app.locals.db = db;
    const res = createResponse();

    await userSecurityController.revokeAllSessions(req, res);

    expect(res.statusCode).toBe(200);
    expect(sessionsCollection.updateMany).toHaveBeenCalled();
  });

  it('POST /api/user/security/password-reset/request deve solicitar redefinição', async () => {
    const req = createRequest();
    req.app.locals.db = db;
    const res = createResponse();

    await userSecurityController.requestPasswordReset(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
  });
});
