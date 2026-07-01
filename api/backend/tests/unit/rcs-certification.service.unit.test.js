import { describe, it, expect } from 'vitest';
const rcsCertificationService = require('../../src/services/rcs-certification.service');

describe('RcsCertificationService.detectMatrixType', () => {
  it('returns fluid for explicit fluid type', () => {
    expect(rcsCertificationService.detectMatrixType({ matrix_type: 'fluid' })).toBe('fluid');
  });

  it('returns solid for explicit solid type', () => {
    expect(rcsCertificationService.detectMatrixType({ matrix_type: 'solid' })).toBe('solid');
  });

  it('infers fluid from sampleType containing plasma', () => {
    expect(rcsCertificationService.detectMatrixType({ sampleType: 'plasma' })).toBe('fluid');
  });

  it('infers fluid from sampleType containing serum', () => {
    expect(rcsCertificationService.detectMatrixType({ sampleType: 'serum sample' })).toBe('fluid');
  });

  it('infers solid from sampleType containing tissue', () => {
    expect(rcsCertificationService.detectMatrixType({ sampleType: 'tissue biopsy' })).toBe('solid');
  });

  it('infers solid when fixation data is present', () => {
    expect(rcsCertificationService.detectMatrixType({}, { fixationType: 'FFPE' })).toBe('solid');
  });

  it('returns null for unknown type', () => {
    expect(rcsCertificationService.detectMatrixType({})).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(rcsCertificationService.detectMatrixType({ matrix_type: 'FLUID' })).toBe('fluid');
    expect(rcsCertificationService.detectMatrixType({ matrix_type: 'SOLID' })).toBe('solid');
  });
});

describe('RcsCertificationService.normalizeSprec', () => {
  it('returns object with matrix_type field', () => {
    const result = rcsCertificationService.normalizeSprec({ sprec: { matrix_type: 'fluid' } });
    expect(result).toHaveProperty('matrix_type', 'fluid');
  });

  it('normalizes sampleType to uppercase', () => {
    const result = rcsCertificationService.normalizeSprec({ sprec: { sampleType: 'plasma' } });
    expect(result.sampleType).toBe('PLASMA');
  });

  it('returns empty matrix_type when not fluid or solid', () => {
    const result = rcsCertificationService.normalizeSprec({ sprec: { matrix_type: 'gas' } });
    expect(result.matrix_type).toBe('');
  });

  it('handles empty payload', () => {
    const result = rcsCertificationService.normalizeSprec({});
    expect(result).toHaveProperty('matrix_type', '');
    expect(result).toHaveProperty('sampleType', '');
  });
});

describe('RcsCertificationService.certify', () => {
  it('returns governance_status of 0 for empty payload (missing matrix type)', () => {
    const result = rcsCertificationService.certify({});
    expect(result).toHaveProperty('governance_status');
    // Missing matrix type → governance failure
    expect(result.governance_status).toBe(0);
  });

  it('returns governance_status of 0 when matrix type undetectable', () => {
    const result = rcsCertificationService.certify({ sample: {} });
    expect(result.governance_status).toBe(0);
  });

  it('returns object with model_version field', () => {
    const result = rcsCertificationService.certify({});
    expect(result).toHaveProperty('model_version');
  });

  it('returns axis_penalties as array', () => {
    const result = rcsCertificationService.certify({});
    expect(Array.isArray(result.axis_penalties)).toBe(true);
  });

  it('returns governance_failure_reasons as array when failing', () => {
    const result = rcsCertificationService.certify({});
    expect(Array.isArray(result.governance_failure_reasons)).toBe(true);
    expect(result.governance_failure_reasons.length).toBeGreaterThan(0);
  });
});

describe('RcsCertificationService constants', () => {
  it('exports referenceData with model_code', () => {
    const { referenceData } = require('../../src/services/rcs-certification.service');
    expect(referenceData).toHaveProperty('model_code');
  });

  it('exports AXES with fluid and solid keys', () => {
    const { AXES } = require('../../src/services/rcs-certification.service');
    expect(AXES).toHaveProperty('fluid');
    expect(AXES).toHaveProperty('solid');
    expect(Array.isArray(AXES.fluid)).toBe(true);
    expect(Array.isArray(AXES.solid)).toBe(true);
  });
});
