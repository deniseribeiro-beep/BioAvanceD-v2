import { describe, it, expect, vi, afterEach } from 'vitest';

const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const authService = require('../../src/services/auth.service');

const HASHED = 'a'.repeat(60);
const BASE_USER = {
  _id: { toString: () => 'user-1' },
  email: 'user@test.com',
  username: 'user1',
  name: 'Synthetic User',
  password: HASHED,
  status: 'active',
  lastLogin: new Date('2026-01-01T00:00:00.000Z'),
  mfaEnabled: false,
  mfaSecretCiphertext: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function usersDb(findOne) {
  const users = {
    findOne,
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'session-1' }),
  };
  return {
    users,
    db: {
      collection: vi.fn((name) => {
        if (name === 'users') return users;
        if (name === 'security_config') {
          return { findOne: vi.fn().mockResolvedValue({ _id: 'main' }) };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'x' }),
        };
      }),
    },
  };
}

describe('AuthService item 8 residual branch coverage', () => {
  it('enters registerUser and rejects an invalid payload before any database write', async () => {
    const db = { collection: vi.fn() };

    await expect(authService.registerUser(db, {})).rejects.toThrow();

    expect(db.collection).not.toHaveBeenCalled();
  });

  it('login trims the identifier and delegates an exact match to processLogin', async () => {
    const findOne = vi.fn().mockResolvedValue(BASE_USER);
    const { db, users } = usersDb(findOne);
    const delegated = { token: 'token-1' };
    const processSpy = vi.spyOn(authService, 'processLogin').mockResolvedValue(delegated);

    const result = await authService.login(
      db,
      { email: '  user@test.com  ', password: 'pw' },
      { language: 'pt-BR' }
    );

    expect(result).toBe(delegated);
    expect(users.findOne).toHaveBeenCalledTimes(1);
    expect(users.findOne).toHaveBeenCalledWith({
      $or: [{ email: 'user@test.com' }, { username: 'user@test.com' }],
    });
    expect(processSpy).toHaveBeenCalledWith(
      db,
      BASE_USER,
      'pw',
      undefined,
      users,
      { language: 'pt-BR' },
      undefined
    );
  });

  it('login uses the escaped case-insensitive fallback only after the exact lookup misses', async () => {
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(BASE_USER);
    const { db, users } = usersDb(findOne);
    vi.spyOn(authService, 'processLogin').mockResolvedValue({ token: 'token-2' });

    const result = await authService.login(
      db,
      { email: 'User.Test+qa@example.com', password: 'pw' },
      {}
    );

    expect(result.token).toBe('token-2');
    expect(users.findOne).toHaveBeenCalledTimes(2);
    expect(users.findOne.mock.calls[1][0]).toEqual({
      $or: [
        { email: { $regex: '^User\\.Test\\+qa@example\\.com$', $options: 'i' } },
        { username: { $regex: '^User\\.Test\\+qa@example\\.com$', $options: 'i' } },
      ],
    });
  });

  it('login equalizes an unknown identifier before returning the generic credentials error', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const { db } = usersDb(findOne);
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    await expect(
      authService.login(db, { email: 'missing@example.com', password: 'pw' }, {})
    ).rejects.toThrow('Credenciais inválidas');

    expect(findOne).toHaveBeenCalledTimes(2);
    expect(compare).toHaveBeenCalled();
  });

  it('processLogin rejects a missing user through the same generic equalized path', async () => {
    const { db, users } = usersDb(vi.fn().mockResolvedValue(null));
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    await expect(
      authService.processLogin(db, null, 'pw', null, users, {})
    ).rejects.toThrow('Credenciais inválidas');

    expect(compare).toHaveBeenCalled();
  });

  it('processLogin refuses a still-locked account before consulting the stored password hash', async () => {
    const { db, users } = usersDb(vi.fn().mockResolvedValue(BASE_USER));
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    const user = {
      ...BASE_USER,
      accountLockedUntil: new Date(Date.now() + 60_000),
    };

    await expect(
      authService.processLogin(db, user, 'pw', null, users, {})
    ).rejects.toThrow('Credenciais inválidas');

    expect(compare).not.toHaveBeenCalled();
  });

  it('requestPasswordReset rejects a non-string identifier through its own guarded catch path', async () => {
    const { db, users } = usersDb(vi.fn().mockResolvedValue(null));

    await expect(
      authService.requestPasswordReset(db, { $ne: null }, {})
    ).rejects.toThrow('Email é obrigatório');

    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('recordFailedPasswordAttempt stays fail-open when the security policy lookup fails', async () => {
    const users = {
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'security_config') {
          return { findOne: vi.fn().mockRejectedValue(new Error('policy unavailable')) };
        }
        return users;
      }),
    };

    await expect(
      authService.recordFailedPasswordAttempt(db, users, {
        _id: 'user-1',
        failedLoginAttempts: 0,
      })
    ).resolves.toBeUndefined();

    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: 'user-1' },
      expect.objectContaining({ $inc: { failedLoginAttempts: 1 } })
    );
  });

  it('login rejects missing identifiers and missing passwords before touching the database', async () => {
    const db = { collection: vi.fn() };

    await expect(authService.login(db, { email: '', password: 'pw' }, {})).rejects.toThrow();
    await expect(authService.login(db, { email: 'user@test.com', password: '' }, {})).rejects.toThrow();

    expect(db.collection).not.toHaveBeenCalled();
  });

  it('processLogin rejects malformed stored password material and bcrypt failures generically', async () => {
    const { db, users } = usersDb(vi.fn());

    await expect(
      authService.processLogin(db, { ...BASE_USER, password: '' }, 'pw', null, users, {})
    ).rejects.toThrow('Credenciais inválidas');

    vi.spyOn(bcrypt, 'compare').mockRejectedValueOnce(new Error('bcrypt unavailable'));
    await expect(
      authService.processLogin(db, BASE_USER, 'pw', null, users, {})
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('setupMFAFirstLogin validates credential shape before database access', async () => {
    const db = { collection: vi.fn() };

    await expect(authService.setupMFAFirstLogin(db, { username: '', password: 'pw' }))
      .rejects.toThrow('Username e senha são obrigatórios');
    await expect(authService.setupMFAFirstLogin(db, { username: { $ne: null }, password: 'pw' }))
      .rejects.toThrow('Username e senha são obrigatórios');

    expect(db.collection).not.toHaveBeenCalled();
  });

  it('setupMFAFirstLogin equalizes unknown and already-enrolled accounts', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    let fixture = usersDb(vi.fn().mockResolvedValue(null));
    await expect(
      authService.setupMFAFirstLogin(fixture.db, { username: 'missing', password: 'pw' })
    ).rejects.toThrow('Credenciais inválidas');

    fixture = usersDb(vi.fn().mockResolvedValue({
      ...BASE_USER,
      lastLogin: new Date(),
      mfaEnabled: true,
      mfaSecretCiphertext: 'ciphertext',
    }));
    await expect(
      authService.setupMFAFirstLogin(fixture.db, { username: 'user1', password: 'pw' })
    ).rejects.toThrow('Credenciais inválidas');
  });

  it('setupMFAFirstLogin enforces account lockout and counts a wrong password', async () => {
    let fixture = usersDb(vi.fn().mockResolvedValue({
      ...BASE_USER,
      accountLockedUntil: new Date(Date.now() + 60_000),
    }));
    const compare = vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    await expect(
      authService.setupMFAFirstLogin(fixture.db, { username: 'user1', password: 'pw' })
    ).rejects.toThrow('Credenciais inválidas');
    expect(compare).not.toHaveBeenCalled();

    fixture = usersDb(vi.fn().mockResolvedValue(BASE_USER));
    await expect(
      authService.setupMFAFirstLogin(fixture.db, { username: 'user1', password: 'wrong' })
    ).rejects.toThrow('Credenciais inválidas');
    expect(fixture.users.updateOne).toHaveBeenCalled();
  });

  it('setupMFAFirstLogin rejects unusable generated secrets and QR generation failures', async () => {
    const fixture = usersDb(vi.fn().mockResolvedValue(BASE_USER));
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    vi.spyOn(speakeasy, 'generateSecret').mockReturnValueOnce({});
    await expect(
      authService.setupMFAFirstLogin(fixture.db, { username: 'user1', password: 'pw' })
    ).rejects.toThrow('Erro ao gerar secret do MFA');

    vi.spyOn(speakeasy, 'generateSecret').mockReturnValueOnce({
      base32: 'JBSWY3DPEHPK3PXP',
      otpauth_url: 'otpauth://totp/BioAvanceD',
    });
    vi.spyOn(QRCode, 'toDataURL').mockRejectedValueOnce(new Error('qr unavailable'));
    await expect(
      authService.setupMFAFirstLogin(fixture.db, { username: 'user1', password: 'pw' })
    ).rejects.toThrow('Erro ao gerar QR Code');
  });

  it('enableMFAFirstLogin validates credentials and MFA code before database lookup', async () => {
    const db = { collection: vi.fn() };

    await expect(authService.enableMFAFirstLogin(db, { username: '', password: 'pw' }, '123456', {}))
      .rejects.toThrow('Username e senha são obrigatórios');
    await expect(authService.enableMFAFirstLogin(db, { username: { $gt: '' }, password: 'pw' }, '123456', {}))
      .rejects.toThrow('Username e senha são obrigatórios');
    await expect(authService.enableMFAFirstLogin(db, { username: 'user1', password: 'pw' }, '', {}))
      .rejects.toThrow('Código MFA é obrigatório');

    expect(db.collection).not.toHaveBeenCalled();
  });

  it('enableMFAFirstLogin rejects unknown, enrolled, locked and wrong-password callers generically', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    let fixture = usersDb(vi.fn().mockResolvedValue(null));
    await expect(
      authService.enableMFAFirstLogin(fixture.db, { username: 'missing', password: 'pw' }, '123456', {})
    ).rejects.toThrow('Credenciais inválidas');

    fixture = usersDb(vi.fn().mockResolvedValue({
      ...BASE_USER,
      lastLogin: new Date(),
      mfaEnabled: true,
      mfaSecretCiphertext: 'ciphertext',
    }));
    await expect(
      authService.enableMFAFirstLogin(fixture.db, { username: 'user1', password: 'pw' }, '123456', {})
    ).rejects.toThrow('Credenciais inválidas');

    fixture = usersDb(vi.fn().mockResolvedValue({
      ...BASE_USER,
      accountLockedUntil: new Date(Date.now() + 60_000),
    }));
    await expect(
      authService.enableMFAFirstLogin(fixture.db, { username: 'user1', password: 'pw' }, '123456', {})
    ).rejects.toThrow('Credenciais inválidas');

    fixture = usersDb(vi.fn().mockResolvedValue(BASE_USER));
    await expect(
      authService.enableMFAFirstLogin(fixture.db, { username: 'user1', password: 'wrong' }, '123456', {})
    ).rejects.toThrow('Credenciais inválidas');
    expect(fixture.users.updateOne).toHaveBeenCalled();
  });

  it('enableMFAFirstLogin requires an enrollment secret and rejects an invalid TOTP', async () => {
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);

    let fixture = usersDb(vi.fn().mockResolvedValue(BASE_USER));
    await expect(
      authService.enableMFAFirstLogin(fixture.db, { username: 'user1', password: 'pw' }, '123456', {})
    ).rejects.toThrow('MFA não configurado');

    fixture = usersDb(vi.fn().mockResolvedValue({
      ...BASE_USER,
      mfaSecretCiphertext: 'ciphertext',
    }));
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    await expect(
      authService.enableMFAFirstLogin(fixture.db, { username: 'user1', password: 'pw' }, '123456', {})
    ).rejects.toThrow('Código MFA inválido');
  });

  it('setupMFA and enableMFA expose their not-found/not-configured guards', async () => {
    const { ObjectId } = require('mongodb');
    const id = new ObjectId().toString();

    let fixture = usersDb(vi.fn().mockResolvedValue(null));
    await expect(authService.setupMFA(fixture.db, id)).rejects.toThrow('Usuário não encontrado');
    await expect(authService.enableMFA(fixture.db, id, '123456')).rejects.toThrow('MFA não configurado');

    fixture = usersDb(vi.fn().mockResolvedValue({ ...BASE_USER, _id: new ObjectId(), mfaSecretCiphertext: 'ciphertext' }));
    vi.spyOn(speakeasy.totp, 'verify').mockReturnValue(false);
    await expect(authService.enableMFA(fixture.db, id, '123456')).rejects.toThrow('Código MFA inválido');
  });

  it('requestPasswordReset preserves non-enumerating success for missing and inactive users', async () => {
    let fixture = usersDb(vi.fn().mockResolvedValue(null));
    await expect(authService.requestPasswordReset(fixture.db, 'missing@test.com', {}))
      .resolves.toMatchObject({ success: true });

    fixture = usersDb(vi.fn().mockResolvedValue({ ...BASE_USER, status: 'inactive' }));
    await expect(authService.requestPasswordReset(fixture.db, 'inactive@test.com', {}))
      .resolves.toMatchObject({ success: true });
  });

  it('resetPassword rejects absent token and absent replacement password before JWT work', async () => {
    const { db } = usersDb(vi.fn());

    await expect(authService.resetPassword(db, '', 'Strong#Password123', {}))
      .rejects.toThrow('Token de recuperação não fornecido');
    await expect(authService.resetPassword(db, 'token', '', {}))
      .rejects.toThrow('Nova senha é obrigatória');
  });

});


describe('AuthService item 8 password-reset development branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the development reset token/link using the configured frontend base URL', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalFrontendUrl = process.env.FRONTEND_URL;
    try {
      process.env.NODE_ENV = 'development';
      process.env.FRONTEND_URL = 'https://frontend.example.test';

      const { db, users } = usersDb(vi.fn().mockResolvedValue(BASE_USER));
      const result = await authService.requestPasswordReset(
        db,
        'user@test.com',
        { language: 'pt-BR' }
      );

      expect(result.success).toBe(true);
      expect(result.token).toEqual(expect.any(String));
      expect(result.resetLink).toBe(
        `https://frontend.example.test/reset-password?token=${result.token}`
      );
      expect(users.updateOne).toHaveBeenCalledWith(
        { _id: BASE_USER._id },
        expect.objectContaining({
          $set: expect.objectContaining({
            passwordResetTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
            passwordResetExpires: expect.any(Date),
          }),
        })
      );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = originalFrontendUrl;
    }
  });

  it('uses the localhost frontend fallback for development when FRONTEND_URL is absent', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalFrontendUrl = process.env.FRONTEND_URL;
    try {
      process.env.NODE_ENV = 'development';
      delete process.env.FRONTEND_URL;

      const { db } = usersDb(vi.fn().mockResolvedValue(BASE_USER));
      const result = await authService.requestPasswordReset(db, 'user@test.com', {});

      expect(result.token).toEqual(expect.any(String));
      expect(result.resetLink).toBe(
        `http://localhost:5173/reset-password?token=${result.token}`
      );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = originalFrontendUrl;
    }
  });
});
