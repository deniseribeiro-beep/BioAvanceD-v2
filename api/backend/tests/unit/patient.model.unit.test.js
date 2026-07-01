import { describe, it, expect } from 'vitest';
const PatientModel = require('../../src/models/Patient');

describe('PatientModel.isValidEmail', () => {
  it('returns true for valid email', () => {
    expect(PatientModel.isValidEmail('user@example.com')).toBe(true);
  });

  it('returns true for email with subdomain', () => {
    expect(PatientModel.isValidEmail('user@mail.example.com')).toBe(true);
  });

  it('returns false for null', () => {
    expect(PatientModel.isValidEmail(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(PatientModel.isValidEmail(undefined)).toBe(false);
  });

  it('returns false for string without @', () => {
    expect(PatientModel.isValidEmail('notanemail')).toBe(false);
  });

  it('returns false for missing domain', () => {
    expect(PatientModel.isValidEmail('user@')).toBe(false);
  });

  it('is case-insensitive (trims and lowercases)', () => {
    expect(PatientModel.isValidEmail('USER@EXAMPLE.COM')).toBe(true);
  });
});

describe('PatientModel.normalizePhone', () => {
  it('returns null for null', () => {
    expect(PatientModel.normalizePhone(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(PatientModel.normalizePhone(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(PatientModel.normalizePhone('')).toBeNull();
  });

  it('returns null when fewer than 10 digits', () => {
    expect(PatientModel.normalizePhone('123456789')).toBeNull();
  });

  it('returns null when more than 15 digits', () => {
    expect(PatientModel.normalizePhone('1234567890123456')).toBeNull();
  });

  it('strips non-digit characters', () => {
    expect(PatientModel.normalizePhone('(11) 98765-4321')).toBe('11987654321');
  });

  it('accepts numeric type', () => {
    const result = PatientModel.normalizePhone(11987654321);
    expect(result).toBe('11987654321');
  });
});

describe('PatientModel.validate', () => {
  const validData = {
    patientName: 'Maria Silva',
    birthDate: '1990-06-15',
    sex: 'F',
    clinicalUnit: 'HC-FMUSP',
    consentTemplateId: 'template-001',
    email: 'maria@example.com',
  };

  it('returns no errors for valid data', () => {
    const result = PatientModel.validate(validData);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('requires patientName', () => {
    const result = PatientModel.validate({ ...validData, patientName: '' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('patientName'))).toBe(true);
  });

  it('requires birthDate', () => {
    const { birthDate: _, ...data } = validData;
    const result = PatientModel.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('birthDate'))).toBe(true);
  });

  it('requires valid sex (M, F, or O)', () => {
    const result = PatientModel.validate({ ...validData, sex: 'X' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('sex'))).toBe(true);
  });

  it('accepts sex M', () => {
    const result = PatientModel.validate({ ...validData, sex: 'M' });
    expect(result.isValid).toBe(true);
  });

  it('accepts sex O', () => {
    const result = PatientModel.validate({ ...validData, sex: 'O' });
    expect(result.isValid).toBe(true);
  });
});
