import { afterEach, describe, expect, it, vi } from 'vitest';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const authService = require('../../src/services/auth.service');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const { hashToken } = require('../../src/utils/tokenHash');

const ORIGINAL_ENV = { ...process.env };
const USER_ID = '507f1f77bcf86cd799439011';
const STRONG_PASSWORD = 'ValidPassword!123';

function makeUser(overrides = {}) {
  return {
    _id: { toString: () => USER_ID },
    email: 'user@example.test',
    username: 'user1',
    name: 'Synthetic User',
    password: 'a'.repeat(60),
    status: 'active',
    lastLogin: new Date('2026-01-01T00:00:00.000Z'),
    mfaEnabled: false,
    mfaSecretCiphertext: null,
    failedLoginAttempts: 0,
    ...overrides,
  };
}

function makeDb(user = null, securityConfig = null) {
  const users = {
    findOne: vi.fn().mockResolvedValue(user),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  };
  const db = {
    collection: vi.fn((name) => {
      if (name === 'users') return users;
      if (name === 'security_config') {
        return {
          findOne: vi.fn().mockResolvedValue(securityConfig),
        };
      }
      return {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) })),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'x' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      };
    }),
  };
  return { db, users };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe('AuthService additional item 8 residual branches', () => {
  it('covers refresh-token payload with and without a session id and the role mapping defaults', () => {
    const signSpy = vi.spyOn(jwt, 'sign').mockReturnValue('signed-refresh');
    const user = makeUser();

    expect(authService.issueRefreshToken(user)).toBe('signed-refresh');
    expect(signSpy.mock.calls[0][0]).toMatchObject({
      userID: USER_ID,
      type: 'refresh',
    });
    expect(signSpy.mock.calls[0][0].sessionID).toBeUndefined();

    expect(authService.issueRefreshToken(user, 'session-1')).toBe('signed-refresh');
    expect(signSpy.mock.calls[1][0]).toMatchObject({
      userID: USER_ID,
      type: 'refresh',
      sessionID: 'session-1',
    });

    expect(authService.getRoleName(1)).toBe('Usuário Externo');
    expect(authService.getRoleName(2)).toBe('Técnico');
    expect(authService.getRoleName(3)).toBe('Coordenador');
    expect(authService.getRoleName(4)).toBe('Administrador');
    expect(authService.getRoleName(999)).toBe('Técnico');

    expect(authService.getAccessTypeForRole('Usuário Externo')).toBe(1);
    expect(authService.getAccessTypeForRole('Técnico')).toBe(2);
    expect(authService.getAccessTypeForRole('Coordenador')).toBe(3);
    expect(authService.getAccessTypeForRole('Administrador')).toBe(4);
    expect(authService.getAccessTypeForRole('unknown')).toBe(2);
  });

  it('returns the same generic password-reset response for missing and inactive accounts', async () => {
    const missing = makeDb(null);
    await expect(authService.requestPasswordReset(missing.db, 'missing@example.test', {}))
      .resolves.toEqual({
        success: true,
        message: 'Se o email estiver cadastrado, você receberá um link de recuperação',
      });
    expect(missing.users.updateOne).not.toHaveBeenCalled();

    const inactive = makeDb(makeUser({ status: 'inactive' }));
    await expect(authService.requestPasswordReset(inactive.db, 'user@example.test', {}))
      .resolves.toEqual({
        success: true,
        message: 'Se o email estiver cadastrado, você receberá um link de recuperação',
      });
    expect(inactive.users.updateOne).not.toHaveBeenCalled();
  });

  it('issues a development reset link using FRONTEND_URL and persists only the token hash', async () => {
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_URL = 'https://frontend.example.test';

    const user = makeUser();
    const { db, users } = makeDb(user);
    vi.spyOn(jwt, 'sign').mockReturnValue('raw-reset-token');
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const result = await authService.requestPasswordReset(db, '  user@example.test  ', {});

    expect(users.findOne).toHaveBeenCalledWith({
      $or: [
        { email: 'user@example.test' },
        { username: 'user@example.test' },
      ],
    });
    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: user._id },
      {
        $set: expect.objectContaining({
          passwordResetTokenHash: hashToken('raw-reset-token'),
          passwordResetExpires: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      }
    );
    expect(result).toMatchObject({
      success: true,
      resetLink: 'https://frontend.example.test/reset-password?token=raw-reset-token',
      token: 'raw-reset-token',
    });
  });

  it('hides reset token/link outside development and uses the default frontend URL when unset', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.FRONTEND_URL;

    const { db } = makeDb(makeUser());
    vi.spyOn(jwt, 'sign').mockReturnValue('raw-reset-token');
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    const result = await authService.requestPasswordReset(db, 'user@example.test', {});

    expect(result.resetLink).toBeUndefined();
    expect(result.token).toBeUndefined();
  });

  it('covers reset-password required-field and JWT error branches', async () => {
    const { db } = makeDb();

    await expect(authService.resetPassword(db, null, STRONG_PASSWORD, {}))
      .rejects.toThrow('Token de recuperação não fornecido');

    await expect(authService.resetPassword(db, 'token', null, {}))
      .rejects.toThrow('Nova senha é obrigatória');

    vi.spyOn(jwt, 'verify').mockImplementationOnce(() => {
      const error = new Error('expired');
      error.name = 'TokenExpiredError';
      throw error;
    });
    await expect(authService.resetPassword(db, 'token', STRONG_PASSWORD, {}))
      .rejects.toThrow('Token de recuperação expirado');

    jwt.verify.mockImplementationOnce(() => {
      throw new Error('bad signature');
    });
    await expect(authService.resetPassword(db, 'token', STRONG_PASSWORD, {}))
      .rejects.toThrow('Token de recuperação inválido');
  });

  it('covers reset-password decoded-type, missing-user, token-hash and expiry guards', async () => {
    const { db, users } = makeDb(null);
    const verify = vi.spyOn(jwt, 'verify');

    verify.mockReturnValueOnce({ userID: USER_ID, type: 'access' });
    await expect(authService.resetPassword(db, 'token', STRONG_PASSWORD, {}))
      .rejects.toThrow('Token inválido');

    verify.mockReturnValueOnce({ userID: USER_ID, type: 'password-reset' });
    await expect(authService.resetPassword(db, 'token', STRONG_PASSWORD, {}))
      .rejects.toThrow('Usuário não encontrado');

    users.findOne.mockResolvedValueOnce(makeUser({ passwordResetTokenHash: null }));
    verify.mockReturnValueOnce({ userID: USER_ID, type: 'password-reset' });
    await expect(authService.resetPassword(db, 'token', STRONG_PASSWORD, {}))
      .rejects.toThrow('Token inválido ou já utilizado');

    users.findOne.mockResolvedValueOnce(makeUser({ passwordResetTokenHash: 'wrong-hash' }));
    verify.mockReturnValueOnce({ userID: USER_ID, type: 'password-reset' });
    await expect(authService.resetPassword(db, 'token', STRONG_PASSWORD, {}))
      .rejects.toThrow('Token inválido ou já utilizado');

    users.findOne.mockResolvedValueOnce(makeUser({
      passwordResetTokenHash: hashToken('token'),
      passwordResetExpires: null,
    }));
    verify.mockReturnValueOnce({ userID: USER_ID, type: 'password-reset' });
    await expect(authService.resetPassword(db, 'token', STRONG_PASSWORD, {}))
      .rejects.toThrow('Token de recuperação expirado');

    users.findOne.mockResolvedValueOnce(makeUser({
      passwordResetTokenHash: hashToken('token'),
      passwordResetExpires: new Date(Date.now() - 1000),
    }));
    verify.mockReturnValueOnce({ userID: USER_ID, type: 'password-reset' });
    await expect(authService.resetPassword(db, 'token', STRONG_PASSWORD, {}))
      .rejects.toThrow('Token de recuperação expirado');
  });

  it('completes password reset, invalidates all sessions and removes reset state', async () => {
    const user = makeUser({
      passwordResetTokenHash: hashToken('token'),
      passwordResetExpires: new Date(Date.now() + 60_000),
    });
    const { db, users } = makeDb(user);

    vi.spyOn(jwt, 'verify').mockReturnValue({ userID: USER_ID, type: 'password-reset' });
    vi.spyOn(bcrypt, 'hash').mockResolvedValue('new-hash');
    const invalidate = vi.spyOn(sessionService, 'invalidateUserSessions').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);

    await expect(authService.resetPassword(db, 'token', STRONG_PASSWORD, {}))
      .resolves.toEqual({ success: true, message: 'Senha redefinida com sucesso' });

    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: user._id },
      {
        $set: {
          password: 'new-hash',
          updatedAt: expect.any(Date),
        },
        $unset: {
          passwordResetTokenHash: '',
          passwordResetExpires: '',
        },
      }
    );
    expect(invalidate).toHaveBeenCalledWith(db, USER_ID, 'password_change', 'system');
  });

  it('covers setupMFAFirstLogin credential-type, enrolled-user and lockout guards', async () => {
    await expect(authService.setupMFAFirstLogin({}, {}))
      .rejects.toThrow('Username e senha são obrigatórios');
    await expect(authService.setupMFAFirstLogin({}, { username: { $ne: null }, password: 'pw' }))
      .rejects.toThrow('Username e senha são obrigatórios');

    vi.spyOn(bcrypt, 'hash').mockResolvedValue('dummy-hash');
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    const enrolled = makeDb(makeUser({
      mfaEnabled: true,
      mfaSecretCiphertext: 'ciphertext',
      lastLogin: new Date(),
    }));
    await expect(authService.setupMFAFirstLogin(enrolled.db, { username: 'user1', password: 'pw' }))
      .rejects.toThrow('Credenciais inválidas');
    expect(compare).toHaveBeenCalled();

    compare.mockClear();
    const locked = makeDb(makeUser({
      lastLogin: null,
      accountLockedUntil: new Date(Date.now() + 60_000),
    }));
    await expect(authService.setupMFAFirstLogin(locked.db, { username: 'user1', password: 'pw' }))
      .rejects.toThrow('Credenciais inválidas');
    expect(compare).not.toHaveBeenCalled();
  });

  it('counts a bad setup-MFA password and covers malformed-secret / QR failures after a valid password', async () => {
    const { db, users } = makeDb(makeUser({ lastLogin: null }), {
      authentication: { maxLoginAttempts: 5, lockoutDurationMinutes: 30 },
    });
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    await expect(authService.setupMFAFirstLogin(db, { username: 'user1', password: 'bad' }))
      .rejects.toThrow('Credenciais inválidas');
    expect(users.updateOne).toHaveBeenCalled();

    compare.mockResolvedValue(true);
    const secretSpy = vi.spyOn(speakeasy, 'generateSecret').mockReturnValue(null);
    await expect(authService.setupMFAFirstLogin(db, { username: 'user1', password: 'good' }))
      .rejects.toThrow('Erro ao gerar secret do MFA');

    secretSpy.mockReturnValue({ base32: 'BASE32', otpauth_url: 'otpauth://synthetic' });
    vi.spyOn(QRCode, 'toDataURL').mockRejectedValueOnce(new Error('qr failed'));
    await expect(authService.setupMFAFirstLogin(db, { username: 'user1', password: 'good' }))
      .rejects.toThrow('Erro ao gerar QR Code. Tente novamente.');

    QRCode.toDataURL.mockResolvedValueOnce(null);
    await expect(authService.setupMFAFirstLogin(db, { username: 'user1', password: 'good' }))
      .rejects.toThrow('QR Code não foi gerado corretamente');
  });

  it('covers enableMFAFirstLogin MFA-code and enrollment-state guards without issuing a session', async () => {
    await expect(authService.enableMFAFirstLogin({}, { username: 'user1', password: 'pw' }, null, {}))
      .rejects.toThrow('Código MFA é obrigatório');

    const { db } = makeDb(makeUser({
      lastLogin: null,
      mfaSecretCiphertext: null,
    }));
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    await expect(authService.enableMFAFirstLogin(
      db,
      { username: 'user1', password: 'pw' },
      '123456',
      {}
    )).rejects.toThrow('MFA não configurado. Gere o QR code primeiro.');
  });

  it('covers authenticated setupMFA missing-user and enableMFA missing/invalid secret branches', async () => {
    const missing = makeDb(null);
    await expect(authService.setupMFA(missing.db, USER_ID))
      .rejects.toThrow('Usuário não encontrado');

    await expect(authService.enableMFA(missing.db, USER_ID, '123456'))
      .rejects.toThrow('MFA não configurado');

    const encrypted = makeDb(makeUser({
      mfaSecretCiphertext: 'not-a-valid-envelope',
      lastLogin: new Date(),
    }));
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);

    await expect(authService.enableMFA(encrypted.db, USER_ID, '123456'))
      .rejects.toThrow('Código MFA inválido');
  });

  it('covers enableMFA success for returning users without issuing new session tokens', async () => {
    const { db, users } = makeDb(makeUser({
      mfaSecretCiphertext: 'not-a-valid-envelope',
      lastLogin: new Date('2026-01-01T00:00:00.000Z'),
    }));
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(true);
    const sessionSpy = vi.spyOn(authService, 'issueSessionTokens').mockResolvedValue({
      token: 'unused',
      refreshToken: 'unused',
      sessionID: 'unused',
    });

    await expect(authService.enableMFA(db, USER_ID, '123456'))
      .resolves.toEqual({ success: true });

    expect(users.updateOne).toHaveBeenCalled();
    expect(sessionSpy).not.toHaveBeenCalled();
  });
});
