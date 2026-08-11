import { describe, it, expect } from 'vitest';
const UserModel = require('../../src/models/User');

describe('UserModel.isValidEmail', () => {
  it('returns true for valid email', () => {
    expect(UserModel.isValidEmail('user@example.com')).toBe(true);
  });

  it('returns false for email without @', () => {
    expect(UserModel.isValidEmail('notanemail')).toBe(false);
  });

  it('returns false for email without domain', () => {
    expect(UserModel.isValidEmail('user@')).toBe(false);
  });
});

describe('UserModel.normalizeStatus', () => {
  it('returns active for null', () => {
    expect(UserModel.normalizeStatus(null)).toBe('active');
  });

  it('maps Portuguese "Ativo" to active', () => {
    expect(UserModel.normalizeStatus('Ativo')).toBe('active');
  });

  it('maps Portuguese "Inativo" to inactive', () => {
    expect(UserModel.normalizeStatus('Inativo')).toBe('inactive');
  });

  it('maps Portuguese "Suspenso" to suspended', () => {
    expect(UserModel.normalizeStatus('Suspenso')).toBe('suspended');
  });

  it('maps Portuguese "Bloqueado" to blocked', () => {
    expect(UserModel.normalizeStatus('Bloqueado')).toBe('blocked');
  });

  it('passes through English status unchanged', () => {
    expect(UserModel.normalizeStatus('active')).toBe('active');
    expect(UserModel.normalizeStatus('inactive')).toBe('inactive');
  });

  it('defaults to active for unknown status', () => {
    expect(UserModel.normalizeStatus('unknown')).toBe('active');
  });
});

describe('UserModel.translateStatus', () => {
  it('returns Ativo for null', () => {
    expect(UserModel.translateStatus(null)).toBe('Ativo');
  });

  it('maps active to Ativo', () => {
    expect(UserModel.translateStatus('active')).toBe('Ativo');
  });

  it('maps inactive to Inativo', () => {
    expect(UserModel.translateStatus('inactive')).toBe('Inativo');
  });

  it('maps suspended to Suspenso', () => {
    expect(UserModel.translateStatus('suspended')).toBe('Suspenso');
  });

  it('maps blocked to Bloqueado', () => {
    expect(UserModel.translateStatus('blocked')).toBe('Bloqueado');
  });

  it('defaults to Ativo for unknown', () => {
    expect(UserModel.translateStatus('xyz')).toBe('Ativo');
  });
});
