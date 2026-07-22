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
    participantId: 'P-001',
    patientName: 'Maria Silva',
    birthDate: '1990-06-15',
    sex: 'F',
    consentTemplateId: 'template-001',
  };

  it('returns no errors for valid data', () => {
    const result = PatientModel.validate(validData);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('requires participantId', () => {
    const { participantId: _p, ...data } = validData;
    const result = PatientModel.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('participantId'))).toBe(true);
  });

  it('rejects blank participantId', () => {
    const result = PatientModel.validate({ ...validData, participantId: '   ' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('participantId'))).toBe(true);
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

  it('rejects Date birthDate with invalid time', () => {
    const result = PatientModel.validate({ ...validData, birthDate: new Date('invalid') });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('birthDate'))).toBe(true);
  });

  it('accepts Date instance for birthDate', () => {
    const result = PatientModel.validate({ ...validData, birthDate: new Date('1990-06-15') });
    expect(result.isValid).toBe(true);
  });

  it('requires sex', () => {
    const { sex: _s, ...data } = validData;
    const result = PatientModel.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('sex'))).toBe(true);
  });

  it('does not restrict sex to an enum', () => {
    const result = PatientModel.validate({ ...validData, sex: 'X' });
    expect(result.isValid).toBe(true);
  });

  it('requires consentTemplateId', () => {
    const { consentTemplateId: _c, ...data } = validData;
    const result = PatientModel.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('consentTemplateId'))).toBe(true);
  });

  it('rejects blank consentTemplateId', () => {
    const result = PatientModel.validate({ ...validData, consentTemplateId: '   ' });
    expect(result.isValid).toBe(false);
  });

  it('does not require email', () => {
    const result = PatientModel.validate(validData);
    expect(result.isValid).toBe(true);
  });

  it('rejects invalid email format', () => {
    const result = PatientModel.validate({ ...validData, email: 'not-an-email' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('email inválido'))).toBe(true);
  });

  it('accepts a valid email', () => {
    const result = PatientModel.validate({ ...validData, email: 'maria@example.com' });
    expect(result.isValid).toBe(true);
  });

  it('rejects invalid representativeEmail format', () => {
    const result = PatientModel.validate({ ...validData, representativeEmail: 'bad-email' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('representativeEmail inválido'))).toBe(true);
  });

  it('accepts a valid representativeEmail', () => {
    const result = PatientModel.validate({ ...validData, representativeEmail: 'rep@example.com' });
    expect(result.isValid).toBe(true);
  });

  it('rejects a non-canonical field', () => {
    const result = PatientModel.validate({ ...validData, cpf: '12345678901' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Campo não canônico: cpf'))).toBe(true);
  });

  it('accepts all canonical optional fields together', () => {
    const result = PatientModel.validate({
      ...validData,
      email: 'maria@example.com',
      phone: '11987654321',
      identityDocument: '12345678901',
      recordNumber: '123',
      clinicalUnitId: 'unit-1',
      clinicalUnit: 'HC-FMUSP',
      unitAcronym: 'HCFMUSP',
      isDeceased: false,
      representativeName: 'Joao',
      representativeEmail: 'rep@example.com',
      representativeIdentityDocument: '98765432100',
      representativePhone: '11987654321',
      status: 'ACTIVE',
      consentToken: 'tok',
      consentTokenCreatedAt: new Date(),
      consentTokenExpiresAt: new Date(),
      consentNotifiedAt: new Date(),
      consentAcceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      anamneseGeral: {},
      dadosEspecificos: [],
    });
    expect(result.isValid).toBe(true);
  });
});

describe('PatientModel.create', () => {
  const baseData = {
    participantId: 'P-001',
    patientName: 'Maria Silva',
    birthDate: '1990-06-15',
    sex: 'F',
    consentTemplateId: 'template-001',
    email: 'Maria@Example.COM',
    phone: '(11) 98765-4321'
  };

  it('throws when a non-canonical field is provided', () => {
    expect(() => PatientModel.create({ ...baseData, cpf: '12345678901' })).toThrow('Payload contém campos não canônicos');
  });

  it('sets statusCode/code/fields on the non-canonical field error', () => {
    try {
      PatientModel.create({ ...baseData, cpf: '12345678901' });
      throw new Error('expected create to throw');
    } catch (error) {
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe('NON_CANONICAL_FIELD');
      expect(error.fields).toEqual(['cpf']);
    }
  });

  it('throws when required fields are missing', () => {
    const { participantId: _p, ...data } = baseData;
    expect(() => PatientModel.create(data)).toThrow('participantId é obrigatório');
  });

  it('parses ISO birthDate string', () => {
    const result = PatientModel.create(baseData);
    expect(result.birthDate).toBeInstanceOf(Date);
    expect(result.birthDate.getFullYear()).toBe(1990);
  });

  it('re-wraps a Date instance birthDate to an equivalent Date', () => {
    const d = new Date('1990-06-15');
    const result = PatientModel.create({ ...baseData, birthDate: d });
    expect(result.birthDate).toEqual(d);
  });

  it('normalizes email to lowercase/trimmed', () => {
    const result = PatientModel.create(baseData);
    expect(result.email).toBe('maria@example.com');
  });

  it('normalizes phone digits', () => {
    const result = PatientModel.create(baseData);
    expect(result.phone).toBe('11987654321');
  });

  it('defaults status to PENDING_CONSENT', () => {
    const result = PatientModel.create(baseData);
    expect(result.status).toBe('PENDING_CONSENT');
  });

  it('respects a provided status', () => {
    const result = PatientModel.create({ ...baseData, status: 'ACTIVE' });
    expect(result.status).toBe('ACTIVE');
  });

  it('sets isDeceased boolean from truthy/falsy input', () => {
    expect(PatientModel.create({ ...baseData, isDeceased: true }).isDeceased).toBe(true);
    expect(PatientModel.create(baseData).isDeceased).toBe(false);
  });

  it('trims identityDocument to a string', () => {
    const result = PatientModel.create({ ...baseData, identityDocument: ' 12345678901 ' });
    expect(result.identityDocument).toBe('12345678901');
  });

  it('normalizes representativePhone', () => {
    const result = PatientModel.create({ ...baseData, representativePhone: '(21) 91234-5678' });
    expect(result.representativePhone).toBe('21912345678');
  });

  it('sets consentToken date fields when provided', () => {
    const result = PatientModel.create({
      ...baseData,
      consentTokenCreatedAt: '2024-01-01',
      consentTokenExpiresAt: '2024-02-01',
      consentNotifiedAt: '2024-01-02',
      consentAcceptedAt: '2024-01-03'
    });
    expect(result.consentTokenCreatedAt).toBeInstanceOf(Date);
    expect(result.consentTokenExpiresAt).toBeInstanceOf(Date);
    expect(result.consentNotifiedAt).toBeInstanceOf(Date);
    expect(result.consentAcceptedAt).toBeInstanceOf(Date);
  });

  it('defaults optional fields to null when absent', () => {
    const result = PatientModel.create(baseData);
    expect(result.recordNumber).toBeNull();
    expect(result.identityDocument).toBeNull();
    expect(result.clinicalUnitId).toBeNull();
    expect(result.clinicalUnit).toBeNull();
    expect(result.unitAcronym).toBeNull();
    expect(result.representativeName).toBeNull();
    expect(result.representativeEmail).toBeNull();
    expect(result.representativeIdentityDocument).toBeNull();
    expect(result.consentToken).toBeNull();
    expect(result.consentTokenCreatedAt).toBeNull();
    expect(result.consentTokenExpiresAt).toBeNull();
    expect(result.consentNotifiedAt).toBeNull();
    expect(result.consentAcceptedAt).toBeNull();
  });

  it('defaults anamneseGeral to null and dadosEspecificos to an empty array when absent', () => {
    const result = PatientModel.create(baseData);
    expect(result.anamneseGeral).toBeNull();
    expect(result.dadosEspecificos).toEqual([]);
  });

  it('passes through anamneseGeral/dadosEspecificos when provided', () => {
    const anamneseGeral = { hypertension: true };
    const dadosEspecificos = [{ tipo: 'Fabry', dados: {} }];
    const result = PatientModel.create({ ...baseData, anamneseGeral, dadosEspecificos });
    expect(result.anamneseGeral).toBe(anamneseGeral);
    expect(result.dadosEspecificos).toBe(dadosEspecificos);
  });
});

describe('PatientModel.validateUnit', () => {
  it('returns true for a non-empty string', () => {
    expect(PatientModel.validateUnit('HC-FMUSP')).toBe(true);
  });

  it('returns falsy for null', () => {
    expect(PatientModel.validateUnit(null)).toBeFalsy();
  });

  it('returns falsy for empty string', () => {
    expect(PatientModel.validateUnit('')).toBeFalsy();
  });

  it('returns false for non-string', () => {
    expect(PatientModel.validateUnit(123)).toBe(false);
  });
});

describe('PatientModel.fillAcronym', () => {
  it('returns null for falsy input', () => {
    expect(PatientModel.fillAcronym(null)).toBeNull();
    expect(PatientModel.fillAcronym('')).toBeNull();
  });

  it('builds initials from relevant words, skipping stop words', () => {
    expect(PatientModel.fillAcronym('Hospital das Clinicas de Sao Paulo')).toBe('HCSP');
  });

  it('strips accents before building initials', () => {
    expect(PatientModel.fillAcronym('Ámbito Médico')).toBe('AM');
  });

  it('falls back to all words when every word is a stop word', () => {
    expect(PatientModel.fillAcronym('de da do')).toBe('DDD');
  });

  it('truncates to 6 initials for long names', () => {
    const result = PatientModel.fillAcronym('Alpha Beta Gamma Delta Epsilon Zeta Eta Theta');
    expect(result).toHaveLength(6);
  });

  it('returns null when normalized string is empty (whitespace only)', () => {
    expect(PatientModel.fillAcronym('   ')).toBeNull();
  });
});
