import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const RcsAssessmentModel = require('../../../src/models/RcsAssessment');

describe('RcsAssessmentModel', () => {
  describe('create', () => {
    it('requires specimenId', () => {
      expect(() => RcsAssessmentModel.create({})).toThrow('specimenId é obrigatório para RcsAssessment');
    });

    it('builds a full assessment document with defaults for missing fields', () => {
      const doc = RcsAssessmentModel.create({ specimenId: 'SPEC-1' });

      expect(doc.specimenId).toBe('SPEC-1');
      expect(doc.rcsScore).toBeNull();
      expect(doc.governanceFailureReasons).toEqual([]);
      expect(doc.axisPenalties).toEqual([]);
      expect(doc.assessedAt).toBeInstanceOf(Date);
      expect(doc.createdAt).toBeInstanceOf(Date);
    });

    it('honors an explicit assessedAt (for backfilled/historical snapshots)', () => {
      const doc = RcsAssessmentModel.create({ specimenId: 'SPEC-1', assessedAt: '2026-01-01T00:00:00.000Z' });
      expect(doc.assessedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('fromCertificationResult', () => {
    it('maps rcs-certification.service#certify() snake_case output onto camelCase fields', () => {
      const result = {
        model_version: 'RCS-GOV-1.0',
        matrix_type: 'fluid',
        governance_status: 1,
        governance_failure_reasons: [],
        governance_rule_codes: [],
        rcs_score: 92.5,
        score_based_grade: 'A',
        final_grade: 'A',
        grade_route: 'Score-based certification',
        axis_penalties: [{ axis_code: 'Ppre', penalty: 1.5 }],
        calculation_trace: { model_code: 'RCS-GOV-1.0' },
      };

      const doc = RcsAssessmentModel.fromCertificationResult('SPEC-2', result);

      expect(doc).toMatchObject({
        specimenId: 'SPEC-2',
        modelVersion: 'RCS-GOV-1.0',
        matrixType: 'fluid',
        governanceStatus: 1,
        rcsScore: 92.5,
        scoreBasedGrade: 'A',
        finalGrade: 'A',
        gradeRoute: 'Score-based certification',
        axisPenalties: [{ axis_code: 'Ppre', penalty: 1.5 }],
        calculationTrace: { model_code: 'RCS-GOV-1.0' },
      });
    });

    it('carries governance-failure results too (null score, non-empty failure reasons)', () => {
      const result = {
        model_version: 'RCS-GOV-1.0',
        matrix_type: 'unknown',
        governance_status: 0,
        governance_failure_reasons: ['Missing critical metadata'],
        governance_rule_codes: ['MISSING_CRITICAL_METADATA'],
        rcs_score: null,
        final_grade: 'E',
        grade_route: 'Governance failure',
        axis_penalties: [],
        calculation_trace: { sprec: {} },
      };

      const doc = RcsAssessmentModel.fromCertificationResult('SPEC-3', result);

      expect(doc.governanceStatus).toBe(0);
      expect(doc.rcsScore).toBeNull();
      expect(doc.governanceFailureReasons).toEqual(['Missing critical metadata']);
    });
  });
});

// RF018 AC2 and AC3 (#1320): the assessment's own id, its use context and
// the references to the RCSInputSnapshot it was computed from.
describe('RcsAssessmentModel v4 references', () => {
  it('emits rcsAssessmentId, qualificationContext and the three snapshot refs, defaulting to null', () => {
    const doc = RcsAssessmentModel.create({ specimenId: 'SPEC-1' });
    expect(doc.rcsAssessmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc).toMatchObject({
      qualificationContext: null, inputSnapshotId: null, inputSnapshotUri: null, inputSnapshotHash: null,
    });
  });

  it('fromCertificationResult maps qualification_context and spreads the refs', () => {
    const refs = {
      rcsAssessmentId: 'rcs-assessment-001',
      inputSnapshotId: 'rcs-input-snapshot-001',
      inputSnapshotUri: `urn:bioavanced:rcs-input-snapshot:rcs-input-snapshot-001#sha256=${'b'.repeat(64)}`,
      inputSnapshotHash: `sha256:${'b'.repeat(64)}`,
    };
    const context = { intendedUseCode: 'research-sequencing', targetAnalyte: 'cfDNA', assayFamily: null, workflowProtocolId: null, workflowProtocolVersion: null };
    const doc = RcsAssessmentModel.fromCertificationResult('SPEC-2', { rcs_score: 90, qualification_context: context }, refs);
    expect(doc).toMatchObject({ ...refs, qualificationContext: context, specimenId: 'SPEC-2', rcsScore: 90 });
  });
});

// RF018 AC6 and AC8 (#1320): each axis's resolution and the route's reasons.
describe('RcsAssessmentModel axis results and route reasons', () => {
  it('keeps the given arrays', () => {
    const rcsAxisResults = [{ axisCode: 'P_pre', resolutionStatus: 'unknown', weightedPenalty: null }];
    const routeReasons = ['governance failure', 'Unknown SPREC code'];
    const fields = RcsAssessmentModel.fieldsOf({ rcsAxisResults, routeReasons });
    expect(fields.rcsAxisResults).toBe(rcsAxisResults);
    expect(fields.routeReasons).toBe(routeReasons);
  });

  it('defaults both to an empty array', () => {
    expect(RcsAssessmentModel.fieldsOf({})).toMatchObject({ rcsAxisResults: [], routeReasons: [] });
  });

  it('turns a non-array into an empty array', () => {
    const fields = RcsAssessmentModel.fieldsOf({ rcsAxisResults: { axisCode: 'P_pre' }, routeReasons: 'governance failure' });
    expect(fields).toMatchObject({ rcsAxisResults: [], routeReasons: [] });
  });
});

// RF018 AC10 and AC11 (#1320): the rule package, the execution environment
// and the justifications.
describe('RcsAssessmentModel rule package, environment and justifications', () => {
  it('defaults the package and environment to null and the justifications to an empty array', () => {
    expect(RcsAssessmentModel.fieldsOf({})).toMatchObject({
      rulePackageVersion: null, rulePackageChecksum: null, executionEnvironment: null, justifications: [],
    });
  });

  it('keeps the given values and turns non-array justifications into an empty array', () => {
    const executionEnvironment = { runtime: 'node', packageVersion: 'RCS-GOV-1.0' };
    const fields = RcsAssessmentModel.fieldsOf({
      rulePackageVersion: 'RCS-GOV-1.0', rulePackageChecksum: 'sha256:abc', executionEnvironment, justifications: ['x'],
    });
    expect(fields).toMatchObject({ rulePackageVersion: 'RCS-GOV-1.0', rulePackageChecksum: 'sha256:abc', justifications: ['x'] });
    expect(fields.executionEnvironment).toBe(executionEnvironment);
    expect(RcsAssessmentModel.fieldsOf({ justifications: 'x' }).justifications).toEqual([]);
  });
});

// RF018 AC1 (#1320): the SPREC version the result was computed with.
describe('RcsAssessmentModel sprecVersion (V2E-0448)', () => {
  it('defaults to null and keeps a given value', () => {
    expect(RcsAssessmentModel.fieldsOf({}).sprecVersion).toBeNull();
    expect(RcsAssessmentModel.fieldsOf({ sprecVersion: 'SPREC-2.0' }).sprecVersion).toBe('SPREC-2.0');
  });

  it('fromCertificationResult takes the version the trace names', () => {
    const doc = RcsAssessmentModel.fromCertificationResult('SPEC-1', { calculation_trace: { sprec_version: 'SPREC-2.0' } });
    expect(doc.sprecVersion).toBe('SPREC-2.0');
  });

  it('is null for a result with no trace or a trace with no version', () => {
    expect(RcsAssessmentModel.fromCertificationResult('SPEC-1', {}).sprecVersion).toBeNull();
    expect(RcsAssessmentModel.fromCertificationResult('SPEC-1', { calculation_trace: { model_code: 'RCS-GOV-1.0' } }).sprecVersion).toBeNull();
  });

  it('takes the trace over a refs.sprecVersion, as the other result-derived keys do', () => {
    const doc = RcsAssessmentModel.fromCertificationResult(
      'SPEC-1', { calculation_trace: { sprec_version: 'SPREC-2.0' } }, { sprecVersion: 'SPREC-9.9' },
    );
    expect(doc.sprecVersion).toBe('SPREC-2.0');
  });
});
