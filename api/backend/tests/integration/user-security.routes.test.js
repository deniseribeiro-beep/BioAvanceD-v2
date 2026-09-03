import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { createRequire } from 'node:module';

const require2 = createRequire(import.meta.url);

// #1025 (split from #1017, identical root cause one file over): this file used
// to declare vi.hoisted mocks for user-security.service and auditLogger and
// register them with vi.mock at '../../../src/...'. That depth is one level too
// far -- this file sits at api/backend/tests/integration, so '../../../src' is
// `api/src`, which does not exist. Vite resolved both specifiers to null and
// vitest neither errored nor warned, so BOTH mocks were inert and the real
// modules ran. The `await import` of the controller survived only because
// vitest retries a failed dynamic import as a root-relative URL -- a retry it
// does NOT extend to vi.mock.
//
// The tell was measurable, not inferred: the suite printed four
// AUDIT_TRAIL_WRITE_FAILURE blocks per run, which is the REAL auditLogger
// writing against the mocked db. It prints none now.
//
// Second tell, and proof the service mock was inert too: the recovery-codes
// test below asserts `toHaveLength(10)` while the deleted mock's
// generateRecoveryCodes returned TWO codes. That assertion was written against
// the real service and has been passing against it all along.
//
// Even at the correct depth vi.mock would not have been enough for auditLogger:
// this controller requires it at module scope (:3) AND lazily inside a handler
// (:119), and vitest's mock registry is not consulted by the require a handler
// actually executes. Spying on the CJS module object covers both -- the
// module-scope binding and the lazy require resolve to the same cached
// module.exports, so mutating it is observed at call time either way. That is
// the pattern auth.routes.test.js and users-access.routes.test.js already use.
const auditLogger = require2('../../src/utils/auditLogger');

// Required, not imported, so the controller and the spy target share one module
// instance. Mixing `await import` (vitest's module runner) with createRequire
// (native CJS cache) yields two auditLogger objects and the spies miss
// silently -- which is the failure this change exists to end.
const userSecurityController = require2('../../src/controllers/user-security.controller');

// The service is deliberately NOT stubbed. The real one has been running behind
// the inert mock since this file was written, so installing the mock now would
// CHANGE what this suite tests rather than restore it -- the assertions below
// are pinned to real-service output (see the recovery-codes note above).
// auditLogger's writes are stubbed because the real ones are what emit the
// AUDIT_TRAIL_WRITE_FAILURE noise against a mocked db.
const auditSpies = {
  init: vi.spyOn(auditLogger, 'init').mockImplementation(() => {}),
  log: vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined),
  extractRequestInfo: vi.spyOn(auditLogger, 'extractRequestInfo')
    .mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' }),
};

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
  afterEach(() => {
    for (const spy of Object.values(auditSpies)) spy.mockClear();
  });

  // #1025: the assertion the corrected wiring makes possible, and the reason
  // this file's mock repair is worth more than silence. Under the old inert
  // vi.mock nothing could observe an audit write at all -- the real auditLogger
  // ran and failed against the mocked db, emitting AUDIT_TRAIL_WRITE_FAILURE to
  // stderr, which no assertion reads. RF014/RNF-audit make the password-change
  // row a compliance artefact, so it is worth pinning that it is written and
  // written as critical.
  it('#1025: a successful password change writes a critical audit row through the spied auditLogger', async () => {
    const req = createRequest({ body: { currentPassword: 'Senha@123', newPassword: 'NovaSenha@123' } });
    req.app.locals.db = db;
    usersCollection.findOne.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      password: hashedPassword,
    });
    const res = createResponse();

    await userSecurityController.updatePassword(req, res);

    expect(res.statusCode).toBe(200);
    // init() proves the spy target is the same module object the controller's
    // module-scope require bound -- the identity this file previously got wrong.
    expect(auditSpies.init).toHaveBeenCalledWith(db);
    expect(auditSpies.log).toHaveBeenCalledTimes(1);
    expect(auditSpies.log.mock.calls[0][0]).toMatchObject({
      action: 'UPDATE',
      resourceType: 'Password',
      status: 'success',
      severity: 'critical',
    });
  });
});
