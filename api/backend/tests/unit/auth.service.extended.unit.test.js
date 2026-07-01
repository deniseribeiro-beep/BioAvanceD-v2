import { describe, it, expect, vi, afterEach } from 'vitest';

const authService = require('../../src/services/auth.service');

afterEach(() => { vi.restoreAllMocks(); });

describe('AuthService.registerUser', () => {
  function makeDb(overrides = {}) {
    return {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(null), // no existing user
        insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'new-user-id' } }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
        ...overrides,
      }),
    };
  }

  const VALID_USER = {
    name: 'Test User',
    email: 'test@example.com',
    username: 'testuser',
    password: 'SecurePass123!',
    accessType: 2,
  };

  it('throws when required fields are missing', async () => {
    const db = makeDb();
    await expect(authService.registerUser(db, {})).rejects.toThrow();
  });

  it('throws when user already exists', async () => {
    const db = makeDb({
      findOne: vi.fn().mockResolvedValue({ _id: 'existing', email: 'test@example.com' }),
    });
    await expect(authService.registerUser(db, VALID_USER)).rejects.toThrow('cadastrado');
  });

  it('creates a new user and returns anonId', async () => {
    const db = makeDb();
    const result = await authService.registerUser(db, VALID_USER);
    expect(result).toBeDefined();
    expect(result.anonId).toBeTruthy();
    expect(result.password).toBeUndefined();
  });

  it('maps roleName to accessType when accessType not provided', async () => {
    const db = makeDb();
    const userData = { ...VALID_USER, roleName: 'Coordenador' };
    delete userData.accessType;
    const result = await authService.registerUser(db, userData);
    expect(result).toBeDefined();
  });

  it('sets mfaEnabled false for Administrador by default', async () => {
    const db = makeDb();
    const result = await authService.registerUser(db, { ...VALID_USER, accessType: 4, roleName: 'Administrador' });
    expect(result.mfaEnabled).toBe(false);
  });

  it('adds roleName to user when not provided', async () => {
    const db = makeDb();
    const result = await authService.registerUser(db, { ...VALID_USER, accessType: 3 });
    expect(result.roleName).toBeTruthy();
  });
});

describe('AuthService.login', () => {
  function makeDb(user = null) {
    return {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(user),
        find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'sess-id' } }),
      }),
    };
  }

  it('throws when email is missing', async () => {
    const db = makeDb();
    await expect(authService.login(db, { password: 'abc' }, {})).rejects.toThrow();
  });

  it('throws when password is missing', async () => {
    const db = makeDb();
    await expect(authService.login(db, { email: 'test@test.com' }, {})).rejects.toThrow();
  });

  it('throws Credenciais inválidas when user not found', async () => {
    const db = makeDb(null); // no user found
    await expect(authService.login(db, { email: 'noone@test.com', password: 'pass' }, {})).rejects.toThrow('Credenciais');
  });
});
