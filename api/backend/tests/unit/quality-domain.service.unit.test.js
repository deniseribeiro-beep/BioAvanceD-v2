import { describe, it, expect } from 'vitest';
const {
  QUALITY_RULE_VERSION,
  buildPenaltyLog,
  buildSprecCode,
  calculateMethodologyQualityFromSprec,
  evaluateQuality,
  resolveMethodologicalQuality,
  validateQualityForRelease,
} = require('../../src/services/quality-domain.service');

const referenceData = require('../../src/services/rcs-reference-data');

function admissibleGovernanceEvidence() {
  return Object.fromEntries(
    referenceData.governanceEvidenceCategories.map(({ key }) => [key, 'satisfied'])
  );
}

const validFluidSprec = {
  sampleType: 'BLD', primaryContainer: 'SST', preCentrifugation: 'A',
  centrifugation: 'A', secondCentrifugation: 'A', postCentrifugationDelay: 'A', longTermStorage: 'C',
};

describe('QUALITY_RULE_VERSION', () => {
  it('is a non-empty string', () => {
    expect(typeof QUALITY_RULE_VERSION).toBe('string');
    expect(QUALITY_RULE_VERSION.length).toBeGreaterThan(0);
  });
});

describe('buildPenaltyLog', () => {
  it('returns empty array for empty assessment', () => {
    expect(buildPenaltyLog({})).toEqual([]);
  });

  it('returns formatted strings for axis_penalties', () => {
    const assessment = {
      axis_penalties: [
        { axis_code: 'P', sprec_code: 'A', penalty: 5 },
        { axis_code: 'C', sprec_code: 'B', penalty: 10 },
      ],
    };
    const result = buildPenaltyLog(assessment);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('P');
    expect(result[0]).toContain('A');
    expect(result[0]).toContain('5');
  });

  it('reads from rcsCertification.axis_penalties when direct array is missing', () => {
    const assessment = {
      rcsCertification: {
        axis_penalties: [{ axis_code: 'X', sprec_code: 'Y', penalty: 3 }],
      },
    };
    const result = buildPenaltyLog(assessment);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('X');
  });

  it('returns empty array for missing axis_penalties', () => {
    expect(buildPenaltyLog({ other: true })).toEqual([]);
  });
});

describe('buildSprecCode', () => {
  it('returns X-X-X-X-X-X-X for empty sprec', () => {
    const code = buildSprecCode({});
    expect(code).toBe('X-X-X-X-X-X-X');
  });

  it('builds code from sprec parts', () => {
    const sprec = {
      sampleType: { code: 'B' },
      primaryContainer: { code: 'P' },
      preCentrifugation: { code: 'A' },
      centrifugation: { code: 'C' },
      secondCentrifugation: { code: 'S' },
      postCentrifugationDelay: { code: 'D' },
      longTermStorage: { code: 'L' },
    };
    const code = buildSprecCode(sprec);
    expect(code).toBe('B-P-A-C-S-D-L');
  });

  it('handles string values (not objects with code)', () => {
    const sprec = { sampleType: 'B', longTermStorage: 'L' };
    const code = buildSprecCode(sprec);
    expect(code).toContain('B');
    expect(code).toContain('L');
  });

  it('falls back to X for a whitespace-only part that trims to empty', () => {
    const code = buildSprecCode({ sampleType: '   ' });
    expect(code.split('-')[0]).toBe('X');
  });
});

describe('evaluateQuality', () => {
  it('returns an object with governance_status', () => {
    const result = evaluateQuality({});
    expect(result).toHaveProperty('governance_status');
  });

  it('returns deprecated_legacy_fields array', () => {
    const result = evaluateQuality({});
    expect(Array.isArray(result.deprecated_legacy_fields)).toBe(true);
    expect(result.deprecated_legacy_fields.length).toBeGreaterThan(0);
  });

  it('handles null input gracefully', () => {
    expect(() => evaluateQuality(null)).not.toThrow();
  });
});

describe('resolveMethodologicalQuality', () => {
  it('returns quality assessment with final_grade', () => {
    const result = resolveMethodologicalQuality({ sprec: {} });
    expect(result).toHaveProperty('governance_status');
  });
});

describe('calculateMethodologyQualityFromSprec', () => {
  it('merges sprec into a valid context object', () => {
    const result = calculateMethodologyQualityFromSprec(validFluidSprec, { matrixType: 'fluid' });
    expect(result.matrix_type).toBe('fluid');
  });

  it('does not infer matrix type when a null context omits the explicit matrix', () => {
    const result = calculateMethodologyQualityFromSprec(validFluidSprec, null);
    expect(result.input_status).toBe('invalid');
    expect(result.matrix_type).toBe('unknown');
  });

  it('does not infer matrix type when an array context omits the explicit matrix', () => {
    const result = calculateMethodologyQualityFromSprec(validFluidSprec, []);
    expect(result.input_status).toBe('invalid');
    expect(result.matrix_type).toBe('unknown');
  });
});

describe('validateQualityForRelease', () => {
  it('returns an object with valid, reason, and assessment', () => {
    const result = validateQualityForRelease({});
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('assessment');
    expect(typeof result.valid).toBe('boolean');
  });

  it('handles null input gracefully', () => {
    expect(() => validateQualityForRelease(null)).not.toThrow();
  });

  it('returns valid: true with an approved reason when governance passes with grade A-D', () => {
    const result = validateQualityForRelease({
      matrixType: 'fluid',
      sprec: validFluidSprec,
      governanceEvidence: admissibleGovernanceEvidence(),
    });
    expect(result.valid).toBe(true);
    expect(result.reason).toContain('aprovado');
    expect(result.assessment.final_grade).toBe('A');
  });
});


describe('scientific RCS input reconciliation', () => {
  it('blocks release when explicit governance evidence is missing', () => {
    const result = validateQualityForRelease({ matrixType: 'fluid', sprec: validFluidSprec });

    expect(result.valid).toBe(false);
    expect(result.assessment.input_status).toBe('invalid');
    expect(result.assessment.final_grade).toBeNull();
    expect(result.reason).toContain('entrada inválida');
  });
});
