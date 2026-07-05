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

  it('rejects missing sex', () => {
    const { sex: _s, ...data } = validData;
    const result = PatientModel.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('vazio'))).toBe(true);
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

  it('requires email when not deceased', () => {
    const { email: _e, ...data } = validData;
    const result = PatientModel.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Email (email) é obrigatório'))).toBe(true);
  });

  it('rejects invalid email format', () => {
    const result = PatientModel.validate({ ...validData, email: 'not-an-email' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Email (email) inválido'))).toBe(true);
  });

  it('does not require email when isDeceased with valid representativeEmail', () => {
    const { email: _e, ...data } = validData;
    const result = PatientModel.validate({
      ...data,
      isDeceased: true,
      representativeEmail: 'rep@example.com'
    });
    expect(result.isValid).toBe(true);
  });

  it('requires representativeEmail when deceased', () => {
    const result = PatientModel.validate({ ...validData, isDeceased: true });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('representativeEmail'))).toBe(true);
  });

  it('rejects invalid representativeEmail when deceased', () => {
    const result = PatientModel.validate({
      ...validData,
      isDeceased: true,
      representativeEmail: 'bad-email'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Email do representante legal (representativeEmail) inválido'))).toBe(true);
  });

  it('rejects invalid phone', () => {
    const result = PatientModel.validate({ ...validData, phone: '123' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Telefone'))).toBe(true);
  });

  it('accepts valid phone', () => {
    const result = PatientModel.validate({ ...validData, phone: '11987654321' });
    expect(result.isValid).toBe(true);
  });

  it('rejects invalid recordNumber type', () => {
    const result = PatientModel.validate({ ...validData, recordNumber: {} });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('recordNumber'))).toBe(true);
  });

  it('accepts recordNumber as number or string', () => {
    expect(PatientModel.validate({ ...validData, recordNumber: 123 }).isValid).toBe(true);
    expect(PatientModel.validate({ ...validData, recordNumber: '123' }).isValid).toBe(true);
  });

  it('rejects invalid cpf type', () => {
    const result = PatientModel.validate({ ...validData, cpf: {} });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('CPF (cpf) deve ser texto ou número'))).toBe(true);
  });

  it('rejects cpf with wrong digit count', () => {
    const result = PatientModel.validate({ ...validData, cpf: '123' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('11 dígitos'))).toBe(true);
  });

  it('accepts valid 11-digit cpf', () => {
    const result = PatientModel.validate({ ...validData, cpf: '12345678901' });
    expect(result.isValid).toBe(true);
  });

  it('rejects clinicalUnit that is not a string', () => {
    const result = PatientModel.validate({ ...validData, clinicalUnit: 123 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('clinicalUnit deve ser string'))).toBe(true);
  });

  it('rejects clinicalUnitId that is not a string', () => {
    const result = PatientModel.validate({ ...validData, clinicalUnitId: 123 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('clinicalUnitId deve ser string'))).toBe(true);
  });

  it('rejects isDeceased that is not boolean', () => {
    const result = PatientModel.validate({ ...validData, isDeceased: 'yes' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('isDeceased deve ser boolean'))).toBe(true);
  });

  it('rejects representativeName that is not a string', () => {
    const result = PatientModel.validate({ ...validData, representativeName: 123 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('representativeName deve ser string'))).toBe(true);
  });

  it('rejects representativeCpf with wrong digit count', () => {
    const result = PatientModel.validate({ ...validData, representativeCpf: '123' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('representativeCpf deve conter 11 dígitos'))).toBe(true);
  });

  it('rejects representativeCpf that is not string/number', () => {
    const result = PatientModel.validate({ ...validData, representativeCpf: {} });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('representativeCpf deve ser texto ou número'))).toBe(true);
  });

  it('accepts valid representativeCpf', () => {
    const result = PatientModel.validate({ ...validData, representativeCpf: '12345678901' });
    expect(result.isValid).toBe(true);
  });

  it('rejects invalid representativePhone', () => {
    const result = PatientModel.validate({ ...validData, representativePhone: '123' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('representativePhone inválido'))).toBe(true);
  });

  it('rejects non-numeric weight', () => {
    const result = PatientModel.validate({ ...validData, weight: '70' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Peso (weight) deve ser um número'))).toBe(true);
  });

  it('rejects negative weight', () => {
    const result = PatientModel.validate({ ...validData, weight: -5 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('maior ou igual a zero'))).toBe(true);
  });

  it('accepts valid weight', () => {
    const result = PatientModel.validate({ ...validData, weight: 70 });
    expect(result.isValid).toBe(true);
  });

  it('rejects non-numeric heightCm', () => {
    const result = PatientModel.validate({ ...validData, heightCm: '170' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Altura (heightCm) deve ser um número'))).toBe(true);
  });

  it('rejects negative heightCm', () => {
    const result = PatientModel.validate({ ...validData, heightCm: -1 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Altura (heightCm) deve ser maior ou igual a zero'))).toBe(true);
  });

  it('rejects non-numeric lysoGb3', () => {
    const result = PatientModel.validate({ ...validData, lysoGb3: 'x' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Lyso-Gb3'))).toBe(true);
  });

  it('rejects negative lysoGb3', () => {
    const result = PatientModel.validate({ ...validData, lysoGb3: -1 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('não pode ser negativo'))).toBe(true);
  });

  it('rejects non-boolean values for boolean comorbidity fields', () => {
    const result = PatientModel.validate({ ...validData, hypertension: 'yes' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Hipertensão'))).toBe(true);
  });

  it('accepts boolean comorbidity fields', () => {
    const result = PatientModel.validate({ ...validData, hypertension: true, diabetesType2: false });
    expect(result.isValid).toBe(true);
  });

  it('rejects non-string geneticVariant', () => {
    const result = PatientModel.validate({ ...validData, geneticVariant: 123 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Variante genética'))).toBe(true);
  });

  it('rejects non-numeric alphaGal', () => {
    const result = PatientModel.validate({ ...validData, alphaGal: 'x' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('α-Galactosidase'))).toBe(true);
  });

  it('rejects negative alphaGal', () => {
    const result = PatientModel.validate({ ...validData, alphaGal: -1 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('não pode ser negativa'))).toBe(true);
  });

  it('rejects non-string icdCode', () => {
    const result = PatientModel.validate({ ...validData, icdCode: 123 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Código CID'))).toBe(true);
  });

  it('rejects non-string orphaCode', () => {
    const result = PatientModel.validate({ ...validData, orphaCode: 123 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Código ORPHA'))).toBe(true);
  });

  it('rejects non-string omimCode', () => {
    const result = PatientModel.validate({ ...validData, omimCode: 123 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Código OMIM'))).toBe(true);
  });

  it('rejects icdReference that is an array', () => {
    const result = PatientModel.validate({ ...validData, icdReference: [] });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('icdReference deve ser um objeto válido'))).toBe(true);
  });

  it('rejects icdReference that is not an object', () => {
    const result = PatientModel.validate({ ...validData, icdReference: 'x' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('icdReference deve ser um objeto válido'))).toBe(true);
  });

  it('rejects icdReference field that is not a string', () => {
    const result = PatientModel.validate({ ...validData, icdReference: { cidId: 123 } });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('icdReference.cidId deve ser string'))).toBe(true);
  });

  it('accepts valid icdReference', () => {
    const result = PatientModel.validate({
      ...validData,
      icdReference: { cidId: 'a', Codigo_Tabulacao: 'b', Codigos_CID10: 'c', Descricao: 'd', ORPHA: 'e', OMIM: 'f' }
    });
    expect(result.isValid).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = PatientModel.validate({ ...validData, status: 'BOGUS' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('status inválido'))).toBe(true);
  });

  it('accepts valid status values', () => {
    ['PENDING_CONSENT', 'ACTIVE', 'INACTIVE'].forEach((status) => {
      expect(PatientModel.validate({ ...validData, status }).isValid).toBe(true);
    });
  });

  it('rejects non-string consentToken', () => {
    const result = PatientModel.validate({ ...validData, consentToken: 123 });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('consentToken deve ser string'))).toBe(true);
  });

  it('rejects invalid consentAcceptedAt', () => {
    const result = PatientModel.validate({ ...validData, consentAcceptedAt: 'not-a-date' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('consentAcceptedAt deve ser uma data válida'))).toBe(true);
  });

  it('accepts valid consentAcceptedAt', () => {
    const result = PatientModel.validate({ ...validData, consentAcceptedAt: '2024-01-01T00:00:00Z' });
    expect(result.isValid).toBe(true);
  });

  it('rejects Date birthDate with invalid time', () => {
    const result = PatientModel.validate({ ...validData, birthDate: new Date('invalid') });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('inválida'))).toBe(true);
  });

  it('accepts Date instance for birthDate', () => {
    const result = PatientModel.validate({ ...validData, birthDate: new Date('1990-06-15') });
    expect(result.isValid).toBe(true);
  });
});

describe('PatientModel.create', () => {
  const baseData = {
    patientName: 'Maria Silva',
    birthDate: '15/06/1990',
    sex: 'F',
    consentTemplateId: 'template-001',
    email: 'Maria@Example.COM',
    phone: '(11) 98765-4321'
  };

  it('parses DD/MM/YYYY birthDate', () => {
    const result = PatientModel.create(baseData);
    expect(result.birthDate).toBeInstanceOf(Date);
    expect(result.birthDate.getFullYear()).toBe(1990);
    expect(result.birthDate.getMonth()).toBe(5);
    expect(result.birthDate.getDate()).toBe(15);
  });

  it('parses ISO birthDate string', () => {
    const result = PatientModel.create({ ...baseData, birthDate: '1990-06-15' });
    expect(result.birthDate).toBeInstanceOf(Date);
  });

  it('keeps Date instance birthDate as-is', () => {
    const d = new Date('1990-06-15');
    const result = PatientModel.create({ ...baseData, birthDate: d });
    expect(result.birthDate).toBe(d);
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

  it('converts height (meters) under 3 to centimeters', () => {
    const result = PatientModel.create({ ...baseData, height: 1.75 });
    expect(result.anamneseGeral.heightCm).toBe(175);
  });

  it('keeps height value as-is when already in centimeters', () => {
    const result = PatientModel.create({ ...baseData, height: 175 });
    expect(result.anamneseGeral.heightCm).toBe(175);
  });

  it('prefers explicit heightCm over height', () => {
    const result = PatientModel.create({ ...baseData, height: 1.75, heightCm: 180 });
    expect(result.anamneseGeral.heightCm).toBe(180);
  });

  it('ignores invalid height values', () => {
    const result = PatientModel.create({ ...baseData, height: 'not-a-number' });
    expect(result.anamneseGeral.heightCm).toBeNull();
  });

  it('moves Fabry-related loose fields into dadosEspecificos', () => {
    const result = PatientModel.create({
      ...baseData,
      geneticVariant: 'GLA c.1',
      alphaGal: 1.2,
      lysoGb3: 3.4,
      icdCode: 'E75.2'
    });
    expect(result.dadosEspecificos).toHaveLength(1);
    expect(result.dadosEspecificos[0].tipo).toBe('Fabry');
    expect(result.dadosEspecificos[0].dados.geneticVariant).toBe('GLA c.1');
    expect(result.dadosEspecificos[0].dados.icdCode).toBe('E75.2');
  });

  it('keeps existing dadosEspecificos array when already present', () => {
    const existing = [{ tipo: 'Other', dados: {} }];
    const result = PatientModel.create({
      ...baseData,
      dadosEspecificos: existing,
      geneticVariant: 'GLA c.1'
    });
    expect(result.dadosEspecificos).toBe(existing);
  });

  it('sets isDeceased boolean from truthy/falsy input', () => {
    expect(PatientModel.create({ ...baseData, isDeceased: true }).isDeceased).toBe(true);
    expect(PatientModel.create(baseData).isDeceased).toBe(false);
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
    expect(result.patientID).toBeNull();
    expect(result.recordNumber).toBeNull();
    expect(result.cpf).toBeNull();
    expect(result.clinicalUnitId).toBeNull();
    expect(result.clinicalUnit).toBeNull();
    expect(result.unitAcronym).toBeNull();
    expect(result.representativeName).toBeNull();
    expect(result.representativeEmail).toBeNull();
    expect(result.representativeCpf).toBeNull();
    expect(result.consentToken).toBeNull();
    expect(result.consentTokenCreatedAt).toBeNull();
    expect(result.consentTokenExpiresAt).toBeNull();
    expect(result.consentNotifiedAt).toBeNull();
    expect(result.consentAcceptedAt).toBeNull();
  });

  it('builds anamneseGeral with comorbidity defaults', () => {
    const result = PatientModel.create(baseData);
    expect(result.anamneseGeral.hypertension).toBe(false);
    expect(result.anamneseGeral.comorbidades).toEqual([]);
    expect(result.anamneseGeral.tipoSanguineo).toBeNull();
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
