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
      specimenId: 'SPZ-001', participantId: '12345678', sampleType: 'TIS', sampleOrigin: 'TIS', extractionProtocol: 'SNP',
      quantity: 1, linkedProject: 'RCS-CONTRACT', sprec: solidSprec(),
      modelVersion: evaluation.model_version,
      governanceStatus: evaluation.governance_status,
      governanceFailureReasons: evaluation.governance_failure_reasons,
      governanceRuleCodes: evaluation.governance_rule_codes,
      rcsScore: evaluation.rcs_score,
      scoreBasedGrade: evaluation.score_based_grade,
      finalGrade: evaluation.final_grade,
      gradeRoute: evaluation.grade_route,
      axisPenalties: evaluation.axis_penalties,
      calculationTrace: evaluation.calculation_trace,
      rcsEvaluation: evaluation,
    });
    expect(sample.sprec).toMatchObject({ warmIschemia: 'A', coldIschemia: 'A', fixationType: 'SNP', fixationTime: 'B' });
    expect(sample).toMatchObject({ modelVersion: 'RCS-GOV-1.0', governanceStatus: 1, finalGrade: 'A' });
    expect(sample.axisPenalties).toHaveLength(5);
    expect(sample.calculationTrace.axes).toHaveLength(5);
  });
});

// RF018 AC3 (#1320): readInput keeps exactly the payload keys certify reads,
// so the frozen input recalculates the same result.
describe('readInput', () => {
  const qualityCompatibility = require('../../src/services/quality-compatibility.service');
  const F = {
    sampleType: 'PL1', primaryContainer: 'SST', preCentrifugation: 'A', centrifugation: 'A',
    secondCentrifugation: 'N', postCentrifugationDelay: 'A', longTermStorage: 'A',
  };

  it.each([
    ['matrix_type beside sprec', { matrix_type: 'fluid', sprec: F }, 'E'],
    ['matrixType inside sprec', { sprec: { ...F, matrixType: 'fluid' } }, 'E'],
    ['a sampleType text', { sampleType: 'plasma', sprec: F }, 'E'],
    ['a sample wrapper', { sample: { matrix_type: 'fluid', sprec: F } }, 'E'],
    ['secondCentrifugationRequired false', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false }, 'A'],
    ['a workflow_context.Pcent2 rule', { matrix_type: 'fluid', sprec: F, workflow_context: { Pcent2: { workflow_rule: 'pcent2_not_required' } } }, 'A'],
    ['an empty sprec', { sprec: {} }, 'E'],
    ['documentationSufficient false', { matrix_type: 'fluid', sprec: F, documentationSufficient: false }, 'E'],
  ])('certify(readInput(p)) recalculates certify(p) for %s', (_label, raw, grade) => {
    const payload = qualityCompatibility.normalizeSample(raw);
    const expected = rcsService.certify(payload);
    expect(expected.final_grade).toBe(grade);
    expect(rcsService.certify(rcsService.readInput(payload))).toEqual(expected);
  });

  it('copies no key certify does not read', () => {
    const input = rcsService.readInput({ matrix_type: 'fluid', sprec: F, patientName: 'Maria Synthetic', cpf: '00000000000' });
    expect(input).toEqual({ matrix_type: 'fluid', sprec: F });
    expect(input.sprec).not.toBe(F);
  });
});

// RF018 AC7 (#1320): the six governance criteria, read from the gate's own
// trace re-run on the frozen input. A flag is true only where the gate
// checked its inputs, false where it failed them, null with a reason
// otherwise.
describe('evaluateGovernanceEvidence', () => {
  const qualityCompatibility = require('../../src/services/quality-compatibility.service');
  const { RcsCertificationService } = rcsService;
  const F = {
    sampleType: 'PL1', primaryContainer: 'SST', preCentrifugation: 'A', centrifugation: 'A',
    secondCentrifugation: 'N', postCentrifugationDelay: 'A', longTermStorage: 'A',
  };
  const UNREAD = {
    traceabilityOk: 'nenhuma referência de identificação, custódia ou linhagem foi apresentada (V2E-0528)',
    monitoringOk: 'nenhuma referência de monitoramento ou telemetria foi apresentada (V2E-0529)',
    documentationOk: 'nenhum registro, SOP ou evidência documental foi apresentado (V2E-0530)',
    semanticCompatible: 'eventos não são lidos por este cálculo (V2E-0531)',
  };
  const flags = (overrides = {}) => ({
    metadataComplete: true, terminologyValid: true, traceabilityOk: null,
    monitoringOk: null, documentationOk: null, semanticCompatible: null, ...overrides,
  });
  // RNF018 AC5 (#1524): a server-resolved evidence category.
  const entry = (kind, status = 'resolved') => ({ uri: `urn:bioavanced:${kind}:1`, hash: `sha256:${'0'.repeat(64)}`, status });
  const resolvedAll = {
    traceability: [entry('custody-event')],
    monitoring: [entry('telemetry-exposure-summary')],
    documentation: [entry('collection-governance-approval')],
  };

  it.each([
    ['pass', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false }, flags(), null],
    ['missingWf', { matrix_type: 'fluid', sprec: F }, flags(), null],
    ['wfMismatch', { matrix_type: 'fluid', sprec: F, workflow_context: { Pcent2: { workflow_rule: 'nope' } } }, flags({ semanticCompatible: false }), 'fail'],
    ['noMatrix', { sprec: {} }, flags({ metadataComplete: false, terminologyValid: null }), 'fail'],
    ['noMatrixSemantic', { sprec: {}, semanticIncompatibility: true }, flags({ metadataComplete: false, terminologyValid: null, semanticCompatible: false }), 'fail'],
    ['missingField', { matrix_type: 'fluid', sprec: { ...F, primaryContainer: '' } }, flags({ metadataComplete: false }), 'fail'],
    ['unknownCode', { matrix_type: 'fluid', sprec: { ...F, longTermStorage: 'X' } }, flags({ terminologyValid: false }), 'fail'],
    ['otherCode', { matrix_type: 'fluid', sprec: { ...F, longTermStorage: 'Z' } }, flags({ terminologyValid: false }), 'fail'],
    ['incompat', { matrix_type: 'fluid', sprec: { ...F, longTermStorage: 'Q9' } }, flags({ semanticCompatible: false }), 'fail'],
    ['docFalse', { matrix_type: 'fluid', sprec: F, documentationSufficient: false }, flags({ documentationOk: false }), 'fail'],
    ['trace', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false, traceabilityBroken: true }, flags({ traceabilityOk: false }), 'fail'],
    ['mon', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false, monitoringRequired: true }, flags({ monitoringOk: false }), 'fail'],
    ['evidenceResolved', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false, governanceEvidenceResolution: resolvedAll },
      flags({ traceabilityOk: true, monitoringOk: true, documentationOk: true }), null],
    ['traceabilityUnresolved', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false,
      governanceEvidenceResolution: { ...resolvedAll, traceability: [entry('custody-event'), entry('custody-event', 'hash_mismatch')] } },
    flags({ traceabilityOk: false, monitoringOk: true, documentationOk: true }), 'fail'],
    ['monitoringUnresolved', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false,
      governanceEvidenceResolution: { ...resolvedAll, monitoring: [entry('telemetry-exposure-summary', 'missing_hash')] } },
    flags({ traceabilityOk: true, monitoringOk: false, documentationOk: true }), 'fail'],
    ['documentationUnresolved', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false,
      governanceEvidenceResolution: { ...resolvedAll, documentation: [entry('collection-governance-approval', 'unresolvable_uri')] } },
    flags({ traceabilityOk: true, monitoringOk: true, documentationOk: false }), 'fail'],
    ['traceBrokenResolved', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false, traceabilityBroken: true,
      governanceEvidenceResolution: resolvedAll }, flags({ traceabilityOk: false, monitoringOk: true, documentationOk: true }), 'fail'],
    ['evidenceEmptyCategory', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false,
      governanceEvidenceResolution: { traceability: [], monitoring: [entry('telemetry-exposure-summary')] } },
    flags({ monitoringOk: true }), null],
  ])('reads the six flags of the %s row from the gate', (_name, raw, expectedFlags, gateResult) => {
    const payload = qualityCompatibility.normalizeSample(raw);
    const before = rcsService.certify(payload);
    const input = rcsService.readInput(payload);
    const evidence = rcsService.evaluateGovernanceEvidence(input);

    expect(Object.fromEntries(Object.keys(expectedFlags).map((flag) => [flag, evidence[flag]]))).toEqual(expectedFlags);
    expect(evidence.gateResult).toBe(gateResult);
    const nullFlags = Object.keys(expectedFlags).filter((flag) => expectedFlags[flag] === null);
    expect(Object.keys(evidence.unresolvedReasons).sort())
      .toEqual([...nullFlags, ...(gateResult === null ? ['gateResult'] : [])].sort());
    for (const flag of nullFlags) {
      expect(evidence.unresolvedReasons[flag]).toBe(UNREAD[flag] || 'códigos SPREC não verificados: matriz não resolvida');
    }
    if (gateResult === 'fail') {
      expect(before.governance_status).toBe(0);
      expect(evidence.failureReasons).toEqual(before.governance_failure_reasons);
    } else {
      expect(evidence.failureReasons).toEqual([]);
      expect(evidence.unresolvedReasons.gateResult).toBe('nem todos os seis critérios têm evidência; nenhum falhou');
    }
    expect(evidence.validationRuleSetVersion).toBe('RCS-GOV-1.0');
    expect(evidence.validationRuleSetChecksum).toBe(rcsService.governanceRuleSet().checksum);
    // No mutation of the input and no score change.
    expect(input).toEqual(rcsService.readInput(payload));
    expect(rcsService.certify(payload)).toEqual(before);
  });

  it.each([
    ['docFalse', { matrix_type: 'fluid', sprec: F, documentationSufficient: false }],
    ['pass', { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false }],
  ])('reads the %s row the same under a sample wrapper, as certify does', (_name, raw) => {
    const input = rcsService.readInput(qualityCompatibility.normalizeSample(raw));
    expect(rcsService.evaluateGovernanceEvidence({ sample: input })).toEqual(rcsService.evaluateGovernanceEvidence(input));
  });

  // RNF018 AC5 (#1524): a presented evidence category that did not
  // resolve fails certification with its reason and rule code; one that
  // resolved changes nothing in the result.
  describe('certify with a governance evidence resolution (RNF018 AC5, #1524)', () => {
    const base = { matrix_type: 'fluid', sprec: F, secondCentrifugationRequired: false };

    it('passes with every category resolved, with the same calculation_trace as without it', () => {
      const without = rcsService.certify(base);
      const withEvidence = rcsService.certify({ ...base, governanceEvidenceResolution: resolvedAll });
      expect(withEvidence.governance_status).toBe(1);
      expect(withEvidence).toEqual(without);
      const evidence = rcsService.evaluateGovernanceEvidence(rcsService.readInput({ ...base, governanceEvidenceResolution: resolvedAll }));
      expect([evidence.traceabilityOk, evidence.monitoringOk, evidence.documentationOk]).toEqual([true, true, true]);
      expect(Object.keys(evidence.unresolvedReasons).sort()).toEqual(['gateResult', 'semanticCompatible']);
    });

    it.each([
      ['traceability', 'custody-event', 'Insufficient traceability', 'INSUFFICIENT_TRACEABILITY', 'traceabilityOk'],
      ['monitoring', 'telemetry-exposure-summary', 'Missing required monitoring', 'MISSING_REQUIRED_MONITORING', 'monitoringOk'],
      ['documentation', 'collection-governance-approval', 'Insufficient documentation', 'INSUFFICIENT_DOCUMENTATION', 'documentationOk'],
    ])('refuses a %s category with one non-resolved reference', (category, kind, reason, ruleCode, flag) => {
      const failing = entry(kind, 'unresolvable_uri');
      const payload = { ...base, governanceEvidenceResolution: { ...resolvedAll, [category]: [entry(kind), failing, failing] } };
      const result = rcsService.certify(payload);
      expect(result).toMatchObject({ governance_status: 0, final_grade: 'E', grade_route: 'Governance failure' });
      expect(result.governance_failure_reasons).toEqual([reason]);
      expect(result.governance_rule_codes).toEqual([ruleCode]);
      expect(result.calculation_trace.governance_trace).toEqual([{
        rule_code: ruleCode,
        reason,
        evidence: [{ uri: failing.uri, status: 'unresolvable_uri' }, { uri: failing.uri, status: 'unresolvable_uri' }],
      }]);
      const evidence = rcsService.evaluateGovernanceEvidence(rcsService.readInput(payload));
      const others = ['traceabilityOk', 'monitoringOk', 'documentationOk'].filter((name) => name !== flag);
      expect(evidence[flag]).toBe(false);
      for (const other of others) expect(evidence[other]).toBe(true);
      expect(evidence.gateResult).toBe('fail');
    });

    it('pushes a reason once when a client boolean already failed the same category', () => {
      const result = rcsService.certify({
        ...base,
        documentationSufficient: false,
        governanceEvidenceResolution: { documentation: [entry('collection-governance-approval', 'missing_hash')] },
      });
      expect(result.governance_failure_reasons).toEqual(['Insufficient documentation']);
      expect(result.governance_rule_codes).toEqual(['INSUFFICIENT_DOCUMENTATION']);
    });

    it('recalculates from readInput with the resolution frozen', () => {
      const payload = { ...base, governanceEvidenceResolution: { ...resolvedAll, monitoring: [entry('telemetry-exposure-summary', 'hash_mismatch')] } };
      const input = rcsService.readInput(payload);
      expect(input.governanceEvidenceResolution).toEqual(payload.governanceEvidenceResolution);
      expect(rcsService.certify(input)).toEqual(rcsService.certify(payload));
      expect(rcsService.certify(input).governance_status).toBe(0);
    });

    // RNF018 AC5 (#1524), V2E-0532: evidenceRefs lists the URIs of the
    // references that resolved, in category then presented order, each once.
    const refsOf = (resolution) => rcsService.evaluateGovernanceEvidence(rcsService.readInput(
      resolution === undefined ? base : { ...base, governanceEvidenceResolution: resolution },
    )).evidenceRefs;
    const allUris = [
      'urn:bioavanced:custody-event:1',
      'urn:bioavanced:telemetry-exposure-summary:1',
      'urn:bioavanced:collection-governance-approval:1',
    ];

    it('lists the URI of every resolved reference in evidenceRefs', () => {
      expect(refsOf(resolvedAll)).toEqual(allUris);
    });

    it('leaves a non-resolved reference out of evidenceRefs and keeps a repeated URI once', () => {
      expect(refsOf({
        ...resolvedAll,
        traceability: [
          entry('custody-event'),
          { uri: 'urn:bioavanced:custody-event:2', hash: `sha256:${'0'.repeat(64)}`, status: 'hash_mismatch' },
          entry('custody-event'),
        ],
      })).toEqual(allUris);
    });

    it('gives an empty evidenceRefs when no resolution is presented', () => {
      expect(refsOf(undefined)).toEqual([]);
    });

    it('leaves a resolved entry with no usable URI out of evidenceRefs', () => {
      expect(refsOf({
        ...resolvedAll,
        traceability: [
          { uri: null, hash: null, status: 'resolved' },
          { uri: '  ', hash: null, status: 'resolved' },
          { uri: null, hash: null, status: 'unresolvable_uri' },
        ],
      })).toEqual(allUris.slice(1));
    });
  });

  it('names the workflow-context mismatch reason for the wfMismatch row', () => {
    const input = rcsService.readInput({ matrix_type: 'fluid', sprec: F, workflow_context: { Pcent2: { workflow_rule: 'nope' } } });
    expect(rcsService.evaluateGovernanceEvidence(input).failureReasons)
      .toEqual(['Analytical workflow context does not match seeded severity mapping']);
  });

  it('checksums the rule set as a stable sha256, equal across instances on the same data', () => {
    const ruleSet = rcsService.governanceRuleSet();
    expect(ruleSet.version).toBe('RCS-GOV-1.0');
    expect(ruleSet.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(new RcsCertificationService(referenceData).governanceRuleSet()).toEqual(ruleSet);
  });

  it('gives another checksum when a governance rule description changes', () => {
    const governanceRules = referenceData.governanceRules.map((rule, index) => (
      index === 0 ? { ...rule, description: `${rule.description} (changed)` } : rule
    ));
    const changed = new RcsCertificationService({ ...referenceData, governanceRules });
    expect(changed.governanceRuleSet().checksum).not.toBe(rcsService.governanceRuleSet().checksum);
  });

  it('gives another checksum with a fluid catalog entry dropped', () => {
    const catalogs = { ...referenceData.catalogs, fluid: referenceData.catalogs.fluid.slice(1) };
    const changed = new RcsCertificationService({ ...referenceData, catalogs });
    expect(changed.governanceRuleSet().checksum).not.toBe(rcsService.governanceRuleSet().checksum);
  });
});

describe('matrixMappingRelease (RF018 AC4, #1320)', () => {
  const { RcsCertificationService } = rcsService;

  it('checksums the release as a stable sha256, equal across instances on the same data', () => {
    const release = rcsService.matrixMappingRelease();
    expect(release).toMatchObject({
      sprecMappingReleaseId: referenceData.matrixMapping.sprec_mapping_release_id,
      sprecVersion: 'SPREC-2.0',
      mappingVersion: '1.0.0',
      compatibilityStatus: 'current_baseline',
      status: 'active',
    });
    expect(release.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(new RcsCertificationService(referenceData).matrixMappingRelease()).toEqual(release);
  });

  it('gives another checksum when one rule term changes', () => {
    const rules = referenceData.matrixMapping.rules.map((rule, index) => (
      index === 0 ? { ...rule, contains_any: [...rule.contains_any.slice(1), 'lymph'] } : rule
    ));
    const changed = new RcsCertificationService({ ...referenceData, matrixMapping: { ...referenceData.matrixMapping, rules } });
    expect(changed.matrixMappingRelease().checksum).not.toBe(rcsService.matrixMappingRelease().checksum);
  });

  it('leaves the governance rule-set checksum as it was before the release', () => {
    expect(rcsService.governanceRuleSet().checksum)
      .toBe('sha256:0aa3cb01efdf45f4e1d08809ba30ffad1386f56c982a5cf07088d1f26c2b52d5');
  });
});

describe('sprecMappingRelease (RF018 AC1, #1320)', () => {
  const { RcsCertificationService } = rcsService;
  const checksumWith = (data) => new RcsCertificationService({ ...referenceData, ...data }).sprecMappingRelease().checksum;

  it('checksums the release and its tables as a stable sha256, equal across instances on the same data', () => {
    const release = rcsService.sprecMappingRelease();
    expect(release).toEqual({
      sprecMappingReleaseId: referenceData.sprecMapping.sprec_mapping_release_id,
      sprecVersion: referenceData.sprecMapping.sprec_version,
      mappingVersion: referenceData.sprecMapping.mapping_version,
      compatibilityStatus: referenceData.sprecMapping.compatibility_status,
      status: referenceData.sprecMapping.status,
      checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(release.sprecMappingReleaseId).toBe('a5341072-35e8-4bf4-a9d1-127bc47536da');
    expect(new RcsCertificationService(referenceData).sprecMappingRelease()).toEqual(release);
  });

  it('gives another checksum when one severity value changes', () => {
    const index = referenceData.severityMappings.findIndex((item) => typeof item.severity_value === 'number');
    const severityMappings = referenceData.severityMappings.map((item, i) => (
      i === index ? { ...item, severity_value: item.severity_value + 0.5 } : item
    ));
    expect(checksumWith({ severityMappings })).not.toBe(rcsService.sprecMappingRelease().checksum);
  });

  it('gives another checksum when one weight changes', () => {
    const weights = referenceData.weights.map((item, i) => (i === 0 ? { ...item, weight: Number(item.weight) + 1 } : item));
    expect(checksumWith({ weights })).not.toBe(rcsService.sprecMappingRelease().checksum);
  });

  it('gives another checksum with a fluid catalog entry dropped', () => {
    const catalogs = { ...referenceData.catalogs, fluid: referenceData.catalogs.fluid.slice(1) };
    expect(checksumWith({ catalogs })).not.toBe(rcsService.sprecMappingRelease().checksum);
  });

  it('is null with no release in the data', () => {
    const { sprecMapping, ...withoutRelease } = referenceData;
    expect(new RcsCertificationService(withoutRelease).sprecMappingRelease()).toBeNull();
  });

  it('leaves the governance rule-set and matrix mapping checksums as they were before the release', () => {
    expect(rcsService.governanceRuleSet().checksum)
      .toBe('sha256:0aa3cb01efdf45f4e1d08809ba30ffad1386f56c982a5cf07088d1f26c2b52d5');
    expect(rcsService.matrixMappingRelease().checksum)
      .toBe('sha256:d5749ff8cc4a834c7042b6d283b3634bbb3c1a856c4a15a278d786a7391d904e');
  });
});

describe('rulePackage (RF018 AC10, #1320)', () => {
  const { RcsCertificationService } = rcsService;
  const checksumWith = (data) => new RcsCertificationService({ ...referenceData, ...data }).rulePackage().checksum;

  it('checksums the package as a stable sha256 named by the model code, equal across instances on the same data', () => {
    const rulePackage = rcsService.rulePackage();
    expect(rulePackage).toEqual({ version: 'RCS-GOV-1.0', checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
    expect(rcsService.rulePackage()).toBe(rulePackage);
    expect(new RcsCertificationService(referenceData).rulePackage()).toEqual(rulePackage);
  });

  it('gives another checksum when one grade threshold changes', () => {
    const thresholds = referenceData.thresholds.map((item, i) => (i === 0 ? { ...item, min_inclusive: item.min_inclusive + 1 } : item));
    expect(checksumWith({ thresholds })).not.toBe(rcsService.rulePackage().checksum);
  });

  it('gives another checksum when one weight changes', () => {
    const weights = referenceData.weights.map((item, i) => (i === 0 ? { ...item, weight: Number(item.weight) + 1 } : item));
    expect(checksumWith({ weights })).not.toBe(rcsService.rulePackage().checksum);
  });

  it('gives another checksum when a governance rule description changes', () => {
    const governanceRules = referenceData.governanceRules.map((rule, index) => (
      index === 0 ? { ...rule, description: `${rule.description} (changed)` } : rule
    ));
    expect(checksumWith({ governanceRules })).not.toBe(rcsService.rulePackage().checksum);
  });

  it('is null with no SPREC or matrix mapping release in the data', () => {
    const { sprecMapping, matrixMapping, ...withoutReleases } = referenceData;
    expect(new RcsCertificationService({ ...withoutReleases, matrixMapping }).rulePackage()).toBeNull();
    expect(new RcsCertificationService({ ...withoutReleases, sprecMapping }).rulePackage()).toBeNull();
  });
});

describe('RCS_SCOPE_STATEMENT (RF018 AC11, #1320)', () => {
  it('states that the RCS is not clinical validity, assay quality or a universal measure', () => {
    expect(rcsService.RCS_SCOPE_STATEMENT).toBe('RCS qualifies the pre-analytical history of this specimen for the stated use context; it is not clinical validity, analytical assay quality or a universal quality measure.');
  });
});
