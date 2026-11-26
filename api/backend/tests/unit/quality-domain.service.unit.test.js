import { describe, it, expect } from 'vitest';
const {
  QUALITY_RULE_VERSION,
  buildPenaltyLog,
  buildSprecCode,
  calculateMethodologyQualityFromSprec,
  evaluateQuality,
  missingQualificationContextFields,
  resolveMethodologicalQuality,
  validateQualityForRelease,
} = require('../../src/services/quality-domain.service');

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

  it('normalizes a null context to an empty object instead of throwing', () => {
    const result = calculateMethodologyQualityFromSprec(validFluidSprec, null);
    expect(result.matrix_type).toBe('solid');
  });

  it('normalizes an array context to an empty object instead of spreading array indices', () => {
    const result = calculateMethodologyQualityFromSprec(validFluidSprec, []);
    expect(result.matrix_type).toBe('solid');
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
    const result = validateQualityForRelease({ matrixType: 'fluid', sprec: validFluidSprec });
    expect(result.valid).toBe(true);
    expect(result.reason).toContain('aprovado');
    expect(result.assessment.final_grade).toBe('A');
  });
});

// RF018 AC2 and AC3 (#1320): the result carries the input it was computed
// from and, only when the request carries one, its use context.
describe('evaluateQuality rcs_input and qualification_context', () => {
  const rcsCertificationService = require('../../src/services/rcs-certification.service');
  const qualityCompatibility = require('../../src/services/quality-compatibility.service');
  const payload = { matrixType: 'fluid', sprec: validFluidSprec };

  it('resolveMethodologicalQuality carries rcs_input, the read set of the normalized payload', () => {
    const result = resolveMethodologicalQuality(payload);
    expect(result.rcs_input).toEqual(rcsCertificationService.readInput(qualityCompatibility.normalizeSample(payload)));
    expect(result.rcs_input).toMatchObject({ matrixType: 'fluid', sprec: expect.objectContaining({ sampleType: 'BLD' }) });
  });

  it('adds no qualification_context when the request carries none', () => {
    expect(evaluateQuality(payload)).not.toHaveProperty('qualification_context');
  });

  it('keeps exactly the five context keys, each a non-empty string or plain object, else null', () => {
    const result = evaluateQuality({
      ...payload,
      qualificationContext: {
        intendedUseCode: { systemUri: 'urn:synthetic:use', code: 'research-sequencing' },
        targetAnalyte: 'cfDNA',
        assayFamily: '  ',
        workflowProtocolId: 42,
        extra: 'dropped',
      },
    });
    expect(result.qualification_context).toEqual({
      intendedUseCode: { systemUri: 'urn:synthetic:use', code: 'research-sequencing' },
      targetAnalyte: 'cfDNA',
      assayFamily: null,
      workflowProtocolId: null,
      workflowProtocolVersion: null,
    });
  });

  it('reads the context from a sample wrapper too', () => {
    const result = evaluateQuality({ sample: { ...payload, qualificationContext: { targetAnalyte: 'cfDNA' } } });
    expect(result.qualification_context.targetAnalyte).toBe('cfDNA');
  });

  it('leaves the score, grade, route, penalties and trace as certify computes them', () => {
    const { rcs_input: _input, ...rest } = evaluateQuality(payload);
    expect(rest).toEqual({
      ...rcsCertificationService.certify(qualityCompatibility.normalizeSample(payload)),
      deprecated_legacy_fields: ['quality_score', 'quality_category', 'penalty_log', 'forcedQuarantine', 'category'],
    });
    expect(rest.final_grade).toBe('A');
  });
});

// RF018 AC2 (#1320): a sent use context must name all five fields.
describe('missingQualificationContextFields', () => {
  const complete = {
    intendedUseCode: 'research-sequencing', targetAnalyte: 'cfDNA', assayFamily: 'sequencing',
    workflowProtocolId: 'p1', workflowProtocolVersion: '1.0',
  };

  it('gives no field for a complete context', () => {
    expect(missingQualificationContextFields(complete)).toEqual([]);
  });

  it('gives the four absent fields of a partial context, in key order', () => {
    expect(missingQualificationContextFields({ targetAnalyte: 'DNA' })).toEqual([
      'intendedUseCode', 'assayFamily', 'workflowProtocolId', 'workflowProtocolVersion',
    ]);
  });

  it('counts an empty string, a blank string, an array and a number as missing', () => {
    expect(missingQualificationContextFields({
      ...complete, intendedUseCode: '', targetAnalyte: '  ', assayFamily: ['sequencing'], workflowProtocolId: 42,
    })).toEqual(['intendedUseCode', 'targetAnalyte', 'assayFamily', 'workflowProtocolId']);
  });

  it('counts a plain object as present', () => {
    expect(missingQualificationContextFields({
      ...complete, intendedUseCode: { systemUri: 'urn:synthetic:use', code: 'research-sequencing' },
    })).toEqual([]);
  });

  it('gives all five fields for null and for a string', () => {
    const all = ['intendedUseCode', 'targetAnalyte', 'assayFamily', 'workflowProtocolId', 'workflowProtocolVersion'];
    expect(missingQualificationContextFields(null)).toEqual(all);
    expect(missingQualificationContextFields('research-sequencing')).toEqual(all);
  });
});

// RCS-002: the same sample under two use contexts gives two results whose
// score, grade, route, trace and input are the same; only the context differs.
describe('RCS-002 mesma amostra, dois contextos, dois resultados', () => {
  it('keeps each context on its own result and moves nothing else', () => {
    const sprec = {
      matrixType: 'fluid', sampleType: 'SER', primaryContainer: 'SST', preCentrifugation: 'A', centrifugation: 'B',
      secondCentrifugation: 'N', postCentrifugationDelay: 'A', longTermStorage: 'A',
    };
    const sequencing = {
      intendedUseCode: 'research-sequencing', targetAnalyte: 'cfDNA', assayFamily: 'sequencing',
      workflowProtocolId: 'p1', workflowProtocolVersion: '1.0',
    };
    const proteomics = {
      intendedUseCode: 'research-proteomics', targetAnalyte: 'protein', assayFamily: 'mass-spectrometry',
      workflowProtocolId: 'p2', workflowProtocolVersion: '2.1',
    };
    const first = resolveMethodologicalQuality({ sprec, qualificationContext: sequencing });
    const second = resolveMethodologicalQuality({ sprec, qualificationContext: proteomics });

    expect(second.rcs_score).toEqual(first.rcs_score);
    expect(second.final_grade).toEqual(first.final_grade);
    expect(second.grade_route).toEqual(first.grade_route);
    expect(JSON.stringify(second.calculation_trace)).toBe(JSON.stringify(first.calculation_trace));
    expect(JSON.stringify(second.rcs_input)).toBe(JSON.stringify(first.rcs_input));
    expect(first.qualification_context).toEqual(sequencing);
    expect(second.qualification_context).toEqual(proteomics);
    expect(second.qualification_context).not.toEqual(first.qualification_context);
  });
});

// RNF018 AC5 (#1524): governanceEvidenceResolution comes only from the
// server's evidence resolver, through evaluateQuality's option.
describe('evaluateQuality governanceEvidenceResolution (RNF018 AC5, #1524)', () => {
  const rcsService = require('../../src/services/rcs-certification.service');
  const resolved = (kind) => [{ uri: `urn:bioavanced:${kind}:1`, hash: `sha256:${'0'.repeat(64)}`, status: 'resolved' }];
  const resolution = {
    traceability: resolved('custody-event'),
    monitoring: resolved('telemetry-exposure-summary'),
    documentation: resolved('collection-governance-approval'),
  };
  const evidenceFlags = (assessment) => {
    const evidence = rcsService.evaluateGovernanceEvidence(assessment.rcs_input);
    return [evidence.traceabilityOk, evidence.monitoringOk, evidence.documentationOk];
  };

  it('drops a client-sent resolution at the top level', () => {
    const assessment = evaluateQuality({ matrixType: 'fluid', sprec: validFluidSprec, governanceEvidenceResolution: resolution });
    expect(assessment.rcs_input).not.toHaveProperty('governanceEvidenceResolution');
    expect(evidenceFlags(assessment)).toEqual([null, null, null]);
  });

  it('drops a client-sent resolution inside sample', () => {
    const sample = { matrixType: 'fluid', sprec: validFluidSprec, governanceEvidenceResolution: resolution };
    const payload = { sample };
    const assessment = evaluateQuality(payload);
    expect(assessment.rcs_input).not.toHaveProperty('governanceEvidenceResolution');
    expect(evidenceFlags(assessment)).toEqual([null, null, null]);
    expect(payload.sample).toBe(sample);
    expect(sample.governanceEvidenceResolution).toBe(resolution);
  });

  it('carries the option resolution into rcs_input, at the top level and inside sample', () => {
    const top = evaluateQuality({ matrixType: 'fluid', sprec: validFluidSprec }, { governanceEvidenceResolution: resolution });
    expect(top.rcs_input.governanceEvidenceResolution).toEqual(resolution);
    expect(evidenceFlags(top)).toEqual([true, true, true]);
    const wrapped = evaluateQuality({ sample: { matrixType: 'fluid', sprec: validFluidSprec } }, { governanceEvidenceResolution: resolution });
    expect(wrapped.rcs_input.governanceEvidenceResolution).toEqual(resolution);
  });

  it('refuses certification when the option resolution has a non-resolved reference', () => {
    const failing = { ...resolution, monitoring: [{ ...resolution.monitoring[0], status: 'missing_hash' }] };
    const assessment = evaluateQuality({ matrixType: 'fluid', sprec: validFluidSprec }, { governanceEvidenceResolution: failing });
    expect(assessment).toMatchObject({ governance_status: 0, final_grade: 'E', governance_rule_codes: ['MISSING_REQUIRED_MONITORING'] });
  });

  it('ignores an option that is not a plain object', () => {
    const assessment = evaluateQuality({ matrixType: 'fluid', sprec: validFluidSprec }, { governanceEvidenceResolution: [resolution] });
    expect(assessment.rcs_input).not.toHaveProperty('governanceEvidenceResolution');
  });
});
