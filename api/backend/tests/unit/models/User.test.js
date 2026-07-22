/**
 * Unit Tests - UserModel
 * Testa validações e regras de negócio de usuário
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import UserModel from '../../../src/models/User';

// Mock do password.service
vi.mock('../../../src/services/password.service', () => ({
  validateStrength: vi.fn((password) => {
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
  })
}));

describe('UserModel - Unit Tests', () => {
  let validUserData;

  beforeEach(() => {
    validUserData = {
      name: 'João Silva',
      email: 'joao@example.com',
      username: 'joaosilva',
      password: 'Senha@123',
      accessType: 1,
      phone: '11987654321',
      institution: 'Hospital XYZ',
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
      validUserData.password = 'Senha@123';
      delete validUserData._id; // Novo usuário
      const result = UserModel.validate(validUserData);

      // Password válida deve passar
      expect(result.errors.some(e => e.includes('password'))).toBe(false);
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

    it('deve rejeitar accessType inválido', () => {
      validUserData.accessType = 99;
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('accessType inválido'))).toBe(true);
    });

    it('deve aceitar phone vazio (campo opcional)', () => {
      validUserData.phone = '';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
      expect(validUserData.phone).toBeNull(); // Normalizado para null
    });

    it('deve aceitar institution vazia (campo opcional)', () => {
      validUserData.institution = '';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(true);
      expect(validUserData.institution).toBeNull(); // Normalizado para null
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

    it('deve rejeitar lastPasswordChange com data inválida', () => {
      validUserData.lastPasswordChange = 'data-invalida';
      const result = UserModel.validate(validUserData);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('lastPasswordChange deve ser uma data válida'))).toBe(true);
    });

    it('deve aceitar lastPasswordChange válida', () => {
      validUserData.lastPasswordChange = new Date().toISOString();
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

  describe('isValidAccessType()', () => {
    it('deve aceitar access types válidos (1-4)', () => {
      for (let i = 1; i <= 4; i++) {
        validUserData.accessType = i;
        const result = UserModel.validate(validUserData);
        expect(result.isValid).toBe(true);
      }
    });

    it('deve rejeitar access types inválidos quando fornecidos', () => {
      // Note: O modelo só valida accessType se for truthy
      // Valores falsy (0, undefined, null) passam na validação
      const invalidButTruthyTypes = [5, 99, -1, 'admin'];

      invalidButTruthyTypes.forEach(type => {
        validUserData.accessType = type;
        const result = UserModel.validate(validUserData);
        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.includes('accessType inválido'))).toBe(true);
      });
    });

    it('deve aceitar accessType undefined ou null (usa default 2)', () => {
      // O modelo não valida falsy values, então undefined/null passam
      validUserData.accessType = undefined;
      const result1 = UserModel.validate(validUserData);
      expect(result1.isValid).toBe(true);

      validUserData.accessType = null;
      const result2 = UserModel.validate(validUserData);
      expect(result2.isValid).toBe(true);
    });
  });

  describe('create()', () => {
    it('deve criar usuário com todos os campos fornecidos', () => {
      const data = {
        name: 'João Silva',
        email: 'joao@example.com',
        phone: '11987654321',
        institution: 'Hospital XYZ',
        username: 'joaosilva',
        password: 'Senha@123',
        accessType: 3,
        status: 'Ativo',
        mfaEnabled: true,
        mfaSecret: 'secret123',
        mfaActivationDate: '2026-01-01',
        mfaFailedAttempts: 2,
        mfaLocked: true,
        anonId: 'anon-1',
        passwordHistory: ['h1'],
        lastPasswordChange: '2026-01-01',
        forceReset: true,
        failedLoginAttempts: 5
      };

      const user = UserModel.create(data);

      expect(user.name).toBe('João Silva');
      expect(user.email).toBe('joao@example.com');
      expect(user.phone).toBe('11987654321');
      expect(user.institution).toBe('Hospital XYZ');
      expect(user.accessType).toBe(3);
      expect(user.status).toBe('active'); // normalizado
      expect(user.mfaEnabled).toBe(true);
      expect(user.mfaSecret).toBe('secret123');
      expect(user.mfaActivationDate).toBe('2026-01-01');
      expect(user.mfaFailedAttempts).toBe(2);
      expect(user.mfaLocked).toBe(true);
      expect(user.anonId).toBe('anon-1');
      expect(user.passwordHistory).toEqual(['h1']);
      expect(user.lastPasswordChange).toBe('2026-01-01');
      expect(user.forceReset).toBe(true);
      expect(user.failedLoginAttempts).toBe(5);
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
      expect(user.lastLogin).toBeNull();
    });

    it('deve aplicar defaults quando campos opcionais ausentes', () => {
      const data = {
        name: 'Maria',
        email: 'maria@example.com',
        username: 'maria',
        password: 'Senha@123'
      };

      const user = UserModel.create(data);

      expect(user.phone).toBeNull();
      expect(user.institution).toBeNull();
      expect(user.accessType).toBe(2);
      expect(user.status).toBe('active');
      expect(user.mfaEnabled).toBe(false);
      expect(user.mfaSecret).toBeNull();
      expect(user.mfaActivationDate).toBeNull();
      expect(user.mfaFailedAttempts).toBe(0);
      expect(user.mfaLocked).toBe(false);
      expect(user.anonId).toBeNull();
      expect(user.passwordHistory).toEqual([]);
      expect(user.lastPasswordChange).toBeInstanceOf(Date);
      expect(user.forceReset).toBe(false);
      expect(user.failedLoginAttempts).toBe(0);
    });

    it('deve manter passwordHistory vazio quando fornecido valor não-array', () => {
      const data = {
        name: 'Maria',
        email: 'maria@example.com',
        username: 'maria',
        password: 'Senha@123',
        passwordHistory: 'not-an-array'
      };

      const user = UserModel.create(data);

      expect(user.passwordHistory).toEqual([]);
    });
  });

  describe('getRoleName()', () => {
    it('deve mapear cada accessType válido para seu nome de role', () => {
      expect(UserModel.getRoleName(1)).toBe('UsuarioExterno');
      expect(UserModel.getRoleName(2)).toBe('Tecnico');
      expect(UserModel.getRoleName(3)).toBe('Coordenador');
      expect(UserModel.getRoleName(4)).toBe('Administrador');
    });

    it('deve retornar UsuarioExterno para accessType desconhecido', () => {
      expect(UserModel.getRoleName(99)).toBe('UsuarioExterno');
      expect(UserModel.getRoleName(undefined)).toBe('UsuarioExterno');
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
