import { afterEach, describe, expect, it, vi } from 'vitest';

const authController = require('../../../src/controllers/auth.controller');
const authService = require('../../../src/services/auth.service');
const auditLogger = require('../../../src/utils/auditLogger');
const logger = require('../../../src/utils/logger');

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

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
    body: {},
    params: {},
    query: {},
    headers: {},
    user: { userID: 'operator-1' },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('AuthController item 8 residual branches', () => {
  it('uses the public id fallback for the register audit resource and translated success message', async () => {
    vi.spyOn(authService, 'registerUser').mockResolvedValue({
      userAccountId: '550e8400-e29b-41d4-a716-446655440001',
      username: 'alice',
    });
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({
      body: { username: 'alice', password: 'StrongPass1!' },
      t: vi.fn((key) => key === 'users.registerSuccess' ? 'Registro traduzido' : key),
    });
    const res = createRes();

    await authController.register(req, res);

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: '550e8400-e29b-41d4-a716-446655440001',
      action: 'CREATE',
      resourceType: 'User',
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: 'Registro traduzido',
    }));
  });

  it('uses secure strict refresh-cookie options in production and logs asynchronous audit failures without failing login', async () => {
    process.env.NODE_ENV = 'production';
    vi.useFakeTimers();
    vi.spyOn(authService, 'login').mockResolvedValue({
      token: 'access-1',
      refreshToken: 'refresh-1',
      sessionID: 'session-1',
      user: { userID: 'u1' },
    });
    vi.spyOn(auditLogger, 'logLogin').mockRejectedValue(new Error('audit unavailable'));
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createReq({ body: { email: 'alice@example.test', password: 'secret' } });
    const res = createRes();

    await authController.login(req, res);
    await vi.runAllTimersAsync();

    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-1',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/api/auth',
      })
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      'Erro ao registrar auditoria de login:',
      'audit unavailable'
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.data).not.toHaveProperty('refreshToken');
    expect(payload.data).not.toHaveProperty('sessionID');
  });

  it('logs asynchronous failed-login audit failures while preserving the generic 401 response', async () => {
    vi.useFakeTimers();
    const loginError = new Error('bad credentials');
    vi.spyOn(authService, 'login').mockRejectedValue(loginError);
    vi.spyOn(auditLogger, 'logLogin').mockRejectedValue(new Error('audit unavailable'));
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const req = createReq({ body: { email: 'alice@example.test', password: 'wrong' } });
    const res = createRes();

    await authController.login(req, res);
    await vi.runAllTimersAsync();

    expect(res.status).toHaveBeenCalledWith(401);
    expect(loggerSpy).toHaveBeenCalledWith(
      'Erro ao registrar auditoria de login:',
      'audit unavailable'
    );
  });

  it('uses translations on the three successful login continuation branches', async () => {
    const t = vi.fn((key) => ({
      'auth.mfaSetupRequired': 'Configuração traduzida',
      'auth.mfaRequired': 'MFA traduzido',
      'auth.passwordChangeRequired': 'Senha traduzida',
    }[key] || key));

    vi.spyOn(authService, 'login')
      .mockResolvedValueOnce({
        requiresMFASetup: true,
        tempToken: 'tmp-1',
        user: { userID: 'u1' },
      })
      .mockResolvedValueOnce({ requiresMFA: true })
      .mockResolvedValueOnce({ requiresPasswordChange: true, message: 'service fallback' });

    const setupRes = createRes();
    await authController.login(createReq({ t }), setupRes);
    expect(setupRes.json).toHaveBeenCalledWith(expect.objectContaining({
      requiresMFASetup: true,
      message: 'Configuração traduzida',
    }));

    const mfaRes = createRes();
    await authController.login(createReq({ t }), mfaRes);
    expect(mfaRes.json).toHaveBeenCalledWith(expect.objectContaining({
      requiresMFA: true,
      message: 'MFA traduzido',
    }));

    const passwordRes = createRes();
    await authController.login(createReq({ t }), passwordRes);
    expect(passwordRes.json).toHaveBeenCalledWith(expect.objectContaining({
      requiresPasswordChange: true,
      message: 'Senha traduzida',
    }));
  });

  it('uses translated setup-MFA error responses on a service failure', async () => {
    vi.spyOn(authService, 'setupMFA').mockRejectedValue(new Error('setup failed'));
    const req = createReq({
      t: vi.fn((key) => key === 'mfa.setupError' ? 'Falha MFA traduzida' : key),
    });
    const res = createRes();

    await authController.setupMFA(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Falha MFA traduzida',
      message: 'setup failed',
    });
  });

  it('covers translated password-reset validation and service-error responses', async () => {
    const t = vi.fn((key) => ({
      'errors.invalidEmail': 'Email obrigatório traduzido',
      'auth.passwordResetError': 'Recuperação traduzida',
      'auth.resetTokenRequired': 'Token traduzido',
      'auth.resetPasswordError': 'Reset traduzido',
    }[key] || key));

    const missingEmail = createRes();
    await authController.requestPasswordReset(createReq({ body: {}, t }), missingEmail);
    expect(missingEmail.json).toHaveBeenCalledWith({
      success: false,
      error: 'Email obrigatório traduzido',
    });

    vi.spyOn(authService, 'requestPasswordReset').mockRejectedValueOnce(new Error('mailer down'));
    const requestFailure = createRes();
    await authController.requestPasswordReset(
      createReq({ body: { email: 'alice@example.test' }, t }),
      requestFailure
    );
    expect(requestFailure.json).toHaveBeenCalledWith({
      success: false,
      error: 'Recuperação traduzida',
      message: 'mailer down',
    });

    const missingToken = createRes();
    await authController.resetPassword(
      createReq({ body: { newPassword: 'StrongPass1!' }, t }),
      missingToken
    );
    expect(missingToken.json).toHaveBeenCalledWith({
      success: false,
      error: 'Token traduzido',
    });

    vi.spyOn(authService, 'resetPassword').mockRejectedValueOnce(new Error('expired'));
    const resetFailure = createRes();
    await authController.resetPassword(
      createReq({ body: { token: 'reset-1', newPassword: 'StrongPass1!' }, t }),
      resetFailure
    );
    expect(resetFailure.json).toHaveBeenCalledWith({
      success: false,
      error: 'Reset traduzido',
      message: 'expired',
    });
  });

  it('uses translated first-login MFA setup and enable failure branches', async () => {
    const t = vi.fn((key) => ({
      'mfa.setupError': 'Setup inicial traduzido',
      'mfa.codeRequired': 'Código inicial traduzido',
      'mfa.enableError': 'Ativação inicial traduzida',
    }[key] || key));

    vi.spyOn(authService, 'setupMFAFirstLogin').mockRejectedValueOnce(new Error('setup denied'));
    const setupFailure = createRes();
    await authController.setupMFAFirstLogin(
      createReq({ body: { username: 'alice', password: 'secret' }, t }),
      setupFailure
    );
    expect(setupFailure.json).toHaveBeenCalledWith({
      success: false,
      error: 'Setup inicial traduzido',
      message: 'setup denied',
    });

    const missingCode = createRes();
    await authController.enableMFAFirstLogin(
      createReq({ body: { username: 'alice', password: 'secret' }, t }),
      missingCode
    );
    expect(missingCode.json).toHaveBeenCalledWith({
      success: false,
      error: 'Código inicial traduzido',
    });

    vi.spyOn(authService, 'enableMFAFirstLogin').mockRejectedValueOnce(new Error('invalid otp'));
    const enableFailure = createRes();
    await authController.enableMFAFirstLogin(
      createReq({ body: { username: 'alice', password: 'secret', code: '000000' }, t }),
      enableFailure
    );
    expect(enableFailure.json).toHaveBeenCalledWith({
      success: false,
      error: 'Ativação inicial traduzida',
      message: 'invalid otp',
    });
  });

  it('sets the production refresh cookie and strips refresh/session fields on first-login MFA completion', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(authService, 'enableMFAFirstLogin').mockResolvedValue({
      token: 'access-1',
      refreshToken: 'refresh-1',
      sessionID: 'session-1',
      user: { userID: 'u1' },
    });
    const req = createReq({
      body: { username: 'alice', password: 'secret', code: '123456' },
      t: vi.fn((key) => key === 'mfa.enableFirstLoginSuccess' ? 'Ativado' : key),
    });
    const res = createRes();

    await authController.enableMFAFirstLogin(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-1',
      expect.objectContaining({ secure: true, sameSite: 'strict' })
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Ativado',
      data: {
        token: 'access-1',
        user: { userID: 'u1' },
      },
    });
  });

  it('uses the default password-reset error string when req.t is absent on service failure', async () => {
    vi.spyOn(authService, 'requestPasswordReset').mockRejectedValue(new Error('smtp down'));
    const req = createReq({ body: { email: 'alice@example.test' } });
    const res = createRes();

    await authController.requestPasswordReset(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao solicitar recuperação de senha',
      message: 'smtp down',
    });
  });

  it('rejects enableMFAFirstLogin when only username or only password is supplied', async () => {
    const usernameOnly = createRes();
    await authController.enableMFAFirstLogin(
      createReq({ body: { username: 'alice', code: '123456' } }),
      usernameOnly
    );
    expect(usernameOnly.json).toHaveBeenCalledWith({
      success: false,
      error: 'Usuário e senha são obrigatórios',
    });

    const passwordOnly = createRes();
    await authController.enableMFAFirstLogin(
      createReq({ body: { password: 'secret', code: '123456' } }),
      passwordOnly
    );
    expect(passwordOnly.json).toHaveBeenCalledWith({
      success: false,
      error: 'Usuário e senha são obrigatórios',
    });
  });

  it('covers missing MFA code with and without req.t on enableMFAFirstLogin', async () => {
    const withT = createRes();
    await authController.enableMFAFirstLogin(
      createReq({
        body: { username: 'alice', password: 'secret' },
        t: vi.fn((key) => (key === 'mfa.codeRequired' ? 'Código traduzido' : key)),
      }),
      withT
    );
    expect(withT.json).toHaveBeenCalledWith({
      success: false,
      error: 'Código traduzido',
    });

    const withoutT = createRes();
    await authController.enableMFAFirstLogin(
      createReq({ body: { username: 'alice', password: 'secret' } }),
      withoutT
    );
    expect(withoutT.json).toHaveBeenCalledWith({
      success: false,
      error: 'Código MFA é obrigatório',
    });
  });
});
