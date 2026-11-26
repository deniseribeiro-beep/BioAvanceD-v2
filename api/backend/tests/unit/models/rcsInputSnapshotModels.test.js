import { describe, it, expect } from 'vitest';

// #1320, RF018 AC3-AC7 and AC10: the frozen inputs of an RCS assessment.
// fieldsOf emits the catalog's fields, validate enforces each 1..1 and 1..*
// Core field, the axis sets of RULE-019 and RULE-020, the null-not-zero rule
// of RULE-011 and the non-compensable governance gate, and create returns the
// validated document deep-frozen.

const { loadCanonicalDictionary } = require('../../../src/reference-data/canonical-dictionary/v2');
const RcsInputSnapshotModel = require('../../../src/models/RcsInputSnapshot');
const RcsPreanalyticalAxisInputModel = require('../../../src/models/RcsPreanalyticalAxisInput');
const RcsGovernanceEvidenceSnapshotModel = require('../../../src/models/RcsGovernanceEvidenceSnapshot');

const catalog = loadCanonicalDictionary();
const rowsOf = (entity) => catalog.filter((row) => row.entity === entity);

const CHECKSUM = `sha256:${'a'.repeat(64)}`;

const MODELS = {
  RCSInputSnapshot: {
    model: RcsInputSnapshotModel,
    valid: {
      rcsInputSnapshotId: 'rcs-input-snapshot-001',
      rcsAssessmentId: 'rcs-assessment-synthetic-001',
      specimenId: 'specimen-synthetic-001',
      matrix: 'fluid',
      materialTypeCode: { systemUri: 'urn:synthetic:material-type', code: 'synthetic-plasma' },
      matrixMappingReleaseId: 'sprec-map-001',
      preanalyticalAxes: ['axis-pre', 'axis-cent1', 'axis-cent2', 'axis-post', 'axis-store'],
      governanceEvidenceId: 'rcs-gov-evidence-001',
      sprecVersion: '2.0',
      sprecMappingReleaseId: 'sprec-map-001',
      capturedAt: '2026-09-07T10:00:00.000Z',
      sourceEventIds: ['processing-event-001', 'storage-event-001'],
      snapshotUri: 'object://synthetic/rcs-input-snapshot-001.json',
      snapshotHash: CHECKSUM,
      schemaVersion: '2.0.0',
      immutable: true,
    },
  },
  RCSPreanalyticalAxisInput: {
    model: RcsPreanalyticalAxisInputModel,
    valid: {
      axisInputId: 'axis-pre-001',
      snapshotId: 'rcs-input-snapshot-001',
      axisCode: 'P_pre',
      sprecCode: 'A',
      severity: 0.2,
      maximumWeight: 30,
      weightedPenalty: 6,
      severityMappingReleaseId: 'sprec-map-001',
      resolutionStatus: 'resolved',
      applicabilityContext: { workflow: 'cell-free DNA' },
      evidenceIds: ['processing-event-001'],
    },
  },
  RCSGovernanceEvidenceSnapshot: {
    model: RcsGovernanceEvidenceSnapshotModel,
    valid: {
      governanceEvidenceSnapshotId: 'rcs-gov-evidence-001',
      snapshotId: 'rcs-input-snapshot-001',
      metadataComplete: true,
      terminologyValid: true,
      traceabilityOk: true,
      monitoringOk: true,
      documentationOk: true,
      semanticCompatible: true,
      evidenceRefs: ['custody-event-001', 'sop-version-001', 'telemetry-summary-001'],
      validationRuleSetVersion: '1.0.0',
      validationRuleSetChecksum: CHECKSUM,
      evaluatedAt: '2026-09-07T10:00:00.000Z',
      gateResult: 'pass',
      failureReasons: [],
    },
  },
};

describe.each(Object.entries(MODELS))('%s', (entity, { model, valid }) => {
  const rows = rowsOf(entity);
  // The id is assigned by fieldsOf when absent, and immutable defaults to
  // true, so neither is ever missing.
  const requiredFields = rows
    .filter((row) => row.requirement === 'Core' && /^[15]\.\./.test(row.cardinality) && row.type !== 'uuid')
    .map((row) => row.field)
    .filter((field) => field !== 'immutable');

  it('a valid document validates and create returns it', () => {
    expect(model.validate(valid)).toEqual({ isValid: true, errors: [] });
    expect(model.create(valid)).toEqual(model.fieldsOf(valid));
  });

  it('fieldsOf() with no argument emits exactly the catalog fields, in catalog order', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(model.fieldsOf())).toEqual(rows.map((row) => row.field));
  });

  it.each(requiredFields)('validate fails naming %s when it is absent', (field) => {
    const result = model.validate({ ...valid, [field]: undefined });
    expect(result.isValid).toBe(false);
    expect(result.errors.some((error) => error.startsWith(`${field} `))).toBe(true);
    // create stamps an absent capturedAt or evaluatedAt with now instead.
    if (!['capturedAt', 'evaluatedAt'].includes(field)) {
      expect(() => model.create({ ...valid, [field]: undefined })).toThrow(field);
    }
  });

  it('create returns a frozen document', () => {
    expect(Object.isFrozen(model.create(valid))).toBe(true);
  });
});

describe('RCSInputSnapshot checks', () => {
  const { valid } = MODELS.RCSInputSnapshot;

  it('refuses immutable false (V2E-0512)', () => {
    expect(RcsInputSnapshotModel.validate({ ...valid, immutable: false }).errors)
      .toEqual(['immutable deve ser true: uma correção exige um novo RCSInputSnapshot']);
  });

  it('refuses a matrix other than fluid or solid', () => {
    expect(RcsInputSnapshotModel.validate({ ...valid, matrix: 'tissue' }).errors)
      .toEqual(['matrix deve ser um de: fluid|solid (RF018 AC4): tissue']);
  });

  it('refuses a materialTypeCode that is not a Coding', () => {
    expect(RcsInputSnapshotModel.validate({ ...valid, materialTypeCode: 'synthetic-plasma' }).errors)
      .toEqual(['materialTypeCode deve ser um Coding com systemUri e code']);
  });

  it('refuses four or six preanalyticalAxes (5..5)', () => {
    expect(RcsInputSnapshotModel.validate({ ...valid, preanalyticalAxes: valid.preanalyticalAxes.slice(0, 4) }).isValid)
      .toBe(false);
    expect(RcsInputSnapshotModel.validate({ ...valid, preanalyticalAxes: [...valid.preanalyticalAxes, 'axis-x'] }).isValid)
      .toBe(false);
  });

  it('refuses a snapshotHash that is not SHA-256 and a schemaVersion that is not SemVer', () => {
    expect(RcsInputSnapshotModel.validate({ ...valid, snapshotHash: 'sha256:synthetic-rcs-input' }).errors)
      .toEqual(['snapshotHash deve ser um digest SHA-256: sha256:synthetic-rcs-input']);
    expect(RcsInputSnapshotModel.validate({ ...valid, schemaVersion: '2.0' }).errors)
      .toEqual(['schemaVersion deve ser SemVer (MAJOR.MINOR.PATCH): 2.0']);
  });

  it('create stamps an absent capturedAt with now', () => {
    const before = Date.now();
    const created = RcsInputSnapshotModel.create({ ...valid, capturedAt: undefined });
    expect(created.capturedAt).toBeInstanceOf(Date);
    expect(created.capturedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  // The test file is an ES module, so it runs in strict mode and an
  // assignment to a frozen property throws.
  it('create freezes the snapshot deeply: a property, an axis and the Coding cannot change (AC10)', () => {
    const created = RcsInputSnapshotModel.create(valid);
    expect(() => { created.matrix = 'solid'; }).toThrow(TypeError);
    expect(() => { created.preanalyticalAxes.push('axis-extra'); }).toThrow(TypeError);
    expect(() => { created.sourceEventIds[0] = 'other-event'; }).toThrow(TypeError);
    expect(() => { created.materialTypeCode.code = 'other'; }).toThrow(TypeError);
    expect(created.preanalyticalAxes).toHaveLength(5);
  });

  it('create leaves the caller\'s arrays unfrozen', () => {
    const preanalyticalAxes = [...valid.preanalyticalAxes];
    RcsInputSnapshotModel.create({ ...valid, preanalyticalAxes });
    expect(Object.isFrozen(preanalyticalAxes)).toBe(false);
  });
});

describe('RCSInputSnapshot.checkAxisSet (RULE-019, RULE-020)', () => {
  const inputs = (codes) => codes.map((axisCode) => ({ axisCode }));
  const { AXIS_CODES } = RcsInputSnapshotModel;

  it('exports the two axis sets', () => {
    expect(AXIS_CODES).toEqual({
      fluid: ['P_pre', 'P_cent1', 'P_cent2', 'P_post', 'P_store'],
      solid: ['P_warm', 'P_cold', 'P_fix', 'P_fixTime', 'P_store'],
    });
  });

  it('accepts the fluid set and the solid set, in any order', () => {
    expect(RcsInputSnapshotModel.checkAxisSet('fluid', inputs(AXIS_CODES.fluid))).toEqual({ isValid: true, errors: [] });
    expect(RcsInputSnapshotModel.checkAxisSet('solid', inputs([...AXIS_CODES.solid].reverse())))
      .toEqual({ isValid: true, errors: [] });
  });

  it('refuses a fluid set carrying a solid axis', () => {
    const result = RcsInputSnapshotModel.checkAxisSet('fluid', inputs(['P_pre', 'P_cent1', 'P_cent2', 'P_warm', 'P_store']));
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      'eixo ausente para a matriz fluid: P_post',
      'eixo não pertence à matriz fluid: P_warm',
    ]);
  });

  it('refuses a four-axis set', () => {
    const result = RcsInputSnapshotModel.checkAxisSet('solid', inputs(AXIS_CODES.solid.slice(0, 4)));
    expect(result.errors).toEqual([
      'a matriz solid exige exatamente 5 eixos: 4 recebidos',
      'eixo ausente para a matriz solid: P_store',
    ]);
  });

  it('refuses a duplicated axis', () => {
    const result = RcsInputSnapshotModel.checkAxisSet('fluid', inputs(['P_pre', 'P_pre', 'P_cent2', 'P_post', 'P_store']));
    expect(result.errors).toEqual([
      'eixo duplicado para a matriz fluid: P_pre',
      'eixo ausente para a matriz fluid: P_cent1',
    ]);
  });

  it('refuses an unknown matrix', () => {
    expect(RcsInputSnapshotModel.checkAxisSet('tissue', inputs(AXIS_CODES.fluid)).isValid).toBe(false);
  });
});

describe('RCSPreanalyticalAxisInput checks', () => {
  const { valid } = MODELS.RCSPreanalyticalAxisInput;
  const unresolved = { ...valid, resolutionStatus: 'unknown', severity: null, weightedPenalty: null };

  it('exports the resolution statuses', () => {
    expect(RcsPreanalyticalAxisInputModel.RESOLUTION_STATUSES)
      .toEqual(['resolved', 'absent', 'unknown', 'invalid', 'incompatible', 'not_scored']);
  });

  it('refuses an axisCode outside the nine codes', () => {
    expect(RcsPreanalyticalAxisInputModel.validate({ ...valid, axisCode: 'Ppre' }).errors)
      .toEqual(['axisCode inválido: Ppre']);
  });

  it('refuses a resolved axis whose weightedPenalty is not maximumWeight * severity', () => {
    expect(RcsPreanalyticalAxisInputModel.validate({ ...valid, weightedPenalty: 5 }).errors)
      .toEqual(['weightedPenalty deve ser maximumWeight * severity: 5']);
  });

  it('accepts a resolved axis with severity 0 and penalty 0', () => {
    expect(RcsPreanalyticalAxisInputModel.validate({ ...valid, severity: 0, weightedPenalty: 0 }).isValid).toBe(true);
  });

  it('refuses a severity outside 0..1 on a resolved axis', () => {
    expect(RcsPreanalyticalAxisInputModel.validate({ ...valid, severity: 1.5, weightedPenalty: 45 }).errors)
      .toEqual(['severity deve ser um número entre 0 e 1: 1.5']);
  });

  it('accepts an unresolved axis with null severity and penalty (RULE-011)', () => {
    expect(RcsPreanalyticalAxisInputModel.validate(unresolved)).toEqual({ isValid: true, errors: [] });
  });

  it('refuses an unresolved axis with severity 0, never a zero penalty (RULE-011)', () => {
    expect(RcsPreanalyticalAxisInputModel.validate({ ...unresolved, severity: 0 }).errors)
      .toEqual(['severity deve ser null para um eixo unknown, nunca 0']);
    expect(RcsPreanalyticalAxisInputModel.validate({ ...unresolved, weightedPenalty: 0 }).errors)
      .toEqual(['weightedPenalty deve ser null para um eixo unknown, nunca 0']);
  });

  it('refuses an applicabilityContext that is not an object', () => {
    expect(RcsPreanalyticalAxisInputModel.validate({ ...valid, applicabilityContext: 'cfDNA' }).errors)
      .toEqual(['applicabilityContext deve ser um objeto (0..1)']);
  });

  it('accepts an absent applicabilityContext (0..1)', () => {
    expect(RcsPreanalyticalAxisInputModel.validate({ ...valid, applicabilityContext: undefined }).isValid).toBe(true);
  });
});

describe('RCSGovernanceEvidenceSnapshot checks', () => {
  const { valid } = MODELS.RCSGovernanceEvidenceSnapshot;
  const { GOVERNANCE_FLAGS } = RcsGovernanceEvidenceSnapshotModel;

  it('exports the six flags and the gate results', () => {
    expect(GOVERNANCE_FLAGS).toEqual([
      'metadataComplete', 'terminologyValid', 'traceabilityOk', 'monitoringOk', 'documentationOk', 'semanticCompatible',
    ]);
    expect(RcsGovernanceEvidenceSnapshotModel.GATE_RESULTS).toEqual(['pass', 'fail', 'review_required']);
  });

  it.each(GOVERNANCE_FLAGS)('refuses gateResult pass when %s is false (G_gov is a product)', (flag) => {
    expect(RcsGovernanceEvidenceSnapshotModel.validate({ ...valid, [flag]: false }).errors)
      .toEqual(['gateResult pass exige os seis critérios de governança true']);
  });

  it('accepts gateResult fail with a false flag and a failure reason', () => {
    const failed = { ...valid, monitoringOk: false, gateResult: 'fail', failureReasons: ['telemetry gap'] };
    expect(RcsGovernanceEvidenceSnapshotModel.validate(failed)).toEqual({ isValid: true, errors: [] });
  });

  it('refuses a non-pass result with empty failureReasons (V2E-0537)', () => {
    const failed = { ...valid, monitoringOk: false, gateResult: 'review_required', failureReasons: [] };
    expect(RcsGovernanceEvidenceSnapshotModel.validate(failed).errors)
      .toEqual(['failureReasons é obrigatório quando gateResult é review_required']);
  });

  it('refuses a missing flag instead of reading it as false', () => {
    const failed = { ...valid, documentationOk: undefined, gateResult: 'fail', failureReasons: ['no SOP'] };
    expect(RcsGovernanceEvidenceSnapshotModel.validate(failed).errors)
      .toEqual(['documentationOk é obrigatório para RCSGovernanceEvidenceSnapshot (1..1, boolean)']);
  });

  it('refuses a flag that is not strictly boolean', () => {
    expect(RcsGovernanceEvidenceSnapshotModel.validate({ ...valid, traceabilityOk: 'true' }).isValid).toBe(false);
  });

  it('refuses a gateResult outside the set', () => {
    expect(RcsGovernanceEvidenceSnapshotModel.validate({ ...valid, gateResult: 'warn' }).errors)
      .toEqual(['gateResult inválido: warn']);
  });

  it('refuses a validationRuleSetChecksum that is not SHA-256', () => {
    expect(RcsGovernanceEvidenceSnapshotModel.validate({ ...valid, validationRuleSetChecksum: 'abc' }).errors)
      .toEqual(['validationRuleSetChecksum deve ser um digest SHA-256: abc']);
  });
});

// RF018 AC3 (#1320): capture freezes the input an assessment was computed
// from, with no reference a release or event does not back yet.
describe('RcsInputSnapshotModel.capture', () => {
  const crypto = require('crypto');
  const { canonicalJson } = require('../../../src/models/ConfigurationRelease');
  const base = () => ({
    rcsInputSnapshotId: 'rcs-input-snapshot-001',
    rcsAssessmentId: 'rcs-assessment-001',
    specimenId: 'specimen-synthetic-001',
    matrix: 'fluid',
    sprecVersion: '2.0',
    capturedAt: '2026-10-22T10:00:00.000Z',
    inputs: { matrix_type: 'fluid', sprec: { sampleType: 'PL1', longTermStorage: 'A' } },
  });

  it('nulls every reference no source backs and names its own schemaVersion', () => {
    const snapshot = RcsInputSnapshotModel.capture(base());
    expect(snapshot).toMatchObject({
      matrix: 'fluid', sprecVersion: '2.0', sourceEventIds: [], preanalyticalAxes: [],
      materialTypeCode: null, matrixMappingReleaseId: null, governanceEvidenceId: null, sprecMappingReleaseId: null,
      schemaVersion: RcsInputSnapshotModel.CAPTURE_SCHEMA_VERSION, immutable: true,
    });
    expect(RcsInputSnapshotModel.capture({ ...base(), matrix: 'unknown' }).matrix).toBeNull();
    expect(RcsInputSnapshotModel.validate(snapshot).isValid).toBe(false);
  });

  it('returns the document frozen at every level, inputs.sprec included', () => {
    const snapshot = RcsInputSnapshotModel.capture(base());
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.inputs)).toBe(true);
    expect(Object.isFrozen(snapshot.inputs.sprec)).toBe(true);
    expect(Object.isFrozen(snapshot.sourceEventIds)).toBe(true);
  });

  it('hashes the sha256 of canonicalJson without the hash and the URI', () => {
    const { snapshotHash, snapshotUri: _uri, ...content } = RcsInputSnapshotModel.capture(base());
    const hex = crypto.createHash('sha256').update(canonicalJson(content)).digest('hex');
    expect(content.inputs).toEqual(base().inputs);
    expect(snapshotHash).toBe(`sha256:${hex}`);
  });

  it('gives the same hash for the same ids, inputs and capturedAt, and another for a changed input code', () => {
    const first = RcsInputSnapshotModel.capture(base());
    expect(RcsInputSnapshotModel.capture(base()).snapshotHash).toBe(first.snapshotHash);
    const changed = base();
    changed.inputs.sprec.longTermStorage = 'B';
    expect(RcsInputSnapshotModel.capture(changed).snapshotHash).not.toBe(first.snapshotHash);
  });

  it('names the snapshot by id and pins its hash in the URI', () => {
    const snapshot = RcsInputSnapshotModel.capture(base());
    expect(snapshot.snapshotUri)
      .toBe(`urn:bioavanced:rcs-input-snapshot:rcs-input-snapshot-001#sha256=${snapshot.snapshotHash.slice('sha256:'.length)}`);
  });

  it.each([
    ['rcsInputSnapshotId', { rcsInputSnapshotId: 42 }],
    ['rcsAssessmentId', { rcsAssessmentId: '' }],
    ['specimenId', { specimenId: '  ' }],
  ])('throws when %s is not a non-empty string', (field, override) => {
    expect(() => RcsInputSnapshotModel.capture({ ...base(), ...override }))
      .toThrow(`${field} é obrigatório para RCSInputSnapshot.capture`);
  });

  it('keeps a given governanceEvidenceId inside its hash', () => {
    const linked = RcsInputSnapshotModel.capture({ ...base(), governanceEvidenceId: 'rcs-gov-evidence-001' });
    expect(linked.governanceEvidenceId).toBe('rcs-gov-evidence-001');
    expect(linked.snapshotHash).not.toBe(RcsInputSnapshotModel.capture(base()).snapshotHash);
    expect(RcsInputSnapshotModel.capture({ ...base(), governanceEvidenceId: '' }).governanceEvidenceId).toBeNull();
  });

  // RF018 AC4 (#1320): the matrix resolution's material and release.
  const coding = { systemUri: 'urn:bioavanced:sprec-2.0:type-of-sample', code: 'PL1', version: 'SPREC-2.0', display: 'Plasma, single spun' };

  it('keeps a given materialTypeCode Coding inside its hash', () => {
    const coded = RcsInputSnapshotModel.capture({ ...base(), materialTypeCode: coding });
    expect(coded.materialTypeCode).toEqual(coding);
    expect(coded.snapshotHash).not.toBe(RcsInputSnapshotModel.capture(base()).snapshotHash);
  });

  it('keeps a given matrixMappingReleaseId inside its hash', () => {
    const released = RcsInputSnapshotModel.capture({ ...base(), matrixMappingReleaseId: 'matrix-mapping-release-001' });
    expect(released.matrixMappingReleaseId).toBe('matrix-mapping-release-001');
    expect(released.snapshotHash).not.toBe(RcsInputSnapshotModel.capture(base()).snapshotHash);
  });

  it('drops a materialTypeCode that is not a Coding', () => {
    expect(RcsInputSnapshotModel.capture({ ...base(), materialTypeCode: 'PL1' }).materialTypeCode).toBeNull();
    expect(RcsInputSnapshotModel.capture({ ...base(), materialTypeCode: { code: 'PL1' } }).materialTypeCode).toBeNull();
  });

  // RF018 AC1 (#1320): the SPREC mapping release of the codes, severities
  // and weights, with no matrix condition.
  it('keeps a given sprecMappingReleaseId inside its hash', () => {
    const released = RcsInputSnapshotModel.capture({ ...base(), sprecMappingReleaseId: 'sprec-mapping-release-001' });
    expect(released.sprecMappingReleaseId).toBe('sprec-mapping-release-001');
    expect(released.snapshotHash).not.toBe(RcsInputSnapshotModel.capture(base()).snapshotHash);
  });

  it.each([[''], ['  '], [42], [{ id: 'sprec-mapping-release-001' }]])('drops a sprecMappingReleaseId of %j', (sprecMappingReleaseId) => {
    const snapshot = RcsInputSnapshotModel.capture({ ...base(), sprecMappingReleaseId });
    expect(snapshot.sprecMappingReleaseId).toBeNull();
    expect(snapshot.snapshotHash).toBe(RcsInputSnapshotModel.capture(base()).snapshotHash);
  });

  it('drops the matrixMappingReleaseId beside a matrix that is neither fluid nor solid', () => {
    const snapshot = RcsInputSnapshotModel.capture({ ...base(), matrix: 'unknown', matrixMappingReleaseId: 'matrix-mapping-release-001' });
    expect(snapshot.matrix).toBeNull();
    expect(snapshot.matrixMappingReleaseId).toBeNull();
  });

  it('throws when inputs is not a plain object', () => {
    expect(() => RcsInputSnapshotModel.capture({ ...base(), inputs: ['matrix_type'] }))
      .toThrow('inputs deve ser um objeto para RCSInputSnapshot.capture');
  });
});

// RF018 AC7 (#1320): capture keeps the six criteria the gate evaluated, each
// true, false or null with its reason, and the evidenceRefs it is given, empty
// where none is given (RNF018 AC5 (#1524), V2E-0532).
describe('RcsGovernanceEvidenceSnapshotModel.capture', () => {
  const UNREAD = 'não lido por este cálculo';
  const base = () => ({
    governanceEvidenceSnapshotId: 'rcs-gov-evidence-001',
    snapshotId: 'rcs-input-snapshot-001',
    metadataComplete: true,
    terminologyValid: true,
    traceabilityOk: null,
    monitoringOk: null,
    documentationOk: false,
    semanticCompatible: null,
    unresolvedReasons: { traceabilityOk: UNREAD, monitoringOk: UNREAD, semanticCompatible: UNREAD },
    validationRuleSetVersion: 'RCS-GOV-1.0',
    validationRuleSetChecksum: CHECKSUM,
    evaluatedAt: '2026-10-23T10:00:00.000Z',
    gateResult: 'fail',
    failureReasons: ['Insufficient documentation'],
  });
  const unresolved = () => ({
    ...base(),
    documentationOk: null,
    unresolvedReasons: { ...base().unresolvedReasons, documentationOk: UNREAD, gateResult: UNREAD },
    gateResult: null,
    failureReasons: [],
  });

  it('keeps the catalog fields and unresolvedReasons, with evidenceRefs empty', () => {
    const evidence = RcsGovernanceEvidenceSnapshotModel.capture(base());
    expect(evidence).toEqual({
      ...RcsGovernanceEvidenceSnapshotModel.fieldsOf({ ...base(), evidenceRefs: [] }),
      unresolvedReasons: base().unresolvedReasons,
    });
    expect(evidence.evidenceRefs).toEqual([]);
    expect(evidence.evaluatedAt).toEqual(new Date('2026-10-23T10:00:00.000Z'));
    expect(RcsGovernanceEvidenceSnapshotModel.validate(evidence).isValid).toBe(false);
  });

  // RNF018 AC5 (#1524), V2E-0532: the resolved references are kept.
  it('keeps a caller evidenceRefs and defaults evaluatedAt to now', () => {
    const evidence = RcsGovernanceEvidenceSnapshotModel.capture({ ...base(), evidenceRefs: ['custody-1'], evaluatedAt: undefined });
    expect(evidence.evidenceRefs).toEqual(['custody-1']);
    expect(evidence.evaluatedAt).toBeInstanceOf(Date);
  });

  // RNF018 AC5 (#1524), V2E-0532: a present evidenceRefs that is not a list
  // of non-empty references is refused.
  it.each([
    ['a string', 'custody-1'],
    ['a list with an empty reference', ['']],
    ['a list with a number', [42]],
  ])('throws when evidenceRefs is %s', (_name, evidenceRefs) => {
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture({ ...base(), evidenceRefs }))
      .toThrow('evidenceRefs deve ser uma lista de referências não vazias para RCSGovernanceEvidenceSnapshot.capture');
  });

  it('accepts a null gateResult with every null flag and gateResult given a reason', () => {
    expect(RcsGovernanceEvidenceSnapshotModel.capture(unresolved()).gateResult).toBeNull();
  });

  it('returns the document frozen at every level, unresolvedReasons included', () => {
    const evidence = RcsGovernanceEvidenceSnapshotModel.capture(base());
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.unresolvedReasons)).toBe(true);
    expect(Object.isFrozen(evidence.failureReasons)).toBe(true);
    expect(Object.isFrozen(evidence.evidenceRefs)).toBe(true);
  });

  it.each([
    ['governanceEvidenceSnapshotId', { governanceEvidenceSnapshotId: '' }],
    ['snapshotId', { snapshotId: 42 }],
    ['snapshotId', { snapshotId: undefined }],
  ])('throws when %s is not a non-empty string', (field, override) => {
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture({ ...base(), ...override }))
      .toThrow(`${field} é obrigatório para RCSGovernanceEvidenceSnapshot.capture`);
  });

  it.each([['true'], [0], [undefined]])('throws when a flag is %s, not true, false or null', (value) => {
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture({ ...base(), metadataComplete: value })).toThrow(/metadataComplete/);
  });

  it.each([
    ['not a plain object', { unresolvedReasons: [] }],
    ['missing a null flag', { unresolvedReasons: { traceabilityOk: UNREAD, monitoringOk: UNREAD } }],
    ['naming a non-null flag', { unresolvedReasons: { ...base().unresolvedReasons, metadataComplete: UNREAD } }],
    ['naming gateResult when it is not null', { unresolvedReasons: { ...base().unresolvedReasons, gateResult: UNREAD } }],
    ['with an empty reason', { unresolvedReasons: { ...base().unresolvedReasons, monitoringOk: ' ' } }],
  ])('throws when unresolvedReasons is %s', (_label, override) => {
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture({ ...base(), ...override })).toThrow(/unresolvedReasons/);
  });

  it('throws when a null gateResult has no reason', () => {
    const { gateResult: _reason, ...reasons } = unresolved().unresolvedReasons;
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture({ ...unresolved(), unresolvedReasons: reasons })).toThrow(/unresolvedReasons/);
  });

  it('throws on a gateResult outside the set', () => {
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture({ ...base(), gateResult: 'warn' })).toThrow('gateResult inválido: warn');
  });

  it('throws on a pass with a null flag (G_gov is a product)', () => {
    const passed = { ...base(), documentationOk: true, gateResult: 'pass', failureReasons: [] };
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture(passed))
      .toThrow('gateResult pass exige os seis critérios de governança true');
  });

  it.each(['fail', 'review_required'])('throws on %s with no failure reason (V2E-0537)', (gateResult) => {
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture({ ...base(), gateResult, failureReasons: [] }))
      .toThrow(`failureReasons é obrigatório quando gateResult é ${gateResult}`);
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture({ ...base(), gateResult, failureReasons: [''] }))
      .toThrow(`failureReasons é obrigatório quando gateResult é ${gateResult}`);
  });

  it.each([[null], ['review_required']])('throws on a %s gateResult with a false flag (eq:governance_product)', (gateResult) => {
    const unresolvedReasons = gateResult === null
      ? { ...base().unresolvedReasons, gateResult: UNREAD }
      : base().unresolvedReasons;
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture({ ...base(), gateResult, unresolvedReasons }))
      .toThrow(/gateResult deve ser fail/);
  });

  it('throws on an evaluatedAt that is not a valid date', () => {
    expect(() => RcsGovernanceEvidenceSnapshotModel.capture({ ...base(), evaluatedAt: 'garbage' })).toThrow(/evaluatedAt/);
  });
});
