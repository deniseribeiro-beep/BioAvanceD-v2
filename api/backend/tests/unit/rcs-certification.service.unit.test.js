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

describe('RcsCertificationService.normalizeCode with object-shaped values', () => {
  it('unwraps a {code} object into its code string', () => {
    const result = rcsCertificationService.normalizeSprec({ sprec: { sampleType: { code: 'bld' } } });
    expect(result.sampleType).toBe('BLD');
  });

  it('unwraps a {value} object into its value string when code is absent', () => {
    const result = rcsCertificationService.normalizeSprec({ sprec: { sampleType: { value: 'tis' } } });
    expect(result.sampleType).toBe('TIS');
  });

  it('unwraps an object with neither code nor value to empty string', () => {
    const result = rcsCertificationService.normalizeSprec({ sprec: { sampleType: { other: 'x' } } });
    expect(result.sampleType).toBe('');
  });
});

describe('RcsCertificationService.certify with nested sample payload', () => {
  it('reads matrixType/sprec from payload.sample when present', () => {
    const result = rcsCertificationService.certify({
      sample: {
        matrixType: 'fluid',
        sprec: {
          sampleType: 'BLD', primaryContainer: 'SST', preCentrifugation: 'A',
          centrifugation: 'A', secondCentrifugation: 'A', postCentrifugationDelay: 'A', longTermStorage: 'C',
        },
      },
    });
    expect(result.matrix_type).toBe('fluid');
    expect(result.governance_status).toBe(1);
  });
});

describe('RcsCertificationService.evaluateGovernance extra reasons', () => {
  const validFluid = {
    matrixType: 'fluid',
    sprec: {
      sampleType: 'BLD', primaryContainer: 'SST', preCentrifugation: 'A',
      centrifugation: 'A', secondCentrifugation: 'A', postCentrifugationDelay: 'A', longTermStorage: 'C',
    },
  };

  it('fails on documentationSufficient === false', () => {
    const result = rcsCertificationService.certify({ ...validFluid, documentationSufficient: false });
    expect(result.governance_failure_reasons).toContain('Insufficient documentation');
  });

  it('fails on documentation_insufficient === true (snake_case)', () => {
    const result = rcsCertificationService.certify({ ...validFluid, documentation_insufficient: true });
    expect(result.governance_failure_reasons).toContain('Insufficient documentation');
  });

  it('fails on traceabilitySufficient === false', () => {
    const result = rcsCertificationService.certify({ ...validFluid, traceabilitySufficient: false });
    expect(result.governance_failure_reasons).toContain('Insufficient traceability');
  });

  it('fails on traceability_insufficient === true (snake_case)', () => {
    const result = rcsCertificationService.certify({ ...validFluid, traceability_insufficient: true });
    expect(result.governance_failure_reasons).toContain('Insufficient traceability');
  });

  it('fails on traceabilityBroken === true', () => {
    const result = rcsCertificationService.certify({ ...validFluid, traceabilityBroken: true });
    expect(result.governance_failure_reasons).toContain('Insufficient traceability');
  });

  it('fails on monitoringRequired === true without monitoringPresent', () => {
    const result = rcsCertificationService.certify({ ...validFluid, monitoringRequired: true });
    expect(result.governance_failure_reasons).toContain('Missing required monitoring');
  });

  it('fails on monitoring_required === true (snake_case) without monitoring_present', () => {
    const result = rcsCertificationService.certify({ ...validFluid, monitoring_required: true });
    expect(result.governance_failure_reasons).toContain('Missing required monitoring');
  });

  it('does not fail monitoring when monitoringRequired and monitoringPresent are both true', () => {
    const result = rcsCertificationService.certify({ ...validFluid, monitoringRequired: true, monitoringPresent: true });
    expect(result.governance_failure_reasons).not.toContain('Missing required monitoring');
  });

  it('does not fail monitoring when monitoring_required and monitoring_present are both true (snake_case)', () => {
    const result = rcsCertificationService.certify({ ...validFluid, monitoring_required: true, monitoring_present: true });
    expect(result.governance_failure_reasons).not.toContain('Missing required monitoring');
  });

  it('fails on semanticIncompatibility === true', () => {
    const result = rcsCertificationService.certify({ ...validFluid, semanticIncompatibility: true });
    expect(result.governance_failure_reasons).toContain('Semantic incompatibility between matrix, SPREC axis, event, or context');
  });

  it('fails on semantic_incompatibility === true (snake_case)', () => {
    const result = rcsCertificationService.certify({ ...validFluid, semantic_incompatibility: true });
    expect(result.governance_failure_reasons).toContain('Semantic incompatibility between matrix, SPREC axis, event, or context');
  });
});

describe('RcsCertificationService.resolveWorkflowRule implicit acceptability flags', () => {
  it('accepts Pcent1=N without workflow context when primaryCentrifugationApplicable is false', () => {
    const result = rcsCertificationService.certify({
      matrixType: 'fluid',
      sprec: {
        sampleType: 'BLD', primaryContainer: 'SST', preCentrifugation: 'A',
        centrifugation: 'N', secondCentrifugation: 'A', postCentrifugationDelay: 'A', longTermStorage: 'C',
      },
      primaryCentrifugationApplicable: false,
    });
    expect(result.governance_status).toBe(1);
  });

  it('accepts Pcent2=N without workflow context when secondCentrifugationRequired is false', () => {
    const result = rcsCertificationService.certify({
      matrixType: 'fluid',
      sprec: {
        sampleType: 'BLD', primaryContainer: 'SST', preCentrifugation: 'A',
        centrifugation: 'A', secondCentrifugation: 'N', postCentrifugationDelay: 'A', longTermStorage: 'C',
      },
      secondCentrifugationRequired: false,
    });
    expect(result.governance_status).toBe(1);
  });
});

describe('RcsCertificationService throws on misconfigured reference data', () => {
  const { RcsCertificationService } = rcsCertificationService;
  const referenceData = require('../../src/services/rcs-reference-data');

  it('findWeight throws when a matrix/axis weight is missing from the seed', () => {
    const brokenData = { ...referenceData, weights: referenceData.weights.filter((w) => !(w.matrix_type === 'fluid' && w.axis_code === 'Ppre')) };
    const service = new RcsCertificationService(brokenData);
    expect(() => service.certify({
      matrixType: 'fluid',
      sprec: {
        sampleType: 'BLD', primaryContainer: 'SST', preCentrifugation: 'A',
        centrifugation: 'A', secondCentrifugation: 'A', postCentrifugationDelay: 'A', longTermStorage: 'C',
      },
    })).toThrow(/Missing RCS axis weight for fluid.Ppre/);
  });

  it('gradeFromScore throws when no threshold band matches the computed score', () => {
    const brokenData = { ...referenceData, thresholds: [] };
    const service = new RcsCertificationService(brokenData);
    expect(() => service.certify({
      matrixType: 'fluid',
      sprec: {
        sampleType: 'BLD', primaryContainer: 'SST', preCentrifugation: 'A',
        centrifugation: 'A', secondCentrifugation: 'A', postCentrifugationDelay: 'A', longTermStorage: 'C',
      },
    })).toThrow(/RCS score outside configured thresholds/);
  });

  it('ruleCodeForReason throws when the mapped rule code is not seeded', () => {
    const brokenData = { ...referenceData, governanceRules: referenceData.governanceRules.filter((r) => r.rule_code !== 'UNKNOWN_SPREC_CODE') };
    const service = new RcsCertificationService(brokenData);
    expect(() => service.certify({
      matrixType: 'fluid',
      sprec: {
        sampleType: 'BLD', primaryContainer: 'SST', preCentrifugation: 'X',
        centrifugation: 'A', secondCentrifugation: 'A', postCentrifugationDelay: 'A', longTermStorage: 'C',
      },
    })).toThrow(/Missing seeded governance rule: UNKNOWN_SPREC_CODE/);
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


describe('RcsCertificationService item 8 residual governance branches', () => {
  const { RcsCertificationService } = rcsCertificationService;
  const referenceData = require('../../src/services/rcs-reference-data');

  it('returns the canonical not-scored result when no severity candidate exists', () => {
    const result = rcsCertificationService.resolveSeverity({}, 'fluid', 'Ppre', 'NO-MAPPING');
    expect(result).toEqual({
      is_scored: false,
      severity_value: null,
      governance_action: 'governance_failure',
      failure_reason: 'Not scored SPREC condition',
    });
  });

  it('matches a seeded conditional severity when workflow context is explicitly supplied', () => {
    const result = rcsCertificationService.resolveSeverity({
      workflow_context: {
        Pcent2: { workflow_rule: 'pcent2_required_low_cell' },
      },
    }, 'fluid', 'Pcent2', 'N');

    expect(result.is_scored).toBe(true);
    expect(result.workflow_rule).toBe('pcent2_required_low_cell');
  });

  it('resolves workflow rules from camelCase axis context and direct payload aliases', () => {
    expect(rcsCertificationService.resolveWorkflowRule({
      workflowContext: {
        pcent2: { workflowRule: 'PCENT2_REQUIRED_LOW_CELL' },
      },
    }, 'Pcent2', 'N')).toBe('pcent2_required_low_cell');

    expect(rcsCertificationService.resolveWorkflowRule({
      Pcent2_workflow_rule: 'PCENT2_REQUIRED_LOW_CELL',
    }, 'Pcent2', 'N')).toBe('pcent2_required_low_cell');

    expect(rcsCertificationService.resolveWorkflowRule({
      Pcent2WorkflowRule: 'PCENT2_REQUIRED_LOW_CELL',
    }, 'Pcent2', 'N')).toBe('pcent2_required_low_cell');
  });

  it('reports matrix/axis incompatibility through direct governance evaluation', () => {
    const sprec = {
      matrix_type: 'fluid',
      sampleType: 'TIS',
      primaryContainer: 'SST',
      preCentrifugation: 'A',
      centrifugation: 'A',
      secondCentrifugation: 'A',
      postCentrifugationDelay: 'A',
      longTermStorage: 'C',
    };
    const result = rcsCertificationService.evaluateGovernance({}, sprec, 'fluid');

    expect(result.status).toBe(0);
    expect(result.reasons).toContain('SPREC code incompatible with matrix or axis');
  });

  it('fills missing governance trace rule codes from reason and default reason', () => {
    const result = rcsCertificationService.governanceFailureResult(
      'fluid',
      ['Unknown SPREC code', 'Unknown SPREC code'],
      { preCentrifugation: 'X' },
      [
        { reason: 'Unknown SPREC code' },
        {},
      ]
    );

    expect(result.governance_failure_reasons).toEqual(['Unknown SPREC code']);
    expect(result.calculation_trace.governance_trace[0].rule_code).toBe('UNKNOWN_SPREC_CODE');
    expect(result.calculation_trace.governance_trace[1].rule_code).toBe('NOT_SCORED');
  });

  it('falls back to the canonical not-scored reason when a severity record is deliberately unscored without failure_reason', () => {
    const severityMappings = referenceData.severityMappings.map((item) => {
      if (
        item.matrix_type === 'fluid'
        && item.axis_code === 'Ppre'
        && Array.isArray(item.sprec_codes)
        && item.sprec_codes.includes('A')
        && !item.requires_workflow_context
      ) {
        const clone = { ...item, is_scored: false, severity_value: null };
        delete clone.failure_reason;
        return clone;
      }
      return item;
    });
    const service = new RcsCertificationService({ ...referenceData, severityMappings });

    const result = service.certify({
      matrixType: 'fluid',
      sprec: {
        sampleType: 'BLD',
        primaryContainer: 'SST',
        preCentrifugation: 'A',
        centrifugation: 'A',
        secondCentrifugation: 'A',
        postCentrifugationDelay: 'A',
        longTermStorage: 'C',
      },
    });

    expect(result.governance_status).toBe(0);
    expect(result.governance_failure_reasons).toContain('Not scored SPREC condition');
    expect(result.governance_rule_codes).toContain('NOT_SCORED');
  });

  it('covers threshold boundary predicates directly', () => {
    expect(rcsCertificationService.gradeFromScore(100)).toBe('A');
    expect(rcsCertificationService.gradeFromScore(0)).toBe('E');
  });

  it('returns the field name when no canonical axis mapping exists', () => {
    expect(rcsCertificationService.axisCodeForField('fluid', 'customField')).toBe('customField');
  });
});
