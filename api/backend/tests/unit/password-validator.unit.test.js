import { describe, it, expect } from 'vitest';
const PasswordValidator = require('../../src/utils/passwordValidator');

describe('PasswordValidator.validate', () => {
  const VALID = 'Str0ng!P@ssword99';

  it('returns isValid: true for a strong password', () => {
    const result = PasswordValidator.validate(VALID);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns isValid: false and error for null password', () => {
    const result = PasswordValidator.validate(null);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns isValid: false and error for undefined password', () => {
    const result = PasswordValidator.validate(undefined);
    expect(result.isValid).toBe(false);
  });

  it('returns isValid: false for password shorter than 12 chars', () => {
    const result = PasswordValidator.validate('Short!1A');
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('12'))).toBe(true);
  });

  it('returns error for password without uppercase', () => {
    const result = PasswordValidator.validate('all_lowercase!99');
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('maiúscula'))).toBe(true);
  });

  it('returns error for password without lowercase', () => {
    const result = PasswordValidator.validate('ALL_UPPERCASE!99');
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('minúscula'))).toBe(true);
  });

  it('returns error for password without special character', () => {
    const result = PasswordValidator.validate('NoSpecialChar12');
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('especial'))).toBe(true);
  });

  it('returns multiple errors for very weak password', () => {
    const result = PasswordValidator.validate('short');
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('accepts password with exactly 12 chars meeting all requirements', () => {
    const result = PasswordValidator.validate('Aa1!aaaaaaa1');
    expect(result.isValid).toBe(true);
  });

  it('returns isValid: false for empty string', () => {
    const result = PasswordValidator.validate('');
    expect(result.isValid).toBe(false);
  });

  it('accepts various special characters', () => {
    const specials = ['!', '@', '#', '$', '%', '^', '&', '*'];
    for (const s of specials) {
      const pw = `Password123${s}`;
      const result = PasswordValidator.validate(pw);
      expect(result.isValid).toBe(true);
    }
  });
});

describe('PasswordValidator.validateAndGetError', () => {
  it('returns null for valid password', () => {
    expect(PasswordValidator.validateAndGetError('Str0ng!P@ssword')).toBeNull();
  });

  it('returns error string for invalid password', () => {
    const error = PasswordValidator.validateAndGetError('weak');
    expect(typeof error).toBe('string');
    expect(error.length).toBeGreaterThan(0);
  });

  it('joins multiple errors with period', () => {
    const error = PasswordValidator.validateAndGetError('ab');
    expect(error).toContain('.');
  });
});

describe('PasswordValidator.validateOrThrow', () => {
  it('does not throw for valid password', () => {
    expect(() => PasswordValidator.validateOrThrow('Str0ng!P@ssword')).not.toThrow();
  });

  it('throws Error for invalid password', () => {
    expect(() => PasswordValidator.validateOrThrow('weak')).toThrow(Error);
  });

  it('error message contains validation details', () => {
    expect(() => PasswordValidator.validateOrThrow('short')).toThrow(/12|maiúscula|minúscula|especial/i);
  });
});
