import { describe, expect, it } from 'vitest';

const UserModel = require('../../src/models/User');

function validUser(overrides = {}) {
  return {
    name: 'Synthetic User',
    email: 'synthetic@example.com',
    username: 'synthetic',
    password: 'GoodPass1!',
    ...overrides,
  };
}

describe('UserModel item 8 branch coverage', () => {
  it('reports every required-field and weak-password validation error', () => {
    const result = UserModel.validate({
      name: null,
      email: 'invalid',
      username: 42,
      password: 'weak',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'name é obrigatório e deve ser string',
      'email é obrigatório e deve ser um email válido',
      'username é obrigatório e deve ser string',
      expect.stringContaining('password: Senha deve ter pelo menos 8 caracteres'),
    ]));
  });

  it('requires password only for a new user and accepts an existing user without it', () => {
    const created = UserModel.validate({
      name: 'Existing',
      email: 'existing@example.com',
      username: 'existing',
    });
    expect(created.errors).toContain('password é obrigatório');

    const existing = UserModel.validate({
      _id: 'mongo-id',
      name: 'Existing',
      email: 'existing@example.com',
      username: 'existing',
    });
    expect(existing.isValid).toBe(true);
  });

  it('normalizes blank optional phone and organizationId while preserving nonblank values', () => {
    const blank = validUser({ phone: '   ', organizationId: '   ' });
    expect(UserModel.validate(blank).isValid).toBe(true);
    expect(blank.phone).toBeNull();
    expect(blank.organizationId).toBeNull();

    const populated = validUser({ phone: ' +5511999999999 ', organizationId: 'org-1' });
    expect(UserModel.validate(populated).isValid).toBe(true);
    expect(populated.phone).toBe(' +5511999999999 ');
    expect(populated.organizationId).toBe('org-1');

    const nonStrings = validUser({ phone: 123, organizationId: 456 });
    expect(UserModel.validate(nonStrings).isValid).toBe(true);
    expect(nonStrings.phone).toBe(123);
    expect(nonStrings.organizationId).toBe(456);
  });

  it('validates password history, password dates, reset flag and failed-login counter types', () => {
    const invalid = UserModel.validate(validUser({
      passwordHistory: 'not-array',
      lastPasswordChange: 'not-a-date',
      forceReset: 'yes',
      failedLoginAttempts: '3',
    }));
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'passwordHistory deve ser um array',
      'lastPasswordChange deve ser uma data válida',
      'forceReset deve ser booleano',
      'failedLoginAttempts deve ser número',
    ]));

    const valid = UserModel.validate(validUser({
      passwordHistory: ['hash-1'],
      lastPasswordChange: '2026-09-18T12:00:00.000Z',
      forceReset: true,
      failedLoginAttempts: 3,
    }));
    expect(valid.isValid).toBe(true);
  });

  it('validates temporary lockout timestamp only when it is non-null', () => {
    expect(UserModel.validate(validUser({ accountLockedUntil: 'bad-date' })).errors)
      .toContain('accountLockedUntil deve ser uma data válida');

    expect(UserModel.validate(validUser({ accountLockedUntil: null })).isValid).toBe(true);
    expect(UserModel.validate(validUser({ accountLockedUntil: undefined })).isValid).toBe(true);
    expect(UserModel.validate(validUser({ accountLockedUntil: '2026-09-18T12:00:00Z' })).isValid).toBe(true);
  });

  it('accepts every documented account status and rejects unknown statuses', () => {
    for (const status of [
      'active', 'inactive', 'blocked', 'suspended',
      'Ativo', 'Inativo', 'Bloqueado', 'Suspenso',
    ]) {
      expect(UserModel.validate(validUser({ status })).isValid, status).toBe(true);
    }

    const invalid = UserModel.validate(validUser({ status: 'unknown' }));
    expect(invalid.errors).toContain(
      'status deve ser: active/Ativo, inactive/Inativo, blocked/Bloqueado ou suspended/Suspenso'
    );

    expect(UserModel.validate(validUser({ status: '' })).isValid).toBe(true);
  });

  it('validates role validity timestamps independently and their chronological order', () => {
    let result = UserModel.validate(validUser({ roleValidFrom: 'bad' }));
    expect(result.errors).toContain('roleValidFrom deve ser uma data válida');

    result = UserModel.validate(validUser({ roleValidUntil: 'bad' }));
    expect(result.errors).toContain('roleValidUntil deve ser uma data válida');

    result = UserModel.validate(validUser({
      roleValidFrom: '2026-09-20T00:00:00Z',
      roleValidUntil: '2026-09-19T00:00:00Z',
    }));
    expect(result.errors).toContain('roleValidUntil deve ser posterior a roleValidFrom');

    expect(UserModel.validate(validUser({
      roleValidFrom: '2026-09-18T00:00:00Z',
      roleValidUntil: '2026-09-19T00:00:00Z',
    })).isValid).toBe(true);

    expect(UserModel.validate(validUser({
      roleValidFrom: null,
      roleValidUntil: null,
    })).isValid).toBe(true);
  });

  it('validates organizationIds shape and element types', () => {
    expect(UserModel.validate(validUser({ organizationIds: 'org-1' })).errors)
      .toContain('organizationIds deve ser um array de strings');

    expect(UserModel.validate(validUser({ organizationIds: ['org-1', 2] })).errors)
      .toContain('organizationIds deve ser um array de strings');

    expect(UserModel.validate(validUser({ organizationIds: ['org-1', 'org-2'] })).isValid).toBe(true);
    expect(UserModel.validate(validUser({ organizationIds: null })).isValid).toBe(true);
    expect(UserModel.validate(validUser({ organizationIds: undefined })).isValid).toBe(true);
  });

  it('creates a user with canonical defaults', () => {
    const before = Date.now();
    const user = UserModel.create({
      name: 'Default User',
      email: 'default@example.com',
      username: 'default',
      password: 'hash',
    });
    const after = Date.now();

    expect(user).toMatchObject({
      name: 'Default User',
      email: 'default@example.com',
      phone: null,
      organizationId: null,
      username: 'default',
      password: 'hash',
      status: 'active',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      mfaActivationDate: null,
      mfaFailedAttempts: 0,
      mfaLocked: false,
      anonId: null,
      lastLogin: null,
      passwordHistory: [],
      forceReset: false,
      failedLoginAttempts: 0,
      accountLockedUntil: null,
      roleValidFrom: null,
      roleValidUntil: null,
      organizationIds: [],
    });
    expect(user.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(user.createdAt.getTime()).toBeLessThanOrEqual(after);
    expect(user.updatedAt).toBeInstanceOf(Date);
    expect(user.lastPasswordChange).toBeInstanceOf(Date);
  });

  it('creates a user with all explicit optional fields and converts validity timestamps to Date', () => {
    const lastPasswordChange = new Date('2026-01-01T00:00:00Z');
    const user = UserModel.create({
      name: 'Explicit User',
      email: 'explicit@example.com',
      phone: '+5511999999999',
      organizationId: 'org-1',
      username: 'explicit',
      password: 'hash',
      status: 'Suspenso',
      mfaEnabled: true,
      mfaSecretCiphertext: { ciphertext: 'encrypted' },
      mfaActivationDate: '2026-02-01',
      mfaFailedAttempts: 2,
      mfaLocked: true,
      anonId: 'anon-1',
      passwordHistory: ['h1'],
      lastPasswordChange,
      forceReset: true,
      failedLoginAttempts: 4,
      accountLockedUntil: '2026-09-20T00:00:00Z',
      roleValidFrom: '2026-09-01T00:00:00Z',
      roleValidUntil: '2026-10-01T00:00:00Z',
      organizationIds: ['org-1'],
    });

    expect(user.status).toBe('suspended');
    expect(user.phone).toBe('+5511999999999');
    expect(user.organizationId).toBe('org-1');
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaFailedAttempts).toBe(2);
    expect(user.mfaLocked).toBe(true);
    expect(user.passwordHistory).toEqual(['h1']);
    expect(user.lastPasswordChange).toBe(lastPasswordChange);
    expect(user.forceReset).toBe(true);
    expect(user.failedLoginAttempts).toBe(4);
    expect(user.accountLockedUntil).toEqual(new Date('2026-09-20T00:00:00Z'));
    expect(user.roleValidFrom).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(user.roleValidUntil).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(user.organizationIds).toEqual(['org-1']);
  });

  it('normalizes and translates every English/Portuguese status branch', () => {
    expect(UserModel.normalizeStatus('suspended')).toBe('suspended');
    expect(UserModel.normalizeStatus('blocked')).toBe('blocked');

    expect(UserModel.translateStatus('Ativo')).toBe('Ativo');
    expect(UserModel.translateStatus('Inativo')).toBe('Inativo');
    expect(UserModel.translateStatus('Suspenso')).toBe('Suspenso');
    expect(UserModel.translateStatus('Bloqueado')).toBe('Bloqueado');
  });

  it('stripSecrets preserves non-secret fields while removing all credential fields from objects and arrays', () => {
    expect(UserModel.stripSecrets(null)).toBeNull();
    expect(UserModel.stripSecrets('not-an-object')).toBe('not-an-object');

    const source = {
      _id: 'u1',
      name: 'Synthetic',
      password: 'hash',
      mfaSecret: 'legacy-secret',
      mfaSecretCiphertext: { ciphertext: 'ciphertext' },
      passwordHistory: ['hash-1'],
      passwordResetTokenHash: 'reset-hash',
      mfaEnabled: true,
    };
    const stripped = UserModel.stripSecrets(source);
    expect(stripped).toEqual({
      _id: 'u1',
      name: 'Synthetic',
      mfaEnabled: true,
    });
    expect(source.password).toBe('hash');

    expect(UserModel.stripSecrets([source, null])).toEqual([
      { _id: 'u1', name: 'Synthetic', mfaEnabled: true },
      null,
    ]);
  });
});
