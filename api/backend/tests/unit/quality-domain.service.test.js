import { describe, expect, it } from 'vitest';

const qualityDomain = require('../../src/services/quality-domain.service');
const SampleGraphValidator = require('../../src/services/SampleGraphValidator');
const importController = require('../../src/controllers/import.controller');
const intakeWizardRoute = require('../../src/routes/intakeWizard');

function fluidSprec(overrides = {}) {
  return {
    matrixType: 'fluid',
    sampleType: 'BLD',
    primaryContainer: 'A',
    preCentrifugation: 'A',
    centrifugation: 'A',
    secondCentrifugation: 'A',
    postCentrifugationDelay: 'A',
    longTermStorage: 'cryogenic_or_ultralow_workflow_appropriate',
    ...overrides,
  };
}

function solidSprec(overrides = {}) {
  return {
    matrixType: 'solid',
    sampleType: 'TIS',
    primaryContainer: 'A',
    warmIschemia: 'A',
    coldIschemia: 'A',
    fixationType: 'SNP',
    fixationTime: 'B',
    longTermStorage: 'cryogenic_or_ultralow_workflow_appropriate',
    ...overrides,
  };
}

function expectCanonicalContract(result) {
  expect(result).toMatchObject({
    version: 'quality-domain-governance-aware-v2',
    ruleTableVersion: 'quality-rule-table-article-v1',
    source: expect.any(String),
    governance: expect.any(Object),
    sprec: expect.any(Object),
    miabisStatus: expect.any(Object),
    breakdown: expect.any(Object),
    penaltyLog: expect.any(Array),
    reasons: expect.any(Array),
    warnings: expect.any(Array),
    traceabilityFlags: expect.any(Array),
  });
  expect(result).toHaveProperty('score');
  expect(result).toHaveProperty('category');
  expect(result).toHaveProperty('forcedQuarantine');
  expect(result).toHaveProperty('matrixType');
  expect(result).toHaveProperty('quarantineReason');
  expect(result).toHaveProperty('metadataCompleteness');
}

describe('quality-domain.service governance gate', () => {
  it('usa tabela canônica versionada para penalidades', () => {
    expect(qualityDomain.QUALITY_RULE_TABLE_VERSION).toBe('quality-rule-table-article-v1');
    expect(qualityDomain.QUALITY_RULE_TABLE.fluid.P_pre.tiers.C).toBe(15);
    const result = qualityDomain.evaluateQuality({ sprec: fluidSprec({ preCentrifugation: 'C' }) });

    expect(result.ruleTableVersion).toBe('quality-rule-table-article-v1');
    expect(result.breakdown.P_pre.ruleTableVersion).toBe('quality-rule-table-article-v1');
    expect(result.breakdown.P_pre.penalty).toBe(15);
  });

  it.each([
    ['P_pre', 'preCentrifugation', { A: 0, B: 0, C: 15, D: 15, E: 30, F: 30, G: 45, H: 45, I: 60, J: 60, K: 75, L: 75, M: 90, N: 90, O: 30 }],
    ['P_cent1', 'centrifugation', { A: 0, B: 0, C: 0, D: 0, E: 10, F: 10, G: 20, H: 20, I: 30, J: 30, M: 15, N: 0 }],
    ['P_cent2', 'secondCentrifugation', { A: 0, B: 0, C: 0, D: 0, E: 5, F: 5, G: 10, H: 10, I: 15, J: 15, N: 0 }],
    ['P_post', 'postCentrifugationDelay', { A: 0, B: 0, C: 10, D: 10, E: 20, F: 20, G: 35, H: 35, I: 50, J: 50, N: 0 }],
    ['P_store', 'longTermStorage', { cryogenic_or_ultralow_workflow_appropriate: 0, minus35_to_minus18: 20, non_cryogenic_or_room_temperature_molecular_workflow: 40 }],
  ])('valida tabela fluid.%s', (component, field, expectedMap) => {
    Object.entries(expectedMap).forEach(([code, expected]) => {
      const result = qualityDomain.evaluateQuality({ sprec: fluidSprec({ [field]: code }) });
      expect(result.governance.gate).toBe(1);
      expect(result.breakdown[component].penalty).toBe(expected);
    });
  });

  it.each([
    ['P_warm', 'warmIschemia', { A: 0, B: 10, C: 20, D: 30, E: 45, F: 60, N: 0 }],
    ['P_cold', 'coldIschemia', { A: 0, B: 10, C: 20, D: 30, E: 45, F: 60, N: 0 }],
    ['P_fix', 'fixationType', { SNP: 0, PXT: 0, RNL: 0, ALL: 0, HST: 0, OCT: 10, NBF: 10, FOR: 20, ALD: 20, ETH: 20, ACA: 20, NAA: 20 }],
    ['P_fixTime', 'fixationTime', { A: 15, B: 0, C: 5, D: 10, E: 15, F: 20, G: 30, N: 0 }],
    ['P_store', 'longTermStorage', { cryogenic_or_ultralow_workflow_appropriate: 0, minus35_to_minus18: 20, room_temperature_or_non_cryogenic_molecular_workflow: 40 }],
  ])('valida tabela solid.%s', (component, field, expectedMap) => {
    Object.entries(expectedMap).forEach(([code, expected]) => {
      const result = qualityDomain.evaluateQuality({ sprec: solidSprec({ [field]: code }) });
      expect(result.governance.gate).toBe(1);
      expect(result.breakdown[component].penalty).toBe(expected);
    });
  });

  it('normaliza storage SPREC bruto fluid sem depender do frontend', () => {
    const ideal = qualityDomain.evaluateQuality({
      sprec: fluidSprec({ longTermStorage: { code: 'A', label: 'PP tube 0.5 to 2 mL; (-85) to (-60)°C' } }),
    });
    const minus35 = qualityDomain.evaluateQuality({
      sprec: fluidSprec({ longTermStorage: { code: 'B', label: 'PP tube 0.5 to 2 mL; (-35) to (-18)°C' } }),
    });
    const roomTemperature = qualityDomain.evaluateQuality({
      sprec: fluidSprec({ longTermStorage: { code: 'R', label: 'Dry technology medium; RT' } }),
    });

    expect(ideal.breakdown.P_store.penalty).toBe(0);
    expect(minus35.breakdown.P_store.penalty).toBe(20);
    expect(roomTemperature.breakdown.P_store.penalty).toBe(40);
  });

  it('normaliza storage SPREC bruto solid sem depender do frontend', () => {
    const ideal = qualityDomain.evaluateQuality({
      sprec: solidSprec({ longTermStorage: { code: 'A', label: 'PP tube 0.5 to 2 mL; (-85) to (-60) °C' } }),
    });
    const minus35 = qualityDomain.evaluateQuality({
      sprec: solidSprec({ longTermStorage: { code: 'B', label: 'PP tube 0.5 to 2 mL; (-35) to (-18) °C' } }),
    });
    const roomTemperature = qualityDomain.evaluateQuality({
      sprec: solidSprec({ longTermStorage: { code: 'P', label: 'Paraffin Block; 2 to 10 °C or RT' } }),
    });

    expect(ideal.breakdown.P_store.penalty).toBe(0);
    expect(minus35.breakdown.P_store.penalty).toBe(20);
    expect(roomTemperature.breakdown.P_store.penalty).toBe(40);
  });

  it('aplica Pcent1 N como 20 quando centrifugação primária era aplicável', () => {
    const result = qualityDomain.evaluateQuality({
      sprec: fluidSprec({
        centrifugation: { code: 'N', label: 'No centrifugation', applicable: true },
      }),
    });

    expect(result.governance.gate).toBe(1);
    expect(result.breakdown.P_cent1.penalty).toBe(20);
  });

  it('não faz fallback silencioso para fluid quando matrixType está ausente e não inferível', () => {
    const result = qualityDomain.evaluateQuality({
      sprec: {
        sampleType: 'ABC',
        primaryContainer: 'A',
        preCentrifugation: 'A',
        centrifugation: 'A',
        secondCentrifugation: 'A',
        postCentrifugationDelay: 'A',
        longTermStorage: 'A',
      },
    });

    expect(result.forcedQuarantine).toBe(true);
    expect(result.matrixType).toBe('unknown');
    expect(result.matrixDetection.confidence).toBe('missing');
    expect(result.reasons).toContain('matrix_type_required');
    expect(result.warnings).toContain('matrix_type_missing_no_safe_inference');
  });

  it('mantém inferência com confidence para payload legado quando contexto permite', () => {
    const result = qualityDomain.evaluateQuality({
      sampleType: 'plasma',
      sprec: {
        sampleType: 'BLD',
        primaryContainer: 'A',
        preCentrifugation: 'A',
        centrifugation: 'A',
        secondCentrifugation: 'A',
        postCentrifugationDelay: 'A',
        longTermStorage: 'A',
      },
    });

    expect(result.forcedQuarantine).toBe(false);
    expect(result.matrixType).toBe('fluid');
    expect(result.matrixDetection.confidence).toBe('inferred-from-legacy-context');
  });

  it('força quarentena quando metadata obrigatória está ausente', () => {
    const result = qualityDomain.evaluateQuality({
      sprec: fluidSprec({ primaryContainer: '' }),
    });

    expect(result.forcedQuarantine).toBe(true);
    expect(result.category).toBe('C');
    expect(result.governance.gate).toBe(0);
    expect(result.reasons).toContain('mandatory_metadata_missing');
  });

  it('força quarentena quando telemetria obrigatória está offline', () => {
    const result = qualityDomain.evaluateQuality({
      monitoringRequired: true,
      telemetry: { sensorStatus: 'offline' },
      sprec: fluidSprec(),
    });

    expect(result.forcedQuarantine).toBe(true);
    expect(result.reasons).toContain('required_telemetry_unavailable');
    expect(result.traceabilityFlags).toContain('sensor_offline');
  });

  it('força quarentena quando temperatura crítica é desconhecida', () => {
    const result = qualityDomain.evaluateQuality({
      requiresThermalTraceability: true,
      temperatureUnknown: true,
      sprec: fluidSprec(),
    });

    expect(result.forcedQuarantine).toBe(true);
    expect(result.reasons).toContain('critical_temperature_unknown');
    expect(result.quarantineReason).toContain('critical_temperature_unknown');
  });

  it('força quarentena por inconsistência grave de matriz/terminologia', () => {
    const result = qualityDomain.evaluateQuality({
      sprec: solidSprec({ sampleType: 'BLD' }),
    });

    expect(result.forcedQuarantine).toBe(true);
    expect(result.reasons).toContain('severe_matrix_sample_type_inconsistency');
  });
});

describe('quality-domain.service fluid scoring', () => {
  it('classifica caso ideal como categoria A', () => {
    const result = qualityDomain.evaluateQuality({ sprec: fluidSprec() });

    expect(result.score).toBe(100);
    expect(result.category).toBe('A');
    expect(result.forcedQuarantine).toBe(false);
    expect(result.breakdown).toHaveProperty('P_pre');
  });

  it('classifica caso intermediário como categoria B', () => {
    const result = qualityDomain.evaluateQuality({
      sprec: fluidSprec({
        preCentrifugation: 'C',
        centrifugation: 'E',
        secondCentrifugation: 'N',
        postCentrifugationDelay: 'C',
      }),
    });

    expect(result.score).toBe(65);
    expect(result.category).toBe('B');
    expect(result.governance.gate).toBe(1);
  });

  it('classifica caso degradado como categoria C', () => {
    const result = qualityDomain.evaluateQuality({
      sprec: fluidSprec({
        preCentrifugation: 'C',
        centrifugation: 'E',
        secondCentrifugation: 'E',
        postCentrifugationDelay: 'C',
        longTermStorage: 'minus35_to_minus18',
      }),
    });

    expect(result.score).toBe(40);
    expect(result.category).toBe('C');
    expect(result.governance.gate).toBe(1);
  });

  it('força governance failure para código X sem depender de penalty comum', () => {
    const result = qualityDomain.evaluateQuality({ sprec: fluidSprec({ preCentrifugation: 'X' }) });

    expect(result.governance.gate).toBe(0);
    expect(result.forcedQuarantine).toBe(true);
    expect(result.category).toBe('C');
    expect(result.decisionStatus).toBe('quarantine');
    expect(result.governanceFailures.length).toBeGreaterThan(0);
  });

  it('mantém quarentena mesmo com score calculável quando governance falha', () => {
    const result = qualityDomain.evaluateQuality({
      traceabilityBroken: true,
      sprec: fluidSprec(),
    });

    expect(result.score).toBeNull();
    expect(result.category).toBe('C');
    expect(result.forcedQuarantine).toBe(true);
  });
});

describe('quality-domain.service solid scoring', () => {
  it('classifica caso ideal como categoria A', () => {
    const result = qualityDomain.evaluateQuality({ sprec: solidSprec() });

    expect(result.score).toBe(100);
    expect(result.category).toBe('A');
    expect(result.breakdown).toHaveProperty('P_warm');
  });

  it('classifica caso intermediário como categoria B', () => {
    const result = qualityDomain.evaluateQuality({
      sprec: solidSprec({
        warmIschemia: 'B',
        coldIschemia: 'B',
        fixationType: 'OCT',
        fixationTime: 'C',
      }),
    });

    expect(result.score).toBe(65);
    expect(result.category).toBe('B');
    expect(result.governance.gate).toBe(1);
  });

  it('classifica caso degradado como categoria C', () => {
    const result = qualityDomain.evaluateQuality({
      sprec: solidSprec({
        warmIschemia: 'C',
        coldIschemia: 'C',
        fixationType: 'FOR',
        fixationTime: 'D',
        longTermStorage: 'minus35_to_minus18',
      }),
    });

    expect(result.score).toBe(10);
    expect(result.category).toBe('C');
    expect(result.governance.gate).toBe(1);
  });

  it('classifica caso limítrofe A como score 85', () => {
    const result = qualityDomain.evaluateQuality({
      sprec: solidSprec({ fixationType: 'OCT', fixationTime: 'C' }),
    });

    expect(result.score).toBe(85);
    expect(result.category).toBe('A');
    expect(result.governance.gate).toBe(1);
  });

  it('força governance failure para Pfix XXX sem penalty comum', () => {
    const result = qualityDomain.evaluateQuality({ sprec: solidSprec({ fixationType: 'XXX' }) });

    expect(result.governance.gate).toBe(0);
    expect(result.forcedQuarantine).toBe(true);
    expect(result.category).toBe('C');
    expect(result.decisionStatus).toBe('quarantine');
    expect(result.governanceFailures.length).toBeGreaterThan(0);
  });

  it('mantém quarentena mesmo com score calculável quando governance falha', () => {
    const result = qualityDomain.evaluateQuality({
      monitoringRequired: true,
      sensorOffline: true,
      sprec: solidSprec(),
    });

    expect(result.score).toBeNull();
    expect(result.category).toBe('C');
    expect(result.forcedQuarantine).toBe(true);
  });
});

describe('quality-domain.service contract and compatibility', () => {
  it('retorna contrato canônico versionado com breakdown e reasons', () => {
    const result = qualityDomain.evaluateQuality({ sprec: fluidSprec({ preCentrifugation: 'C' }) });

    expectCanonicalContract(result);
    expect(result.version).toBe('quality-domain-governance-aware-v2');
    expect(result.breakdown.P_pre.penalty).toBeGreaterThan(0);
    expect(result.reasons).toContain('fluid_matrix_penalties_applied');
  });

  it('mantém wrapper de intake apontando para o domínio canônico', () => {
    const result = intakeWizardRoute._test.resolverQualidadeMetodologica({ sprec: fluidSprec() });

    expect(result.version).toBe('quality-domain-governance-aware-v2');
    expect(result.category).toBe('A');
  });

  it('mantém SampleGraphValidator consumindo a decisão canônica', () => {
    const validator = new SampleGraphValidator({});
    const result = validator._validateQuality({
      sprec: fluidSprec({ primaryContainer: '' }),
    });

    expect(result.valid).toBe(false);
    expect(result.assessment.version).toBe('quality-domain-governance-aware-v2');
    expect(result.assessment.forcedQuarantine).toBe(true);
  });

  it('mantém import.controller carregável com wrappers legados ativos', () => {
    expect(importController).toBeTruthy();
    const result = qualityDomain.calculateMethodologyQualityFromSprec(fluidSprec());
    const penaltyLog = qualityDomain.buildPenaltyLog(result);

    expect(result.version).toBe('quality-domain-governance-aware-v2');
    expect(penaltyLog).toEqual([]);
  });
});
