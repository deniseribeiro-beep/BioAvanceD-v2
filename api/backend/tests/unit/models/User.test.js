/**
 * Unit Tests - UserModel
 * Testa validações e regras de negócio de usuário
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

// #1337: the model is loaded through createRequire, not `import`, the way the
// route and controller tests load what they test. Measured: while this file
// imported it, the merged v8 coverage of src/models/User.js dropped from
// 97.14% to 86.85% of branches in a run of the same tests, because the
// vite-loaded copy and the natively required copy were merged as one. For
// the same reason the password service is stubbed with vi.spyOn on its CJS
// module object (the one validate() requires), since vi.mock does not reach
// a native require.
const require2 = createRequire(import.meta.url);
const UserModel = require2('../../../src/models/User');
const passwordService = require2('../../../src/services/password.service');

// Mock do password.service
vi.spyOn(passwordService, 'validateStrength').mockImplementation((password) => {
  // Simula validação: deve ter mínimo 8 caracteres, uma maiúscula, um número e um símbolo
  if (password.length < 8) {
    throw new Error('Password deve ter no mínimo 8 caracteres');
  }
  if (!/[A-Z]/.test(password)) {
    throw new Error('Password deve conter pelo menos uma letra maiúscula');
  }
  if (!/[0-9]/.test(password)) {
    throw new Error('Password deve conter pelo menos um número');
  }
  if (!/[!@#$%^&*]/.test(password)) {
    throw new Error('Password deve conter pelo menos um símbolo especial');
  }
});

describe('UserModel - Unit Tests', () => {
  let validUserData;

  beforeEach(() => {
    validUserData = {
      name: 'João Silva',
      email: 'joao@example.com',
      username: 'joaosilva',
      password: 'Senha@123456789',
      accessType: 1,
      phone: '11987654321',
      organizationId: 'org-uuid-1',
      status: 'active'
    };
  });

  describe('validate()', () => {
    it('deve validar usuário completo e válido', () => {
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('deve rejeitar quando name ausente', () => {
      delete validUserData.name;
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('name é obrigatório e deve ser string');
    });

    it('deve rejeitar quando name não é string', () => {
      validUserData.name = 123;
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('name é obrigatório e deve ser string');
    });

    it('deve rejeitar email inválido', () => {
      validUserData.email = 'email-invalido';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('email'))).toBe(true);
    });

    it('deve rejeitar quando email ausente', () => {
      delete validUserData.email;
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('email é obrigatório'))).toBe(true);
    });

    it('deve rejeitar quando username ausente', () => {
      delete validUserData.username;
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('username é obrigatório e deve ser string');
    });

    it('deve validar password quando fornecido', () => {
      // password.service é chamado quando senha é fornecida
      // O comportamento exato depende do mock estar available
      validUserData.password = 'Senha@123456789';
      delete validUserData._id; // Novo usuário
      const result = UserModel.validate(validUserData);

      // Password válida deve passar
      expect(result.errors.some(e => e.includes('password'))).toBe(false);
    });

    it('deve rejeitar quando password fornecida não atende aos requisitos de força', () => {
      validUserData.password = 'fraca';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.startsWith('password: '))).toBe(true);
    });

    it('deve rejeitar quando password obrigatório e ausente em novo usuário', () => {
      delete validUserData.password;
      delete validUserData._id; // Novo usuário
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('password é obrigatório');
    });

    it('não deve rejeitar quando password ausente em update de usuário existente', () => {
      delete validUserData.password;
      validUserData._id = 'user123'; // Simular usuário existente
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
    });

    it('deve aceitar phone vazio (campo opcional)', () => {
      validUserData.phone = '';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
      expect(validUserData.phone).toBeNull(); // Normalizado para null
    });

    it('deve aceitar ausência de phone e organizationId (campos opcionais)', () => {
      delete validUserData.phone;
      delete validUserData.organizationId;
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
      expect(validUserData.phone).toBeUndefined();
      expect(validUserData.organizationId).toBeUndefined();
    });

    it('deve aceitar organizationId vazio (campo opcional)', () => {
      validUserData.organizationId = '';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
      expect(validUserData.organizationId).toBeNull(); // Normalizado para null
    });

    it('deve rejeitar organizationIds quando não é array de strings', () => {
      validUserData.organizationIds = 'not-an-array';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('organizationIds deve ser um array de strings');
    });

    it('deve aceitar organizationIds válido (array de strings)', () => {
      validUserData.organizationIds = ['org-uuid-1', 'org-uuid-2'];
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
    });

    it('deve validar status em português', () => {
      validUserData.status = 'Ativo';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
    });

    it('deve validar status em inglês', () => {
      validUserData.status = 'active';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
    });

    it('deve rejeitar status inválido', () => {
      validUserData.status = 'desconhecido';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('status deve ser'))).toBe(true);
    });

    it('deve rejeitar passwordHistory se não for array', () => {
      validUserData.passwordHistory = 'not_an_array';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('passwordHistory deve ser um array');
    });

    it('deve aceitar passwordHistory válido (array)', () => {
      validUserData.passwordHistory = ['hash1', 'hash2'];
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
    });

    it('deve rejeitar passwordChangedAt com data inválida', () => {
      validUserData.passwordChangedAt = 'data-invalida';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('passwordChangedAt deve ser uma data válida'))).toBe(true);
    });

    it('deve aceitar passwordChangedAt válida', () => {
      validUserData.passwordChangedAt = new Date().toISOString();
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
    });

    it('deve rejeitar forceReset se não for booleano', () => {
      validUserData.forceReset = 'sim';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('forceReset deve ser booleano');
    });

    it('deve rejeitar failedLoginAttempts se não for número', () => {
      validUserData.failedLoginAttempts = 'muitas';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('failedLoginAttempts deve ser número');
    });
  });

  describe('isValidEmail()', () => {
    it('deve aceitar emails válidos', () => {
      const validEmails = [
        'user@example.com',
        'john.doe@company.co.uk',
        'test+tag@email.com'
      ];

      validEmails.forEach(email => {
        validUserData.email = email;
        const result = UserModel.validate(validUserData);
        expect(result.isValid).toBe(true);
      });
    });

    it('deve rejeitar emails inválidos', () => {
      const invalidEmails = [
        'invalid',
        'user@',
        '@example.com',
        'user @example.com',
        'user@example'
      ];

      invalidEmails.forEach(email => {
        validUserData.email = email;
        const result = UserModel.validate(validUserData);
        expect(result.isValid).toBe(false);
      });
    });
  });

  describe('create()', () => {
    it('deve criar usuário com todos os campos fornecidos', () => {
      const data = {
        displayName: 'João Silva',
        email: 'joao@example.com',
        phone: '11987654321',
        organizationId: 'org-uuid-1',
        username: 'joaosilva',
        passwordHash: '$2a$10$hash-computed-by-the-service',
        accountStatus: 'Ativo',
        mfaEnabled: true,
        mfaSecretCiphertext: 'secret123',
        mfaSetupAt: '2026-01-01',
        mfaFailedAttempts: 2,
        mfaLocked: true,
        anonId: 'anon-1',
        passwordHistoryHashes: ['h1'],
        passwordChangedAt: '2026-01-01',
        forcePasswordReset: true,
        failedLoginAttempts: 5
      };

      const user = UserModel.create(data);

      expect(user.displayName).toBe('João Silva');
      expect(user.email).toBe('joao@example.com');
      expect(user.phone).toBe('11987654321');
      expect(user.organizationId).toBe('org-uuid-1');
      expect(user.passwordHash).toBe('$2a$10$hash-computed-by-the-service');
      expect(user.accountStatus).toBe('active'); // normalizado
      expect(user.mfaEnabled).toBe(true);
      expect(user.mfaSecretCiphertext).toBe('secret123');
      expect(user.mfaSetupAt).toBe('2026-01-01');
      expect(user.mfaFailedAttempts).toBe(2);
      expect(user.mfaLocked).toBe(true);
      // #1275 follow-up: never taken from input; generateAnonId writes it.
      expect(user.anonId).toBeNull();
      expect(user.passwordHistoryHashes).toEqual(['h1']);
      expect(user.passwordChangedAt).toBe('2026-01-01');
      expect(user.forcePasswordReset).toBe(true);
      expect(user.failedLoginAttempts).toBe(5);
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
      expect(user.lastLoginAt).toBeNull();
    });

    it('#1330: a new document carries no legacy name, and never a plaintext password', () => {
      const user = UserModel.create({
        displayName: 'Maria',
        email: 'maria@example.com',
        username: 'maria',
        passwordHash: '$2a$10$hash',
        password: 'Senha@123456789'
      });

      for (const legacy of UserModel.LEGACY_FIELDS) {
        expect(user).not.toHaveProperty(legacy);
      }
      expect(JSON.stringify(user)).not.toContain('Senha@123456789');
    });

    it('deve aplicar defaults quando campos opcionais ausentes', () => {
      const data = {
        displayName: 'Maria',
        email: 'maria@example.com',
        username: 'maria',
        passwordHash: '$2a$10$hash'
      };

      const user = UserModel.create(data);

      expect(user.phone).toBeNull();
      expect(user.organizationId).toBeNull();
      expect(user.accountStatus).toBe('active');
      expect(user.mfaEnabled).toBe(false);
      expect(user.mfaSecretCiphertext).toBeNull();
      expect(user.mfaSetupAt).toBeNull();
      expect(user.mfaFailedAttempts).toBe(0);
      expect(user.mfaLocked).toBe(false);
      expect(user.anonId).toBeNull();
      expect(user.passwordHistoryHashes).toEqual([]);
      expect(user.passwordChangedAt).toBeInstanceOf(Date);
      expect(user.forcePasswordReset).toBe(false);
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.passwordResetTokenHash).toBeNull();
      expect(user.passwordResetExpiresAt).toBeNull();
    });

    it('deve manter passwordHistoryHashes vazio quando fornecido valor não-array', () => {
      const data = {
        displayName: 'Maria',
        email: 'maria@example.com',
        username: 'maria',
        passwordHash: '$2a$10$hash',
        passwordHistoryHashes: 'not-an-array'
      };

      const user = UserModel.create(data);

      expect(user.passwordHistoryHashes).toEqual([]);
    });
  });

  // #1330: stored documents use the dict-02 names; documents written before
  // them carry the legacy ones until the migration or a write moves them.
  // #1386: readers no longer fall back to a legacy name.
  describe('#1330 stored names', () => {
    const legacyUser = () => ({
      _id: 'u1',
      name: 'Legado',
      password: '$2a$10$legacyhash',
      status: 'blocked',
      mfaActivationDate: new Date('2026-01-01T00:00:00Z'),
      lastLogin: null,
      passwordHistory: ['$2a$10$older'],
      forceReset: true,
      passwordResetExpires: new Date('2026-02-01T00:00:00Z')
    });

    it('#1386: storedValueOf does not read a legacy name', () => {
      expect(UserModel.storedValueOf({ name: 'Old' }, 'displayName')).toBeUndefined();
    });

    it('#1386: the accessors do not read a legacy document through its old names', () => {
      const user = legacyUser();
      expect(UserModel.displayNameOf(user)).toBeUndefined();
      expect(UserModel.passwordHashOf(user)).toBeUndefined();
      expect(UserModel.accountStatusOf(user)).toBeUndefined();
      expect(UserModel.mfaSetupAtOf(user)).toBeUndefined();
      expect(UserModel.passwordHistoryOf(user)).toBeUndefined();
      expect(UserModel.forcePasswordResetOf(user)).toBeUndefined();
      expect(UserModel.passwordResetExpiresAtOf(user)).toBeUndefined();
    });

    it('a canonical value is read beside a legacy one, and a canonical null stays null', () => {
      const user = { ...legacyUser(), accountStatus: 'active', lastLoginAt: null, lastLogin: new Date() };
      expect(UserModel.accountStatusOf(user)).toBe('active');
      expect(UserModel.lastLoginAtOf(user)).toBeNull();
      expect(UserModel.accountStatusOf({})).toBeUndefined();
    });

    it('#1386: accountStatusFilter matches the canonical accountStatus only', () => {
      expect(UserModel.accountStatusFilter('active')).toEqual({ accountStatus: 'active' });
    });

    it('storedUpdateOf writes canonical names and unsets the legacy name of each field it touches', () => {
      expect(UserModel.storedUpdateOf(
        { passwordHash: 'h', forceReset: false, updatedAt: 1 },
        { unset: ['passwordResetTokenHash', 'passwordResetExpiresAt'] }
      )).toEqual({
        $set: { passwordHash: 'h', forcePasswordReset: false, updatedAt: 1 },
        $unset: { password: '', forceReset: '', passwordResetTokenHash: '', passwordResetExpiresAt: '', passwordResetExpires: '' }
      });
      expect(UserModel.storedUpdateOf({ mfaLocked: false })).toEqual({ $set: { mfaLocked: false } });
    });

    it('canonicalMoveOf moves every remaining legacy name, guarded on each name still being legacy', () => {
      const move = UserModel.canonicalMoveOf(legacyUser(), { except: ['lastLoginAt'] });
      expect(move.update.$set).toEqual({
        displayName: 'Legado',
        passwordHash: '$2a$10$legacyhash',
        accountStatus: 'blocked',
        mfaSetupAt: new Date('2026-01-01T00:00:00Z'),
        passwordHistoryHashes: ['$2a$10$older'],
        forcePasswordReset: true,
        passwordResetExpiresAt: new Date('2026-02-01T00:00:00Z')
      });
      expect(move.update.$unset).toEqual({
        name: '', password: '', status: '', mfaActivationDate: '', passwordHistory: '', forceReset: '', passwordResetExpires: ''
      });
      expect(move.filter).toMatchObject({
        _id: 'u1',
        accountStatus: { $exists: false },
        status: { $exists: true },
        passwordHash: { $exists: false },
        password: { $exists: true }
      });
      expect(move.filter).not.toHaveProperty('lastLoginAt');
    });

    it('canonicalMoveOf is null for a document already under the canonical names', () => {
      const user = UserModel.create({ displayName: 'Nova', email: 'n@example.com', username: 'n', passwordHash: 'h' });
      expect(UserModel.canonicalMoveOf({ _id: 'u2', ...user })).toBeNull();
    });

    it('storedNamesOf renames a request body and drops its plaintext password', () => {
      expect(UserModel.storedNamesOf({ name: 'N', status: 'Ativo', forceReset: true, password: 'Plain@123', email: 'e' }))
        .toEqual({ displayName: 'N', accountStatus: 'Ativo', forcePasswordReset: true, email: 'e' });
    });

    it('apiViewOf returns a canonical document under the API names', () => {
      const view = UserModel.apiViewOf({ _id: 'u3', displayName: 'C', accountStatus: 'active', lastLoginAt: null, mfaSetupAt: null, forcePasswordReset: false });
      expect(view).toEqual({ _id: 'u3', name: 'C', status: 'active', lastLogin: null, mfaActivationDate: null, forceReset: false });
    });

    it('stripSecrets returns neither hash name nor either history name, from a document under either names', () => {
      const canonical = UserModel.stripSecrets({
        _id: 'u4', displayName: 'C', passwordHash: 'h1', passwordHistoryHashes: ['h0'], passwordResetTokenHash: 't', mfaSecretCiphertext: 's'
      });
      const legacy = UserModel.stripSecrets(legacyUser());
      for (const out of [canonical, legacy]) {
        for (const key of ['password', 'passwordHash', 'passwordHistory', 'passwordHistoryHashes', 'passwordResetTokenHash', 'mfaSecretCiphertext']) {
          expect(out).not.toHaveProperty(key);
        }
      }
      expect(canonical.name).toBe('C');
      expect(legacy.name).toBe('Legado');
    });
  });

  describe('normalizeStatus()', () => {
    it('deve normalizar status em português para inglês', () => {
      expect(UserModel.normalizeStatus('Ativo')).toBe('active');
      expect(UserModel.normalizeStatus('Inativo')).toBe('inactive');
      expect(UserModel.normalizeStatus('Suspenso')).toBe('suspended');
      expect(UserModel.normalizeStatus('Bloqueado')).toBe('blocked');
    });

    it('deve manter status já em inglês', () => {
      expect(UserModel.normalizeStatus('active')).toBe('active');
      expect(UserModel.normalizeStatus('inactive')).toBe('inactive');
      expect(UserModel.normalizeStatus('suspended')).toBe('suspended');
      expect(UserModel.normalizeStatus('blocked')).toBe('blocked');
    });

    it('deve retornar active quando status ausente', () => {
      expect(UserModel.normalizeStatus(undefined)).toBe('active');
      expect(UserModel.normalizeStatus(null)).toBe('active');
      expect(UserModel.normalizeStatus('')).toBe('active');
    });

    it('deve retornar active para status desconhecido', () => {
      expect(UserModel.normalizeStatus('desconhecido')).toBe('active');
    });
  });

  describe('translateStatus()', () => {
    it('deve traduzir status em inglês para português', () => {
      expect(UserModel.translateStatus('active')).toBe('Ativo');
      expect(UserModel.translateStatus('inactive')).toBe('Inativo');
      expect(UserModel.translateStatus('suspended')).toBe('Suspenso');
      expect(UserModel.translateStatus('blocked')).toBe('Bloqueado');
    });

    it('deve manter status já em português', () => {
      expect(UserModel.translateStatus('Ativo')).toBe('Ativo');
      expect(UserModel.translateStatus('Inativo')).toBe('Inativo');
      expect(UserModel.translateStatus('Suspenso')).toBe('Suspenso');
      expect(UserModel.translateStatus('Bloqueado')).toBe('Bloqueado');
    });

    it('deve retornar Ativo quando status ausente', () => {
      expect(UserModel.translateStatus(undefined)).toBe('Ativo');
      expect(UserModel.translateStatus(null)).toBe('Ativo');
      expect(UserModel.translateStatus('')).toBe('Ativo');
    });

    it('deve retornar Ativo para status desconhecido', () => {
      expect(UserModel.translateStatus('desconhecido')).toBe('Ativo');
    });
  });
});

// #1337: the cases below cover validate()'s and the stored-name helpers'
// remaining branches. Passwords meet the strength stub above.
const STRONG = 'Senha@123456789';

function base(extra = {}) {
  return { name: 'Ana', email: 'ana@example.com', username: 'ana', password: STRONG, ...extra };
}

describe('UserModel.validate branch arms (#1337)', () => {
  it('accepts a complete body', () => {
    expect(UserModel.validate(base())).toEqual({ isValid: true, errors: [] });
  });

  it('requires name, email and username as strings', () => {
    const r = UserModel.validate({ name: 1, email: 'not-an-email', username: 2, password: STRONG });
    expect(r.isValid).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining([
      'name é obrigatório e deve ser string',
      expect.stringContaining('email'),
      'username é obrigatório e deve ser string',
    ]));
  });

  it('turns a blank phone and organizationId into null, and keeps non-blank ones', () => {
    const blank = base({ phone: '   ', organizationId: '  ' });
    UserModel.validate(blank);
    expect(blank.phone).toBeNull();
    expect(blank.organizationId).toBeNull();
    const kept = base({ phone: '119', organizationId: 'org-1' });
    UserModel.validate(kept);
    expect(kept.phone).toBe('119');
    expect(kept.organizationId).toBe('org-1');
  });

  it('requires a password on create only', () => {
    const { password, ...noPassword } = base();
    expect(UserModel.validate(noPassword).errors).toContain('password é obrigatório');
    expect(UserModel.validate({ ...noPassword, _id: 'x' }).isValid).toBe(true);
  });

  it('reports a weak password through the strength check', () => {
    const r = UserModel.validate(base({ password: 'a' }));
    expect(r.isValid).toBe(false);
    expect(r.errors.some((e) => e.startsWith('password: '))).toBe(true);
  });

  it.each([
    ['passwordHistory', 'x', 'passwordHistory deve ser um array'],
    ['passwordChangedAt', 'not-a-date', 'passwordChangedAt deve ser uma data válida'],
    ['forceReset', 'sim', 'forceReset deve ser booleano'],
    ['failedLoginAttempts', '3', 'failedLoginAttempts deve ser número'],
    ['accountLockedUntil', 'not-a-date', 'accountLockedUntil deve ser uma data válida'],
    ['status', 'unknown', 'status deve ser: active/Ativo, inactive/Inativo, blocked/Bloqueado ou suspended/Suspenso'],
    ['roleValidFrom', 'not-a-date', 'roleValidFrom deve ser uma data válida'],
    ['roleValidUntil', 'not-a-date', 'roleValidUntil deve ser uma data válida'],
    ['organizationIds', ['ok', 3], 'organizationIds deve ser um array de strings'],
    ['organizationIds', 'org-1', 'organizationIds deve ser um array de strings'],
  ])('rejects %s = %j', (field, value, message) => {
    const r = UserModel.validate(base({ [field]: value }));
    expect(r.isValid).toBe(false);
    expect(r.errors).toContain(message);
  });

  it.each([
    ['passwordHistory', ['h1']],
    ['passwordChangedAt', '2026-01-01'],
    ['forceReset', false],
    ['failedLoginAttempts', 0],
    ['accountLockedUntil', null],
    ['accountLockedUntil', '2026-01-01'],
    ['status', 'Bloqueado'],
    ['roleValidFrom', null],
    ['roleValidUntil', null],
    ['organizationIds', null],
    ['organizationIds', ['org-1']],
  ])('accepts %s = %j', (field, value) => {
    expect(UserModel.validate(base({ [field]: value })).errors).toEqual([]);
  });

  it('requires roleValidUntil after roleValidFrom', () => {
    const msg = 'roleValidUntil deve ser posterior a roleValidFrom';
    expect(UserModel.validate(base({ roleValidFrom: '2026-02-01', roleValidUntil: '2026-01-01' })).errors).toContain(msg);
    expect(UserModel.validate(base({ roleValidFrom: '2026-01-01', roleValidUntil: '2026-01-01' })).errors).toContain(msg);
    expect(UserModel.validate(base({ roleValidFrom: '2026-01-01', roleValidUntil: '2026-02-01' })).errors).toEqual([]);
    // One side invalid: only that side's own error, not the ordering one.
    const bad = UserModel.validate(base({ roleValidFrom: 'nope', roleValidUntil: '2026-02-01' })).errors;
    expect(bad).toContain('roleValidFrom deve ser uma data válida');
    expect(bad).not.toContain(msg);
  });
});

describe('UserModel.fieldsOf / create (#1337)', () => {
  it('converts the date fields and keeps an array organizationIds', () => {
    const f = UserModel.fieldsOf({
      accountLockedUntil: '2026-01-01', roleValidFrom: '2026-01-02', roleValidUntil: '2026-01-03',
      organizationIds: ['o1'], passwordHistoryHashes: ['h'],
    });
    expect(f.accountLockedUntil).toEqual(new Date('2026-01-01'));
    expect(f.roleValidFrom).toEqual(new Date('2026-01-02'));
    expect(f.roleValidUntil).toEqual(new Date('2026-01-03'));
    expect(f.organizationIds).toEqual(['o1']);
    expect(f.passwordHistoryHashes).toEqual(['h']);
  });

  it('defaults every optional field with no data', () => {
    const f = UserModel.fieldsOf();
    expect(f.accountStatus).toBe('active');
    expect(f.accountLockedUntil).toBeNull();
    expect(f.organizationIds).toEqual([]);
    expect(f.passwordHistoryHashes).toEqual([]);
  });

  it('create keeps a given passwordChangedAt and stamps one otherwise', () => {
    const given = new Date('2025-05-05');
    expect(UserModel.create({ passwordChangedAt: given }).passwordChangedAt).toBe(given);
    expect(UserModel.create({}).passwordChangedAt).toBeInstanceOf(Date);
  });
});

describe('UserModel stored-name helpers (#1337)', () => {
  it('storedUpdateOf renames legacy keys and unsets both names', () => {
    expect(UserModel.storedUpdateOf({ status: 'blocked', note: 'n' }, { unset: ['forceReset', 'other'] })).toEqual({
      $set: { accountStatus: 'blocked', note: 'n' },
      $unset: { status: '', forcePasswordReset: '', forceReset: '', other: '' },
    });
    expect(UserModel.storedUpdateOf()).toEqual({});
    expect(UserModel.storedUpdateOf({}, { unset: ['name'] })).toEqual({ $unset: { displayName: '', name: '' } });
  });

  it('the stored-value accessors read the canonical name and are undefined for no user', () => {
    expect(UserModel.storedValueOf(null, 'displayName')).toBeUndefined();
    expect(UserModel.displayNameOf({ displayName: 'a', name: 'legacy' })).toBe('a');
    expect(UserModel.lastLoginAtOf({ lastLogin: 'legacy' })).toBeUndefined();
  });

  it('storedNamesOf renames API keys, drops password, and keeps a canonical value over a legacy one', () => {
    expect(UserModel.storedNamesOf({ name: 'a', password: 'p', status: 'active', accountStatus: 'blocked', email: 'e' }))
      .toEqual({ displayName: 'a', accountStatus: 'blocked', email: 'e' });
    expect(UserModel.storedNamesOf()).toEqual({});
  });

  it('canonicalMoveOf moves only legacy-only fields, honours except, and is null when nothing moves', () => {
    expect(UserModel.canonicalMoveOf(null)).toBeNull();
    expect(UserModel.canonicalMoveOf({ name: 'x' })).toBeNull();
    expect(UserModel.canonicalMoveOf({ _id: 1, displayName: 'x' })).toBeNull();
    const move = UserModel.canonicalMoveOf({ _id: 1, name: 'x', status: 'active', displayName: undefined }, { except: ['accountStatus'] });
    expect(move).toEqual({
      filter: { _id: 1, displayName: { $exists: false }, name: { $exists: true } },
      update: { $set: { displayName: 'x' }, $unset: { name: '' } },
    });
  });

  it('apiViewOf passes a non-object through and renames a document', () => {
    expect(UserModel.apiViewOf(null)).toBeNull();
    expect(UserModel.apiViewOf('x')).toBe('x');
    expect(UserModel.apiViewOf({ displayName: 'a', email: 'e' })).toEqual({ name: 'a', email: 'e' });
  });

  it('normalizeStatus and translateStatus fall back on an unknown value', () => {
    expect(UserModel.normalizeStatus('weird')).toBe('active');
    expect(UserModel.translateStatus('weird')).toBe('Ativo');
  });

  it('stripSecrets passes non-objects through and maps an array', () => {
    expect(UserModel.stripSecrets(null)).toBeNull();
    expect(UserModel.stripSecrets([{ displayName: 'a', passwordHash: 'h', mfaSecret: 's' }])).toEqual([{ name: 'a' }]);
  });
});
