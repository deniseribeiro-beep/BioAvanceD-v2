import { describe, it, expect } from 'vitest';
const engine = require('../../src/services/batch-validation-engine.service');

describe('BatchValidationEngine.normalizeHeader', () => {
  it('normalizes Portuguese header with accents', () => {
    expect(engine.normalizeHeader('Código Paciente')).toBe('codigopaciente');
  });

  it('lowercases and removes spaces', () => {
    expect(engine.normalizeHeader('Patient ID')).toBe('patientid');
  });

  it('returns empty string for null', () => {
    expect(engine.normalizeHeader(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(engine.normalizeHeader(undefined)).toBe('');
  });

  it('removes special characters like hyphens and underscores', () => {
    expect(engine.normalizeHeader('col-name_v2')).toBe('colnamev2');
  });
});

describe('BatchValidationEngine.normalizeText', () => {
  it('returns null for null', () => {
    expect(engine.normalizeText(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(engine.normalizeText(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(engine.normalizeText('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(engine.normalizeText('   ')).toBeNull();
  });

  it('trims and returns non-empty string', () => {
    expect(engine.normalizeText('  hello  ')).toBe('hello');
  });

  it('coerces numbers to string', () => {
    expect(engine.normalizeText(42)).toBe('42');
  });
});

describe('BatchValidationEngine.normalizeDigits', () => {
  it('returns null for null', () => {
    expect(engine.normalizeDigits(null)).toBeNull();
  });

  it('strips non-digit characters', () => {
    expect(engine.normalizeDigits('123.456.789-00')).toBe('12345678900');
  });

  it('returns digits-only string for numeric input', () => {
    expect(engine.normalizeDigits(12345)).toBe('12345');
  });

  it('returns null for empty string', () => {
    expect(engine.normalizeDigits('')).toBeNull();
  });

  it('returns null for string with no digits', () => {
    expect(engine.normalizeDigits('abc')).toBeNull();
  });
});

describe('BatchValidationEngine.normalizeCpf', () => {
  it('returns null for CPF with wrong digit count', () => {
    expect(engine.normalizeCpf('123')).toBeNull();
  });

  it('returns 11-digit string for valid formatted CPF', () => {
    expect(engine.normalizeCpf('123.456.789-00')).toBe('12345678900');
  });

  it('returns 11-digit string for unformatted CPF', () => {
    expect(engine.normalizeCpf('12345678900')).toBe('12345678900');
  });

  it('returns null for null', () => {
    expect(engine.normalizeCpf(null)).toBeNull();
  });
});

describe('BatchValidationEngine.normalizePatientID', () => {
  it('returns null for non-8-digit ID', () => {
    expect(engine.normalizePatientID('123')).toBeNull();
    expect(engine.normalizePatientID('123456789')).toBeNull();
  });

  it('returns 8-digit string for valid patientID', () => {
    expect(engine.normalizePatientID('12345678')).toBe('12345678');
  });

  it('extracts 8 digits from formatted string', () => {
    expect(engine.normalizePatientID('1234-5678')).toBe('12345678');
  });

  it('returns null for null', () => {
    expect(engine.normalizePatientID(null)).toBeNull();
  });
});

describe('BatchValidationEngine.parseNumericValue', () => {
  it('returns null for null', () => {
    expect(engine.parseNumericValue(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(engine.parseNumericValue('')).toBeNull();
  });

  it('parses integer', () => {
    expect(engine.parseNumericValue(42)).toBe(42);
  });

  it('parses float string', () => {
    expect(engine.parseNumericValue('3.14')).toBe(3.14);
  });

  it('parses Brazilian decimal format (comma separator)', () => {
    expect(engine.parseNumericValue('3,14')).toBe(3.14);
  });

  it('returns null for non-numeric string', () => {
    expect(engine.parseNumericValue('not-a-number')).toBeNull();
  });
});

describe('BatchValidationEngine.parseDateValue', () => {
  it('returns null for null', () => {
    expect(engine.parseDateValue(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(engine.parseDateValue(undefined)).toBeNull();
  });

  it('returns Date for ISO string', () => {
    const result = engine.parseDateValue('2026-01-15T00:00:00.000Z');
    expect(result).toBeInstanceOf(Date);
  });

  it('returns Date when given Date object', () => {
    const d = new Date('2026-06-30T00:00:00.000Z');
    expect(engine.parseDateValue(d)).toBe(d);
  });

  it('returns null for invalid date string', () => {
    expect(engine.parseDateValue('not-a-date')).toBeNull();
  });
});

describe('BatchValidationEngine.normalizeCoding', () => {
  it('returns null when both code and system cannot be resolved', () => {
    expect(engine.normalizeCoding(null, null, null)).toBeNull();
  });

  it('returns null when system is missing and fallback is null but code is present', () => {
    const result = engine.normalizeCoding({ code: 'X1', system: null }, null, null);
    expect(result).toBeNull();
  });

  it('returns coding object when code and system are present', () => {
    const result = engine.normalizeCoding({ code: 'HP:001', system: 'http://hpo.org' }, null, 'HPO Condition');
    expect(result).toHaveProperty('code', 'HP:001');
    expect(result).toHaveProperty('system', 'http://hpo.org');
    expect(result).toHaveProperty('display');
  });

  it('uses fallback system when raw has no system', () => {
    const result = engine.normalizeCoding({ code: 'ORPHA:123' }, 'http://orpha.net', 'Fabry Disease');
    expect(result.system).toBe('http://orpha.net');
  });

  it('uses fallback display when raw has no display', () => {
    const result = engine.normalizeCoding({ code: 'X1' }, 'http://example.com', 'My Label');
    expect(result.display).toBe('My Label');
  });
});

describe('BatchValidationEngine.extractSemanticCascadeFromRow', () => {
  it('returns empty disease/phenotypes/biomarkers for empty row', () => {
    const result = engine.extractSemanticCascadeFromRow({});
    expect(result.disease).toBeNull();
    expect(result.phenotypes).toHaveLength(0);
    expect(result.biomarkers).toHaveLength(0);
  });

  it('extracts ORPHA disease code from row', () => {
    const result = engine.extractSemanticCascadeFromRow({ orpha: 'ORPHA:123', orphaname: 'Fabry' });
    expect(result.disease).not.toBeNull();
    expect(result.disease.code).toContain('123');
  });

  it('extracts HPO phenotypes from semicolon-separated list', () => {
    const result = engine.extractSemanticCascadeFromRow({ hpo: 'HP:001;HP:002' });
    expect(result.phenotypes.length).toBeGreaterThan(0);
  });

  it('adds warning when phenotypes present without disease', () => {
    const result = engine.extractSemanticCascadeFromRow({ hpo: 'HP:001' });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('treats unknown column headers as no-match and returns null disease', () => {
    // 'Código Orpha' normalizes to 'codigoorpha' which doesn't match 'orpha'
    const result = engine.extractSemanticCascadeFromRow({ 'Código Orpha': 'ORPHA:999' });
    // behavior: unknown header → disease is null
    expect(result.disease).toBeNull();
  });
});
