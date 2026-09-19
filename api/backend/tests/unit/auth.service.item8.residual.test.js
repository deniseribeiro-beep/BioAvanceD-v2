import { describe, it, expect, vi, afterEach } from 'vitest';

const bcrypt = require('bcryptjs');
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
});
