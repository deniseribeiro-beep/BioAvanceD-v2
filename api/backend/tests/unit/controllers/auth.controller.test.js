import { afterEach, describe, expect, it, vi } from 'vitest';

// NOTE on mocking strategy: this repo's Vitest setup does not let vi.mock()
// intercept CommonJS require() (see .claude/skills/testing-conventions/SKILL.md).
// auth.controller.js does plain, non-destructured
// `const authService = require('../services/auth.service')`,
// `const bcrypt = require('bcryptjs')` and
// `const passwordService = require('../services/password.service')` at the top.
// Node's CJS module cache guarantees the controller and this test share the
// same object instances, so we require the real singletons and vi.spyOn()
// their methods, restoring with vi.restoreAllMocks() in afterEach.
const authController = require('../../../src/controllers/auth.controller');
const authService = require('../../../src/services/auth.service');
const auditLogger = require('../../../src/utils/auditLogger');
const logger = require('../../../src/utils/logger');
const bcrypt = require('bcryptjs');
const passwordService = require('../../../src/services/password.service');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    cookie: vi.fn(),
  };
}

function createReq(overrides = {}) {
  return {
    app: { locals: { db: { fake: true } } },
    params: {},
    query: {},
    body: {},
    user: undefined,
    ip: '127.0.0.1',
    headers: {},
    ...overrides,
  };
}

const NO_DB_REQ = (overrides = {}) => createReq({ app: { locals: {} }, ...overrides });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthController.register', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();

    await authController.register(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Banco de dados não disponível',
    });
  });

  // #1037: registerUser's third argument is `grantedBy`, defaulting to the
  // string 'system'. While POST /api/auth/register was unauthenticated the
  // controller passed only two arguments, so every account created through it
  // carried grantedBy: 'system' on its UserRoleAssignment with no actor
  // anywhere. The route now requires authenticate + createUser, so the
  // caller's id is always available and is forwarded.
  it('returns 201, forwards the caller as grantedBy, and writes the CREATE audit row', async () => {
    const fakeUser = { userID: 'u1', username: 'alice', _id: { toString: () => 'oid-1' } };
    vi.spyOn(authService, 'registerUser').mockResolvedValue(fakeUser);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({
      body: { username: 'alice', password: 'Str0ng!Pass' },
      user: { userID: 'caller-1' },
    });
    const res = createRes();

    await authController.register(req, res);

    expect(authService.registerUser).toHaveBeenCalledWith(req.app.locals.db, req.body, 'caller-1');
    // RF003 AC#6 requires auditing account creation; RF012 AC#1 and RNF009
    // AC#2 (Critica) make the actor mandatory on the event.
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatchObject({
      action: 'CREATE',
      resourceType: 'User',
      resourceId: 'oid-1',
      status: 'success',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Usuário registrado com sucesso',
      data: fakeUser,
    });
  });

  // #1037: a logging fault must not turn a successful creation into a 400 via
  // the handler's outer catch. auditLogger.log swallows its own errors, so
  // this pins the controller's own belt-and-braces guard rather than that.
  it('still returns 201 when the audit write throws', async () => {
    const fakeUser = { userID: 'u1', username: 'alice', _id: { toString: () => 'oid-1' } };
    vi.spyOn(authService, 'registerUser').mockResolvedValue(fakeUser);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockRejectedValue(new Error('audit down'));
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createReq({ body: { username: 'alice' }, user: { userID: 'caller-1' } });
    const res = createRes();

    await authController.register(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns 400 when authService.registerUser throws', async () => {
    vi.spyOn(authService, 'registerUser').mockRejectedValue(new Error('username taken'));
    const req = createReq({ body: { username: 'alice' } });
    const res = createRes();

    await authController.register(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao registrar usuário',
      message: 'username taken',
    });
  });
});

describe('AuthController.login', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Banco de dados não disponível',
    });
  });

  it('returns requiresMFASetup payload when the service indicates first login', async () => {
    vi.spyOn(authService, 'login').mockResolvedValue({
      requiresMFASetup: true,
      tempToken: 'temp-123',
      user: { userID: 'u1' },
    });
    const req = createReq({ body: { username: 'alice', password: 'x' } });
    const res = createRes();

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      requiresMFASetup: true,
      requiresTwoFactorSetup: true,
      message: 'Configuração de MFA obrigatória no primeiro acesso',
      data: {
        tempToken: 'temp-123',
        user: { userID: 'u1' },
      },
    });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('returns requiresMFA payload when MFA code is needed', async () => {
    vi.spyOn(authService, 'login').mockResolvedValue({ requiresMFA: true });
    const req = createReq({ body: { username: 'alice', password: 'x' } });
    const res = createRes();

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      requiresMFA: true,
      requiresTwoFactor: true,
      message: 'Código de autenticação necessário',
    });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  // RF014 AC#4 (#648): requiresPasswordChange must be hoisted to the
  // response's root level, same as requiresMFASetup/requiresMFA above --
  // AuthContext.tsx's frontend only reads it there, not nested under
  // `data`. Left nested, the frontend falls through to its generic 2FA
  // fallback instead (confirmed live, real-backend e2e, before this fix).
  it('returns requiresPasswordChange payload when the service indicates a forced reset', async () => {
    vi.spyOn(authService, 'login').mockResolvedValue({
      requiresPasswordChange: true,
      message: 'Alteração de senha obrigatória antes de continuar',
    });
    const req = createReq({ body: { username: 'alice', password: 'x' } });
    const res = createRes();

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      requiresPasswordChange: true,
      message: 'Alteração de senha obrigatória antes de continuar',
    });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('sets refresh cookie, sanitizes payload, and logs successful login on success', async () => {
    vi.useFakeTimers();
    const logLoginSpy = vi.spyOn(auditLogger, 'logLogin').mockResolvedValue();
    vi.spyOn(authService, 'login').mockResolvedValue({
      token: 'jwt-abc',
      refreshToken: 'refresh-abc',
      sessionID: 'sess-abc',
      user: { userID: 'u1', username: 'alice' },
    });
    const req = createReq({ body: { username: 'alice', password: 'x' } });
    const res = createRes();

    await authController.login(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-abc',
      expect.objectContaining({
        httpOnly: true,
        path: '/api/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Login realizado com sucesso',
      data: {
        token: 'jwt-abc',
        user: { userID: 'u1', username: 'alice' },
      },
    });
    // sanitizeAuthPayload must strip refreshToken/sessionID from the response
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.data).not.toHaveProperty('refreshToken');
    expect(jsonArg.data).not.toHaveProperty('sessionID');

    // req.user should be set for the auditLogger, and logLogin invoked async
    expect(req.user).toEqual({ userID: 'u1', username: 'alice' });
    expect(logLoginSpy).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(logLoginSpy).toHaveBeenCalledWith(req, true);
    vi.useRealTimers();
  });

  it('does not set a refresh cookie when the service result has no refreshToken', async () => {
    vi.spyOn(auditLogger, 'logLogin').mockResolvedValue();
    vi.spyOn(authService, 'login').mockResolvedValue({
      token: 'jwt-abc',
      user: { userID: 'u1' },
    });
    const req = createReq({ body: { username: 'alice', password: 'x' } });
    const res = createRes();

    await authController.login(req, res);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 401 and logs a failed login when authService.login throws', async () => {
    vi.useFakeTimers();
    const logLoginSpy = vi.spyOn(auditLogger, 'logLogin').mockResolvedValue();
    const loginError = new Error('invalid credentials');
    vi.spyOn(authService, 'login').mockRejectedValue(loginError);
    const req = createReq({ body: { username: 'alice', password: 'wrong' } });
    const res = createRes();

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao fazer login. Verifique suas credenciais.',
      message: 'invalid credentials',
    });
    expect(logLoginSpy).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(logLoginSpy).toHaveBeenCalledWith(req, false, loginError);
    vi.useRealTimers();
  });

  it('returns 401 with an MFA_LOCKED code when authService.login throws a locked-account error', async () => {
    vi.useFakeTimers();
    const logLoginSpy = vi.spyOn(auditLogger, 'logLogin').mockResolvedValue();
    const lockedError = new Error('MFA bloqueado devido a muitas tentativas falhas');
    lockedError.code = 'MFA_LOCKED';
    vi.spyOn(authService, 'login').mockRejectedValue(lockedError);
    const req = createReq({ body: { username: 'alice', password: 'wrong' } });
    const res = createRes();

    await authController.login(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'MFA_LOCKED',
      error: 'MFA bloqueado devido a muitas tentativas falhas',
      message: 'MFA bloqueado devido a muitas tentativas falhas',
    });
    expect(logLoginSpy).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(logLoginSpy).toHaveBeenCalledWith(req, false, lockedError);
    vi.useRealTimers();
  });

  it('logs the error stack (not just the message) when the thrown error has a stack', async () => {
    vi.useFakeTimers();
    vi.spyOn(auditLogger, 'logLogin').mockResolvedValue();
    const loginError = new Error('invalid credentials');
    vi.spyOn(authService, 'login').mockRejectedValue(loginError);
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createReq({ body: { username: 'alice', password: 'wrong' } });
    const res = createRes();

    await authController.login(req, res);

    expect(loggerSpy).toHaveBeenCalledWith('Erro no login:', loginError.stack);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });
});

describe('AuthController refresh-cookie security options (item 8)', () => {
  it('sets Secure + SameSite=Strict in production when login issues a refresh token', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      vi.spyOn(authService, 'login').mockResolvedValue({
        token: 'access-prod',
        refreshToken: 'refresh-prod',
        sessionID: 'session-prod',
        user: { userID: 'u-prod' },
      });
      vi.spyOn(auditLogger, 'logLogin').mockResolvedValue(undefined);

      const req = createReq({ body: { email: 'prod@example.test', password: 'pw' } });
      const res = createRes();

      await authController.login(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-prod',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/api/auth',
        })
      );
      const payload = res.json.mock.calls[0][0].data;
      expect(payload).not.toHaveProperty('refreshToken');
      expect(payload).not.toHaveProperty('sessionID');
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('uses the non-production cookie contract and emits no cookie when no refresh token is returned', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'test';
      vi.spyOn(auditLogger, 'logLogin').mockResolvedValue(undefined);

      vi.spyOn(authService, 'login')
        .mockResolvedValueOnce({
          token: 'access-test',
          refreshToken: 'refresh-test',
          sessionID: 'session-test',
          user: { userID: 'u-test' },
        })
        .mockResolvedValueOnce({
          token: 'access-no-refresh',
          user: { userID: 'u-test-2' },
        });

      let res = createRes();
      await authController.login(createReq({ body: { email: 'test@example.test', password: 'pw' } }), res);
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-test',
        expect.objectContaining({ secure: false, sameSite: 'lax' })
      );

      res = createRes();
      await authController.login(createReq({ body: { email: 'test2@example.test', password: 'pw' } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.cookie).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

describe('AuthController.setupMFA', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ({ user: { userID: 'u1' } });
    const res = createRes();

    await authController.setupMFA(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 with setup data on success', async () => {
    vi.spyOn(authService, 'setupMFA').mockResolvedValue({ qrCode: 'data:...', secret: 's3cr3t' });
    const req = createReq({ user: { userID: 'u1' } });
    const res = createRes();

    await authController.setupMFA(req, res);

    expect(authService.setupMFA).toHaveBeenCalledWith(req.app.locals.db, 'u1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { qrCode: 'data:...', secret: 's3cr3t' },
    });
  });

  it('returns 400 when authService.setupMFA throws', async () => {
    vi.spyOn(authService, 'setupMFA').mockRejectedValue(new Error('boom'));
    const req = createReq({ user: { userID: 'u1' } });
    const res = createRes();

    await authController.setupMFA(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao configurar MFA',
      message: 'boom',
    });
  });

  it('uses req.t translation for the db-unavailable message when req.t is present', async () => {
    const req = NO_DB_REQ({ user: { userID: 'u1' }, t: vi.fn(() => 'DB indisponível (traduzido)') });
    const res = createRes();

    await authController.setupMFA(req, res);

    expect(req.t).toHaveBeenCalledWith('errors.databaseUnavailable');
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'DB indisponível (traduzido)',
    });
  });
});

describe('AuthController.enableMFA', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ({ user: { userID: 'u1' }, body: { code: '123456' } });
    const res = createRes();

    await authController.enableMFA(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Banco de dados não disponível' });
  });

  it('returns 400 when no mfaCode/code is provided', async () => {
    const req = createReq({ user: { userID: 'u1' }, body: {} });
    const res = createRes();

    await authController.enableMFA(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Código MFA é obrigatório',
    });
  });

  it('accepts "code" as an alias for "mfaCode" and passes it to the service', async () => {
    vi.spyOn(authService, 'enableMFA').mockResolvedValue({ success: true });
    const req = createReq({ user: { userID: 'u1' }, body: { code: '654321' } });
    const res = createRes();

    await authController.enableMFA(req, res);

    expect(authService.enableMFA).toHaveBeenCalledWith(req.app.locals.db, 'u1', '654321');
  });

  it('returns full token payload when result.token is present (first-login path)', async () => {
    vi.spyOn(authService, 'enableMFA').mockResolvedValue({
      token: 'jwt-first',
      refreshToken: 'refresh-first',
      user: { userID: 'u1' },
    });
    const req = createReq({ user: { userID: 'u1' }, body: { mfaCode: '111111' } });
    const res = createRes();

    await authController.enableMFA(req, res);

    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-first', expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'MFA ativado com sucesso. Primeiro acesso concluído.',
      data: {
        token: 'jwt-first',
        user: { userID: 'u1' },
      },
    });
  });

  it('returns sanitized data payload when result.token is absent', async () => {
    vi.spyOn(authService, 'enableMFA').mockResolvedValue({
      refreshToken: 'refresh-x',
      sessionID: 'sess-x',
      user: { userID: 'u1' },
    });
    const req = createReq({ user: { userID: 'u1' }, body: { mfaCode: '111111' } });
    const res = createRes();

    await authController.enableMFA(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg).toEqual({
      success: true,
      message: 'MFA ativado com sucesso',
      data: { user: { userID: 'u1' } },
    });
    expect(jsonArg.data).not.toHaveProperty('refreshToken');
    expect(jsonArg.data).not.toHaveProperty('sessionID');
  });

  it('returns 400 when authService.enableMFA throws', async () => {
    vi.spyOn(authService, 'enableMFA').mockRejectedValue(new Error('invalid code'));
    const req = createReq({ user: { userID: 'u1' }, body: { mfaCode: '000000' } });
    const res = createRes();

    await authController.enableMFA(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao ativar MFA',
      message: 'invalid code',
    });
  });

  it('uses req.t translation for the code-required message when req.t is present', async () => {
    const req = createReq({
      user: { userID: 'u1' },
      body: {},
      t: vi.fn(() => 'Código MFA obrigatório (traduzido)'),
    });
    const res = createRes();

    await authController.enableMFA(req, res);

    expect(req.t).toHaveBeenCalledWith('mfa.codeRequired');
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Código MFA obrigatório (traduzido)',
    });
  });
});

describe('AuthController.requestPasswordReset', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ({ body: { email: 'a@b.com' } });
    const res = createRes();

    await authController.requestPasswordReset(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 400 when email is missing', async () => {
    const req = createReq({ body: {} });
    const res = createRes();

    await authController.requestPasswordReset(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Email é obrigatório',
    });
  });

  it('returns 200 with reset link/token on success', async () => {
    vi.spyOn(authService, 'requestPasswordReset').mockResolvedValue({
      message: 'ok',
      resetLink: 'https://x/reset?t=abc',
      token: 'abc',
    });
    const req = createReq({ body: { email: 'a@b.com' } });
    const res = createRes();

    await authController.requestPasswordReset(req, res);

    expect(authService.requestPasswordReset).toHaveBeenCalledWith(req.app.locals.db, 'a@b.com', req);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'ok',
      data: { resetLink: 'https://x/reset?t=abc', token: 'abc' },
    });
  });

  it('returns 400 when authService.requestPasswordReset throws', async () => {
    vi.spyOn(authService, 'requestPasswordReset').mockRejectedValue(new Error('smtp down'));
    const req = createReq({ body: { email: 'a@b.com' } });
    const res = createRes();

    await authController.requestPasswordReset(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao solicitar recuperação de senha',
      message: 'smtp down',
    });
  });
});

describe('AuthController.resetPassword', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ({ body: { token: 't', newPassword: 'p' } });
    const res = createRes();

    await authController.resetPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 400 when token is missing', async () => {
    const req = createReq({ body: { newPassword: 'p' } });
    const res = createRes();

    await authController.resetPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Token de recuperação é obrigatório',
    });
  });

  it('returns 400 when newPassword is missing', async () => {
    const req = createReq({ body: { token: 't' } });
    const res = createRes();

    await authController.resetPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Nova senha é obrigatória',
    });
  });

  it('returns 200 on success', async () => {
    vi.spyOn(authService, 'resetPassword').mockResolvedValue({ message: 'senha alterada' });
    const req = createReq({ body: { token: 't', newPassword: 'NewStr0ng!' } });
    const res = createRes();

    await authController.resetPassword(req, res);

    expect(authService.resetPassword).toHaveBeenCalledWith(req.app.locals.db, 't', 'NewStr0ng!', req);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'senha alterada' });
  });

  it('returns 400 when authService.resetPassword throws', async () => {
    vi.spyOn(authService, 'resetPassword').mockRejectedValue(new Error('token expired'));
    const req = createReq({ body: { token: 't', newPassword: 'NewStr0ng!' } });
    const res = createRes();

    await authController.resetPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao resetar senha',
      message: 'token expired',
    });
  });

  it('uses req.t translation for the newPassword-required message when req.t is present', async () => {
    const req = createReq({ body: { token: 't' }, t: vi.fn(() => 'Nova senha obrigatória (traduzido)') });
    const res = createRes();

    await authController.resetPassword(req, res);

    expect(req.t).toHaveBeenCalledWith('auth.newPasswordRequired');
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Nova senha obrigatória (traduzido)',
    });
  });
});

describe('AuthController.changePassword', () => {
  function createUsersCollection(user) {
    return {
      findOne: vi.fn().mockResolvedValue(user),
      updateOne: vi.fn().mockResolvedValue({}),
    };
  }

  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ({ user: { userID: 'u1' }, body: { oldPassword: 'a', newPassword: 'b' } });
    const res = createRes();

    await authController.changePassword(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 400 when oldPassword or newPassword is missing', async () => {
    const req = createReq({ user: { userID: 'u1' }, body: { oldPassword: 'a' } });
    const res = createRes();

    await authController.changePassword(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Senha atual e nova senha são obrigatórias',
    });
  });

  it('returns 404 when the user record is not found', async () => {
    const usersCollection = createUsersCollection(null);
    const db = { collection: vi.fn().mockReturnValue(usersCollection) };
    const req = createReq({
      app: { locals: { db } },
      user: { userID: '507f1f77bcf86cd799439011' },
      body: { oldPassword: 'a', newPassword: 'b' },
    });
    const res = createRes();

    await authController.changePassword(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Usuário não encontrado',
    });
  });

  it('returns 400 when the old password does not match', async () => {
    const user = { _id: 'u1', password: 'hashed-old', passwordHistory: [] };
    const usersCollection = createUsersCollection(user);
    const db = { collection: vi.fn().mockReturnValue(usersCollection) };
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const req = createReq({
      app: { locals: { db } },
      user: { userID: '507f1f77bcf86cd799439011' },
      body: { oldPassword: 'wrong', newPassword: 'NewStr0ng!' },
    });
    const res = createRes();

    await authController.changePassword(req, res);

    expect(bcrypt.compare).toHaveBeenCalledWith('wrong', 'hashed-old');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Senha atual incorreta',
    });
  });

  // #995 (RF001 AC#2): this route runs its own bcrypt.compare against a
  // body-supplied oldPassword. It is the fourth such call site; 490077f4 (#986)
  // covered the other three with auth.service's shared helpers and this one was
  // not reachable from them, because the helpers were module-private.
  it('counts a wrong old password toward the account lockout', async () => {
    const user = { _id: 'u1', password: 'hashed-old', passwordHistory: [], failedLoginAttempts: 1 };
    const usersCollection = createUsersCollection(user);
    const db = { collection: vi.fn().mockReturnValue(usersCollection) };
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    const req = createReq({
      app: { locals: { db } },
      user: { userID: '507f1f77bcf86cd799439011' },
      body: { oldPassword: 'wrong', newPassword: 'NewStr0ng!' },
    });
    const res = createRes();

    await authController.changePassword(req, res);

    expect(usersCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'u1' },
      expect.objectContaining({ $inc: { failedLoginAttempts: 1 } })
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // #995: an account already locked must not get free bcrypt rounds here. The
  // gate runs BEFORE the compare for the same reason it does in processLogin --
  // after it, a lock denies only the eventual correct guess while every wrong
  // one still burns a round.
  it('refuses a locked account before verifying the old password', async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
    const user = { _id: 'u1', password: 'hashed-old', passwordHistory: [], accountLockedUntil: lockedUntil };
    const usersCollection = createUsersCollection(user);
    const db = { collection: vi.fn().mockReturnValue(usersCollection) };
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const req = createReq({
      app: { locals: { db } },
      user: { userID: '507f1f77bcf86cd799439011' },
      body: { oldPassword: 'correct', newPassword: 'NewStr0ng!' },
    });
    const res = createRes();

    await authController.changePassword(req, res);

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // #995: an EXPIRED lock must not refuse. isAccountLocked() compares against
  // now, so this is the negative half of the gate above -- without it the test
  // pair cannot tell a working gate from one that refuses unconditionally.
  it('allows the change when a previous lock has already expired', async () => {
    const expired = new Date(Date.now() - 60 * 1000);
    const user = { _id: 'u1', password: 'hashed-old', passwordHistory: [], accountLockedUntil: expired };
    const usersCollection = createUsersCollection(user);
    const sessionsCollection = { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }) };
    const db = { collection: vi.fn((name) => (name === 'sessions' ? sessionsCollection : usersCollection)) };
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-new');
    vi.spyOn(passwordService, 'validateStrength').mockReturnValue(true);
    vi.spyOn(passwordService, 'validateReuse').mockResolvedValue(true);
    const req = createReq({
      app: { locals: { db } },
      user: { userID: '507f1f77bcf86cd799439011' },
      body: { oldPassword: 'correct', newPassword: 'NewStr0ng!' },
    });
    const res = createRes();

    await authController.changePassword(req, res);

    expect(bcrypt.compare).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updates the password and returns 200 on success', async () => {
    const user = { _id: 'u1', password: 'hashed-old', passwordHistory: ['hashed-oldest'] };
    const usersCollection = createUsersCollection(user);
    // #958: a named sessions collection, not the one-collection-for-every-name
    // stub this file used -- a password change now revokes the user's OTHER
    // sessions, and a mock without updateMany would throw into changePassword's
    // catch and turn a 200 into a 400.
    const sessionsCollection = { updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 }) };
    const db = { collection: vi.fn((name) => (name === 'sessions' ? sessionsCollection : usersCollection)) };
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-new');
    vi.spyOn(passwordService, 'validateStrength').mockReturnValue(true);
    vi.spyOn(passwordService, 'validateReuse').mockResolvedValue(true);
    const req = createReq({
      app: { locals: { db } },
      user: { userID: '507f1f77bcf86cd799439011' },
      body: { oldPassword: 'correct', newPassword: 'NewStr0ng!' },
    });
    const res = createRes();

    await authController.changePassword(req, res);

    expect(passwordService.validateStrength).toHaveBeenCalledWith('NewStr0ng!');
    expect(passwordService.validateReuse).toHaveBeenCalledWith('NewStr0ng!', user);
    expect(bcrypt.hash).toHaveBeenCalledWith('NewStr0ng!', 10);
    expect(usersCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'u1' },
      {
        $set: expect.objectContaining({
          password: 'hashed-new',
          passwordHistory: ['hashed-old', 'hashed-oldest'],
          forceReset: false,
          // #995: failedLoginAttempts: 0 was here alone. The lockout gate reads
          // accountLockedUntil and never the counter, so zeroing one without
          // nulling the other left the document internally inconsistent -- zero
          // recorded failures, an active lock -- and the user still locked out.
          // Both keys now come from auth.service's clearedLockoutFields().
          failedLoginAttempts: 0,
          accountLockedUntil: null,
        }),
      }
    );
    // #958 / RNF021 AC#2: "troca de senha ... revogam as sessoes afetadas".
    // All-but-current: the session making this request just proved knowledge of
    // BOTH the old and the new password, so it is not an affected session.
    expect(sessionsCollection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ userID: '507f1f77bcf86cd799439011', isActive: true }),
      expect.objectContaining({
        $set: expect.objectContaining({
          isRevoked: true,
          revocationReason: 'password_change',
          revokedBy: '507f1f77bcf86cd799439011',
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Senha alterada com sucesso',
    });
  });

  it('uses req.t translation for the db-unavailable message when req.t is present', async () => {
    const req = NO_DB_REQ({
      user: { userID: 'u1' },
      body: { oldPassword: 'a', newPassword: 'b' },
      t: vi.fn(() => 'DB indisponível (traduzido)'),
    });
    const res = createRes();

    await authController.changePassword(req, res);

    expect(req.t).toHaveBeenCalledWith('errors.databaseUnavailable');
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'DB indisponível (traduzido)',
    });
  });

  it('returns 400 when passwordService.validateStrength throws', async () => {
    const user = { _id: 'u1', password: 'hashed-old', passwordHistory: [] };
    const usersCollection = createUsersCollection(user);
    const db = { collection: vi.fn().mockReturnValue(usersCollection) };
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    vi.spyOn(passwordService, 'validateStrength').mockImplementation(() => {
      throw new Error('senha fraca');
    });
    const req = createReq({
      app: { locals: { db } },
      user: { userID: '507f1f77bcf86cd799439011' },
      body: { oldPassword: 'correct', newPassword: 'weak' },
    });
    const res = createRes();

    await authController.changePassword(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao trocar senha',
      message: 'senha fraca',
    });
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });
});

describe('AuthController.setupMFAFirstLogin', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ({ body: { username: 'alice', password: 'p' } });
    const res = createRes();

    await authController.setupMFAFirstLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 400 when username or password is missing', async () => {
    const req = createReq({ body: { username: 'alice' } });
    const res = createRes();

    await authController.setupMFAFirstLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Usuário e senha são obrigatórios',
    });
  });

  it('returns 200 with qrCode/secret on success, falling back manualEntryKey to secret', async () => {
    vi.spyOn(authService, 'setupMFAFirstLogin').mockResolvedValue({
      qrCode: 'data:img',
      secret: 'topsecret',
    });
    const req = createReq({ body: { username: 'alice', password: 'p' } });
    const res = createRes();

    await authController.setupMFAFirstLogin(req, res);

    expect(authService.setupMFAFirstLogin).toHaveBeenCalledWith(req.app.locals.db, {
      username: 'alice',
      password: 'p',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        qrCode: 'data:img',
        secret: 'topsecret',
        manualEntryKey: 'topsecret',
      },
    });
  });

  it('uses manualEntryKey when explicitly provided by the service', async () => {
    vi.spyOn(authService, 'setupMFAFirstLogin').mockResolvedValue({
      qrCode: 'data:img',
      secret: 'topsecret',
      manualEntryKey: 'TOP SECRET KEY',
    });
    const req = createReq({ body: { username: 'alice', password: 'p' } });
    const res = createRes();

    await authController.setupMFAFirstLogin(req, res);

    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.data.manualEntryKey).toBe('TOP SECRET KEY');
  });

  it('uses req.t translation for the username/password-required message when req.t is present', async () => {
    const req = createReq({ body: { username: 'alice' }, t: vi.fn(() => 'Usuário/senha obrigatórios (traduzido)') });
    const res = createRes();

    await authController.setupMFAFirstLogin(req, res);

    expect(req.t).toHaveBeenCalledWith('auth.usernameAndPasswordRequired');
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Usuário/senha obrigatórios (traduzido)',
    });
  });

  it('returns 400 when authService.setupMFAFirstLogin throws', async () => {
    vi.spyOn(authService, 'setupMFAFirstLogin').mockRejectedValue(new Error('user not found'));
    const req = createReq({ body: { username: 'alice', password: 'p' } });
    const res = createRes();

    await authController.setupMFAFirstLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao configurar MFA',
      message: 'user not found',
    });
  });
});

describe('AuthController.enableMFAFirstLogin', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ({ body: { username: 'alice', password: 'p', code: '123456' } });
    const res = createRes();

    await authController.enableMFAFirstLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 400 when username or password is missing', async () => {
    const req = createReq({ body: { password: 'p', code: '123456' } });
    const res = createRes();

    await authController.enableMFAFirstLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Usuário e senha são obrigatórios',
    });
  });

  it('returns 400 when code is missing', async () => {
    const req = createReq({ body: { username: 'alice', password: 'p' } });
    const res = createRes();

    await authController.enableMFAFirstLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Código MFA é obrigatório',
    });
  });

  it('sets refresh cookie, sanitizes payload, and returns 200 on success', async () => {
    vi.spyOn(authService, 'enableMFAFirstLogin').mockResolvedValue({
      token: 'jwt-final',
      refreshToken: 'refresh-final',
      sessionID: 'sess-final',
      user: { userID: 'u1' },
    });
    const req = createReq({ body: { username: 'alice', password: 'p', code: '123456' } });
    const res = createRes();

    await authController.enableMFAFirstLogin(req, res);

    expect(authService.enableMFAFirstLogin).toHaveBeenCalledWith(
      req.app.locals.db,
      { username: 'alice', password: 'p' },
      '123456',
      req
    );
    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-final', expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg).toEqual({
      success: true,
      message: 'MFA ativado com sucesso. Primeiro acesso concluído.',
      data: { token: 'jwt-final', user: { userID: 'u1' } },
    });
    expect(jsonArg.data).not.toHaveProperty('refreshToken');
    expect(jsonArg.data).not.toHaveProperty('sessionID');
  });

  it('returns 400 when authService.enableMFAFirstLogin throws', async () => {
    vi.spyOn(authService, 'enableMFAFirstLogin').mockRejectedValue(new Error('bad code'));
    const req = createReq({ body: { username: 'alice', password: 'p', code: '000000' } });
    const res = createRes();

    await authController.enableMFAFirstLogin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao ativar MFA',
      message: 'bad code',
    });
  });
});
