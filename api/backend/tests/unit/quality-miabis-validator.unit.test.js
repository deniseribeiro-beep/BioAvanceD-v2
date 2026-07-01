import { describe, it, expect } from 'vitest';
const {
  validateQualityMIABIS,
  validateQualityMIABISOrThrow,
  parseQualityMIABIS,
  getQualityMIABISDescriptionPT,
  getQualityMIABISDescriptionEN,
} = require('../../src/utils/qualityMIABISValidator');

describe('validateQualityMIABIS', () => {
  it('returns true for GOOD', () => {
    expect(validateQualityMIABIS('GOOD')).toBe(true);
  });

  it('returns true for COMPROMISED', () => {
    expect(validateQualityMIABIS('COMPROMISED')).toBe(true);
  });

  it('returns true for UNKNOWN', () => {
    expect(validateQualityMIABIS('UNKNOWN')).toBe(true);
  });

  it('returns false for non-string', () => {
    expect(validateQualityMIABIS(1)).toBe(false);
    expect(validateQualityMIABIS(null)).toBe(false);
    expect(validateQualityMIABIS(undefined)).toBe(false);
  });

  it('returns false for invalid string', () => {
    expect(validateQualityMIABIS('INVALID')).toBe(false);
    expect(validateQualityMIABIS('')).toBe(false);
  });

  it('trims whitespace before checking', () => {
    expect(validateQualityMIABIS('  GOOD  ')).toBe(true);
  });
});

describe('validateQualityMIABISOrThrow', () => {
  it('does not throw for valid MIABIS value', () => {
    expect(() => validateQualityMIABISOrThrow('GOOD')).not.toThrow();
    expect(() => validateQualityMIABISOrThrow('COMPROMISED')).not.toThrow();
    expect(() => validateQualityMIABISOrThrow('UNKNOWN')).not.toThrow();
  });

  it('throws for invalid value', () => {
    expect(() => validateQualityMIABISOrThrow('BAD')).toThrow();
  });

  it('throws for null', () => {
    expect(() => validateQualityMIABISOrThrow(null)).toThrow();
  });

  it('error message includes valid values', () => {
    try {
      validateQualityMIABISOrThrow('BAD');
    } catch (e) {
      expect(e.message).toContain('GOOD');
    }
  });
});

describe('parseQualityMIABIS', () => {
  it('returns null for undefined', () => {
    expect(parseQualityMIABIS(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(parseQualityMIABIS(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseQualityMIABIS('')).toBeNull();
  });

  it('returns GOOD for string GOOD', () => {
    expect(parseQualityMIABIS('GOOD')).toBe('GOOD');
  });

  it('returns COMPROMISED for string COMPROMISED', () => {
    expect(parseQualityMIABIS('COMPROMISED')).toBe('COMPROMISED');
  });

  it('returns UNKNOWN for string UNKNOWN', () => {
    expect(parseQualityMIABIS('UNKNOWN')).toBe('UNKNOWN');
  });

  it('converts legacy string "0" to UNKNOWN', () => {
    expect(parseQualityMIABIS('0')).toBe('UNKNOWN');
  });

  it('converts legacy string "1" to GOOD', () => {
    expect(parseQualityMIABIS('1')).toBe('GOOD');
  });

  it('converts legacy string "2" to COMPROMISED', () => {
    expect(parseQualityMIABIS('2')).toBe('COMPROMISED');
  });

  it('converts legacy number 0 to UNKNOWN', () => {
    expect(parseQualityMIABIS(0)).toBe('UNKNOWN');
  });

  it('converts legacy number 1 to GOOD', () => {
    expect(parseQualityMIABIS(1)).toBe('GOOD');
  });

  it('converts legacy number 2 to COMPROMISED', () => {
    expect(parseQualityMIABIS(2)).toBe('COMPROMISED');
  });

  it('returns null for unknown number', () => {
    expect(parseQualityMIABIS(99)).toBeNull();
  });

  it('returns null for unknown string', () => {
    expect(parseQualityMIABIS('INVALID')).toBeNull();
  });

  it('returns null for boolean', () => {
    expect(parseQualityMIABIS(true)).toBeNull();
  });
});

describe('getQualityMIABISDescriptionPT', () => {
  it('returns Portuguese description for GOOD', () => {
    const result = getQualityMIABISDescriptionPT('GOOD');
    expect(typeof result).toBe('string');
    expect(result).not.toBe('Inválido');
  });

  it('returns Portuguese description for COMPROMISED', () => {
    const result = getQualityMIABISDescriptionPT('COMPROMISED');
    expect(result).not.toBe('Inválido');
  });

  it('returns Inválido for unknown value', () => {
    expect(getQualityMIABISDescriptionPT('NOTVALID')).toBe('Inválido');
  });
});

describe('getQualityMIABISDescriptionEN', () => {
  it('returns Suitable for GOOD', () => {
    expect(getQualityMIABISDescriptionEN('GOOD')).toBe('Suitable');
  });

  it('returns Compromised for COMPROMISED', () => {
    expect(getQualityMIABISDescriptionEN('COMPROMISED')).toBe('Compromised');
  });

  it('returns Not assessed for UNKNOWN', () => {
    expect(getQualityMIABISDescriptionEN('UNKNOWN')).toBe('Not assessed');
  });

  it('returns Invalid for unknown value', () => {
    expect(getQualityMIABISDescriptionEN('BAD')).toBe('Invalid');
  });
});
