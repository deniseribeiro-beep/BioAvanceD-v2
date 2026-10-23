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

describe('RcsCertificationService matrix mapping release (RF018 AC4, #1320)', () => {
  const { RcsCertificationService, AXES } = rcsCertificationService;
  const referenceData = require('../../src/services/rcs-reference-data');
  const releaseId = referenceData.matrixMapping.sprec_mapping_release_id;

  // The base rule the release replaces, kept verbatim so the release is
  // proven to classify every input as it did.
  const normalizeString = (value) => String(value ?? '').trim();
  function legacyDetectMatrixType(payload = {}, sprec = {}) {
    const explicit = normalizeString(payload.matrix_type || payload.matrixType || sprec.matrix_type).toLowerCase();
    if (explicit === 'fluid' || explicit === 'solid') return explicit;

    const sampleText = normalizeString(payload.sampleType || payload.sampleOrigin).toLowerCase();
    if (sampleText.includes('plasma') || sampleText.includes('serum') || sampleText.includes('blood') || sampleText.includes('urine')) {
      return 'fluid';
    }
    if (sampleText.includes('tissue') || sampleText.includes('tumor') || sampleText.includes('solid')) {
      return 'solid';
    }

    if (sprec.fixationType || sprec.fixationTime || sprec.warmIschemia || sprec.coldIschemia) return 'solid';
    return null;
  }

  it('classifies every catalog description as the unversioned base rule did', () => {
    const descriptions = Object.keys(AXES).flatMap((matrix) => referenceData.catalogs[matrix].map((entry) => entry.description));
    const sprecs = [{}, { fixationType: 'FRZ' }, { coldIschemia: 'B' }, { matrix_type: 'solid' }];
    let compared = 0;
    for (const description of [...descriptions, '']) {
      for (const textKey of ['sampleType', 'sampleOrigin']) {
        for (const matrixType of [undefined, 'fluid', 'SOLID', 'liquid']) {
          for (const sprec of sprecs) {
            const payload = { [textKey]: description, matrix_type: matrixType };
            expect(rcsCertificationService.detectMatrixType(payload, sprec)).toBe(legacyDetectMatrixType(payload, sprec));
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it('resolves serum text by the fluid-sample-text rule of the release', () => {
    expect(rcsCertificationService.resolveMatrix({ sampleType: 'Serum sample' })).toEqual({
      matrix: 'fluid', resolvedBy: 'mapping', matrixMappingReleaseId: releaseId, ruleId: 'fluid-sample-text',
    });
  });

  it('resolves fixation data by the solid-sprec-axes rule of the release', () => {
    expect(rcsCertificationService.resolveMatrix({}, { fixationType: 'FFPE' })).toEqual({
      matrix: 'solid', resolvedBy: 'mapping', matrixMappingReleaseId: releaseId, ruleId: 'solid-sprec-axes',
    });
  });

  it('gives an explicit matrix a null release id', () => {
    expect(rcsCertificationService.resolveMatrix({ matrix_type: 'fluid' })).toEqual({
      matrix: 'fluid', resolvedBy: 'explicit', matrixMappingReleaseId: null, ruleId: null,
    });
  });

  it('resolves nothing for an input no rule matches', () => {
    expect(rcsCertificationService.resolveMatrix({})).toEqual({
      matrix: null, resolvedBy: null, matrixMappingReleaseId: null, ruleId: null,
    });
  });

  it('resolves nothing by a rule whose source is unknown', () => {
    const rules = referenceData.matrixMapping.rules.map((rule) => ({ ...rule, source: 'free_text_guess' }));
    const service = new RcsCertificationService({ ...referenceData, matrixMapping: { ...referenceData.matrixMapping, rules } });
    expect(service.resolveMatrix({ sampleType: 'plasma' }, { fixationType: 'FFPE' }).matrix).toBeNull();
  });

  it('gives no release when the data carries no matrix mapping', () => {
    const service = new RcsCertificationService({ ...referenceData, matrixMapping: undefined });
    expect(service.matrixMappingRelease()).toBeNull();
    expect(service.matrixResolution({ sampleType: 'plasma' }).matrix).toBeNull();
  });

  it('freezes the terms and fields of each release rule', () => {
    const [fluidText, , solidAxes] = referenceData.matrixMapping.rules;
    expect(Object.isFrozen(fluidText.contains_any)).toBe(true);
    expect(Object.isFrozen(solidAxes.fields_any)).toBe(true);
  });

  it('codes the material from the resolved matrix catalog', () => {
    expect(rcsCertificationService.matrixResolution({ sampleType: 'plasma', sprec: { sampleType: 'PL1' } }).materialTypeCode).toEqual({
      systemUri: 'urn:bioavanced:sprec-2.0:type-of-sample', code: 'PL1', version: 'SPREC-2.0', display: 'Plasma, single spun',
    });
  });

  it('codes no material that is outside the resolved matrix catalog', () => {
    const resolution = rcsCertificationService.matrixResolution({ matrix_type: 'fluid', sprec: { sampleType: 'TIS' } });
    expect(resolution.matrix).toBe('fluid');
    expect(resolution.materialTypeCode).toBeNull();
  });
});
