import { describe, expect, it } from 'vitest';

const rcsService = require('../../src/services/rcs-certification.service');
const qualityDomain = require('../../src/services/quality-domain.service');
const referenceData = require('../../src/services/rcs-reference-data');
const { buildRcsCatalogDocuments } = require('../../src/services/rcs-reference-data');
const { SampleModel } = require('../../src/models/Sample');

function fluidSprec(overrides = {}) {
  return {
    matrixType: 'fluid',
    sampleType: 'BLD',
    primaryContainer: 'SST',
    preCentrifugation: 'A',
    centrifugation: 'A',
    secondCentrifugation: 'A',
    postCentrifugationDelay: 'A',
    longTermStorage: 'C',
    ...overrides,
  };
}

function solidSprec(overrides = {}) {
  return {
    matrixType: 'solid',
    sampleType: 'TIS',
    collectionType: 'SRG',
    warmIschemia: 'A',
    coldIschemia: 'A',
    fixationType: 'SNP',
    fixationTime: 'B',
    longTermStorage: 'C',
    ...overrides,
  };
}

function certify(sprec, extra = {}) {
  return rcsService.certify({ ...extra, matrixType: sprec.matrixType, sprec });
}

describe('RcsCertificationService RCS-GOV 1.0', () => {
  it('neutraliza a tabela legada e expoe apenas RCS-GOV como decisao', () => {
    expect(qualityDomain.QUALITY_RULE_TABLE).toBeUndefined();
    expect(qualityDomain.classifyScore).toBeUndefined();

    const result = qualityDomain.evaluateQuality({ sprec: fluidSprec() });
    expect(result.model_version).toBe('RCS-GOV-1.0');
    expect(result.final_grade).toBe('A');
    expect(result).not.toHaveProperty('category');
    expect(result).not.toHaveProperty('score');
    expect(result).not.toHaveProperty('forcedQuarantine');
    expect(result.deprecated_legacy_fields).toContain('category');
  });

  it('valida soma dos pesos por matriz', () => {
    const sum = (matrix) => referenceData.weights
      .filter((item) => item.matrix_type === matrix)
      .reduce((total, item) => total + Number(item.weight), 0);

    expect(sum('fluid')).toBe(100);
    expect(sum('solid')).toBe(100);
  });

  it('calcula RCS = 100 - Pbio com rastreio por eixo', () => {
    const result = certify(fluidSprec({ preCentrifugation: 'C' }));

    expect(result.p_bio).toBe(6);
    expect(result.rcs_score).toBe(94);
    expect(result.rcs_score).toBe(100 - result.p_bio);
    expect(result.axis_penalties).toEqual(expect.arrayContaining([
      expect.objectContaining({ axis_code: 'Ppre', sprec_code: 'C', weight: 30, severity: 0.2, penalty: 6 }),
    ]));
    expect(result.calculation_trace.axes.length).toBe(5);
  });

  it.each([
    ['A', fluidSprec({ preCentrifugation: 'C' }), {}, 94],
    ['B', fluidSprec({ preCentrifugation: 'C', longTermStorage: 'A' }), {}, 87.75],
    ['C', fluidSprec({ preCentrifugation: 'M' }), {}, 70],
    ['D', fluidSprec({ preCentrifugation: 'M', longTermStorage: 'B' }), {}, 55],
    ['E', fluidSprec({ preCentrifugation: 'M', postCentrifugationDelay: 'I', longTermStorage: 'B' }), {}, 35],
  ])('classifica Grade %s pela tabela de thresholds seedada', (grade, sprec, extra, expectedScore) => {
    const result = certify(sprec, extra);

    expect(result.rcs_score).toBe(expectedScore);
    expect(result.score_based_grade).toBe(grade);
    expect(result.final_grade).toBe(grade);
    expect(result.grade_route).toBe(grade === 'E' ? 'Score critical penalty' : 'Score-based certification');
  });

  it('falha de governanca sempre roteia para Grade E nao compensavel', () => {
    const result = certify(fluidSprec({ preCentrifugation: 'X' }));

    expect(result).toMatchObject({
      governance_status: 0,
      p_bio: null,
      rcs_score: null,
      score_based_grade: null,
      final_grade: 'E',
      grade_route: 'Governance failure',
      axis_penalties: [],
    });
    expect(result.governance_failure_reasons).toContain('Unknown SPREC code');
    expect(result.governance_rule_codes).toContain('UNKNOWN_SPREC_CODE');
    expect(result.calculation_trace.governance_trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_code: 'UNKNOWN_SPREC_CODE' }),
    ]));
  });

  it.each([
    ['Pcent1 sem workflow', fluidSprec({ centrifugation: 'N' }), {}],
    ['Pcent2 sem workflow', fluidSprec({ secondCentrifugation: 'N' }), {}],
    ['Pstore Y sem temperatura documentada', fluidSprec({ longTermStorage: 'Y' }), {}],
    ['Pstore P/R sem finalidade documentada', fluidSprec({ longTermStorage: 'P' }), {}],
  ])('%s falha no gate em vez de assumir severidade zero', (_label, sprec, extra) => {
    const result = certify(sprec, extra);
    expect(result.governance_status).toBe(0);
    expect(result.rcs_score).toBeNull();
    expect(result.axis_penalties).toEqual([]);
    expect(result.governance_rule_codes).toEqual(expect.arrayContaining([
      expect.stringMatching(/MISSING_ANALYTICAL_WORKFLOW|NOT_SCORED/),
    ]));
  });

  it('resolve severidades condicionais somente com workflow seedado', () => {
    const result = certify(fluidSprec({ secondCentrifugation: 'N' }), {
      workflow_context: { Pcent2: { workflow_rule: 'pcent2_required_low_cell' } },
    });
    expect(result.governance_status).toBe(1);
    expect(result.axis_penalties).toEqual(expect.arrayContaining([
      expect.objectContaining({ axis_code: 'Pcent2', severity: 1, penalty: 10 }),
    ]));
  });

  it.each([
    ['missing', fluidSprec({ preCentrifugation: '' })],
    ['invalid', fluidSprec({ preCentrifugation: '@@' })],
    ['Other', fluidSprec({ preCentrifugation: 'Z' })],
    ['Not scored Y', fluidSprec({ longTermStorage: 'Y' })],
  ])('%s nao recebe severity zero', (_label, sprec) => {
    const result = certify(sprec);

    expect(result.governance_status).toBe(0);
    expect(result.axis_penalties).toEqual([]);
    expect(result.calculation_trace.governance_trace).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ severity_value: 0 })])
    );
  });

  it('busca severidades, pesos e thresholds exclusivamente dos seeds', () => {
    const severity = referenceData.severityMappings.find((item) => item.matrix_type === 'fluid' && item.axis_code === 'Ppre' && item.sprec_codes.includes('C'));
    const weight = referenceData.weights.find((item) => item.matrix_type === 'fluid' && item.axis_code === 'Ppre');
    const threshold = referenceData.thresholds.find((item) => item.grade === 'B');

    expect(severity.severity_value).toBe(0.2);
    expect(weight.weight).toBe(30);
    expect(threshold.min_inclusive).toBe(80);
  });

  it('bloqueia codigo fluido em matriz solida e codigo solido em matriz fluida', () => {
    expect(certify(solidSprec({ sampleType: 'BLD' })).governance_status).toBe(0);
    expect(certify(fluidSprec({ sampleType: 'TIS' })).governance_status).toBe(0);
  });

  it('mantem catalogos S1/S2 e S3 carregados como dados estruturados completos', () => {
    expect(referenceData.catalogs.fluid.length).toBeGreaterThan(120);
    expect(referenceData.catalogs.solid.length).toBeGreaterThan(80);
    expect(referenceData.severityMappings.length).toBeGreaterThan(65);
    expect(referenceData.severityMappings.some((item) => item.is_scored === false && item.severity_value === null)).toBe(true);
  });

  it('helper de seed produz chaves idempotentes de catalogo', () => {
    const docs = buildRcsCatalogDocuments({
      model_code: 'RCS-GOV-1.0',
      sprec_version: 'SPREC-2.0',
      matrix_type: 'fluid',
      catalog: [{ axis_code: 'Ppre', sprec_code: 'A', description: 'RT <2 h' }],
    });

    expect(docs).toEqual([expect.objectContaining({
      model_code: 'RCS-GOV-1.0',
      sprec_version: 'SPREC-2.0',
      matrix_type: 'fluid',
      axis_code: 'Ppre',
      sprec_code: 'A',
    })]);
  });

  it('bloqueia release de Grade E mesmo com governanca aprovada', () => {
    const approved = qualityDomain.validateQualityForRelease({ matrixType: 'fluid', sprec: fluidSprec() });
    const critical = qualityDomain.validateQualityForRelease({
      matrixType: 'fluid',
      sprec: fluidSprec({ preCentrifugation: 'M', postCentrifugationDelay: 'I', longTermStorage: 'B' }),
    });
    expect(approved.valid).toBe(true);
    expect(critical.assessment.governance_status).toBe(1);
    expect(critical.assessment.final_grade).toBe('E');
    expect(critical.valid).toBe(false);
  });

  it('persiste eixos solidos e avaliacao canonica completa no modelo de amostra', () => {
    const evaluation = certify(solidSprec());
    const sample = SampleModel.create({
      patientID: '12345678', sampleType: 'TIS', sampleOrigin: 'TIS', extractionProtocol: 'SNP',
      quantity: 1, linkedProject: 'RCS-CONTRACT', sprec: solidSprec(), ...evaluation,
      rcs_evaluation: evaluation,
    });
    expect(sample.sprec).toMatchObject({ warmIschemia: 'A', coldIschemia: 'A', fixationType: 'SNP', fixationTime: 'B' });
    expect(sample).toMatchObject({ model_version: 'RCS-GOV-1.0', governance_status: 1, final_grade: 'A' });
    expect(sample.axis_penalties).toHaveLength(5);
    expect(sample.calculation_trace.axes).toHaveLength(5);
  });
});
