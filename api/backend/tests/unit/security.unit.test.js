import { describe, it, expect } from 'vitest';
const { sanitizeInput, validateCPF, validateEmail, sanitizeSensitiveData, escapeString, validateStructuredInput } = require('../../src/utils/security');

describe('sanitizeInput', () => {
  it('returns empty string for null', () => {
    expect(sanitizeInput(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(sanitizeInput(undefined)).toBe('');
  });

  it('returns empty string for non-string numbers', () => {
    expect(sanitizeInput(42)).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  it('removes script tags', () => {
    const result = sanitizeInput('<script>alert("xss")</script>Hello');
    expect(result).not.toContain('<script>');
    expect(result).toContain('Hello');
  });

  it('removes HTML tags', () => {
    const result = sanitizeInput('<b>bold</b> text');
    expect(result).not.toContain('<b>');
    expect(result).toContain('bold');
    expect(result).toContain('text');
  });

  it('removes event handlers', () => {
    const result = sanitizeInput('text onclick=alert(1) more');
    expect(result).not.toMatch(/onclick\s*=/i);
  });

  it('passes plain text unchanged', () => {
    expect(sanitizeInput('Sample SMP-001 created')).toBe('Sample SMP-001 created');
  });

  it('truncates text longer than 1000 chars', () => {
    const long = 'a'.repeat(1100);
    const result = sanitizeInput(long);
    expect(result.length).toBe(1000);
  });

  it('preserves accented characters', () => {
    expect(sanitizeInput('João e María')).toContain('João');
  });

  it('returns empty string for empty string input', () => {
    expect(sanitizeInput('')).toBe('');
  });
});

describe('validateCPF', () => {
  it('returns false for null', () => {
    expect(validateCPF(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateCPF('')).toBe(false);
  });

  it('returns false for non-string', () => {
    expect(validateCPF(12345678901)).toBe(false);
  });

  it('returns false for CPF with wrong length', () => {
    expect(validateCPF('123456')).toBe(false);
  });

  it('returns false for all-same-digit CPF 00000000000', () => {
    expect(validateCPF('00000000000')).toBe(false);
  });

  it('returns false for all-same-digit CPF 111.111.111-11', () => {
    expect(validateCPF('111.111.111-11')).toBe(false);
  });

  it('returns true for valid CPF 529.982.247-25', () => {
    expect(validateCPF('529.982.247-25')).toBe(true);
  });

  it('validates CPF without formatting (digits only)', () => {
    expect(validateCPF('52998224725')).toBe(true);
  });

  it('returns false for CPF with invalid check digits', () => {
    expect(validateCPF('529.982.247-00')).toBe(false);
  });
});

describe('validateEmail', () => {
  it('returns true for valid email', () => {
    expect(validateEmail('user@example.com')).toBe(true);
  });

  it('returns false for missing @', () => {
    expect(validateEmail('userexample.com')).toBe(false);
  });

  it('returns false for missing domain', () => {
    expect(validateEmail('user@')).toBe(false);
  });

  it('returns false for null', () => {
    expect(validateEmail(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateEmail('')).toBe(false);
  });

  it('returns true for email with subdomain', () => {
    expect(validateEmail('user@mail.example.com')).toBe(true);
  });
});

describe('sanitizeSensitiveData', () => {
  it('returns null unchanged (non-object)', () => {
    expect(sanitizeSensitiveData(null)).toBeNull();
  });

  it('returns string unchanged (non-object)', () => {
    expect(sanitizeSensitiveData('plain')).toBe('plain');
  });

  it('redacts custom field when specified', () => {
    const result = sanitizeSensitiveData({ name: 'João', id: 1 }, ['name']);
    expect(result.name).toBe('***REDATADO***');
    expect(result.id).toBe(1);
  });

  it('always redacts default sensitive fields (password)', () => {
    const result = sanitizeSensitiveData({ password: 'secret', id: 1 });
    expect(result.password).toBe('***REDATADO***');
    expect(result.id).toBe(1);
  });

  it('always redacts default sensitive field cpf', () => {
    const result = sanitizeSensitiveData({ cpf: '123.456.789-00', id: 1 });
    expect(result.cpf).toBe('***REDATADO***');
  });

  it('always redacts default sensitive field token', () => {
    const result = sanitizeSensitiveData({ token: 'tok-abc', id: 1 });
    expect(result.token).toBe('***REDATADO***');
  });

  it('does not mutate original object', () => {
    const original = { password: 'secret', id: 1 };
    sanitizeSensitiveData(original);
    expect(original.password).toBe('secret');
  });

  it('does not redact non-listed, non-default fields', () => {
    const result = sanitizeSensitiveData({ action: 'UPDATE', entity: 'Sample' });
    expect(result.action).toBe('UPDATE');
    expect(result.entity).toBe('Sample');
  });

  it('handles empty object', () => {
    const result = sanitizeSensitiveData({});
    expect(result).toEqual({});
  });
});

describe('escapeString', () => {
  it('escapes $ signs (MongoDB injection prevention)', () => {
    const result = escapeString('$where');
    expect(result).toContain('\\$');
  });

  it('escapes dots', () => {
    const result = escapeString('a.b.c');
    expect(result).toContain('\\.');
  });

  it('returns empty string for null', () => {
    expect(escapeString(null)).toBe('');
  });

  it('returns empty string for non-string', () => {
    expect(escapeString(42)).toBe('');
  });

  it('returns plain string without special chars unchanged (trimmed)', () => {
    expect(escapeString('hello world')).toBe('hello world');
  });

  it('returns empty string for empty string', () => {
    expect(escapeString('')).toBe('');
  });
});

describe('validateStructuredInput', () => {
  it('returns isValid false for null data', () => {
    const result = validateStructuredInput(null, ['name']);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns isValid false for non-object data', () => {
    const result = validateStructuredInput('string', ['name']);
    expect(result.isValid).toBe(false);
  });

  it('returns isValid true for valid data with allowed fields', () => {
    const result = validateStructuredInput({ name: 'João', age: 30 }, ['name', 'age']);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('sanitizes string fields through sanitizeInput', () => {
    const result = validateStructuredInput({ name: '  hello  ' }, ['name']);
    expect(result.cleanData.name).toBe('hello');
  });

  it('preserves boolean and number fields', () => {
    const result = validateStructuredInput({ active: true, count: 5 }, ['active', 'count']);
    expect(result.cleanData.active).toBe(true);
    expect(result.cleanData.count).toBe(5);
  });

  it('filters out fields not in allowedFields', () => {
    const result = validateStructuredInput({ name: 'João', secret: 'hidden' }, ['name']);
    expect(result.cleanData.secret).toBeUndefined();
    expect(result.cleanData.name).toBe('João');
  });

  it('handles empty allowedFields — cleanData is empty', () => {
    const result = validateStructuredInput({ name: 'João' }, []);
    expect(result.cleanData).toEqual({});
    expect(result.isValid).toBe(true);
  });

  it('sanitizes array string elements', () => {
    const result = validateStructuredInput({ tags: ['  tag1  ', '  tag2  '] }, ['tags']);
    expect(result.cleanData.tags).toEqual(['tag1', 'tag2']);
  });
});
