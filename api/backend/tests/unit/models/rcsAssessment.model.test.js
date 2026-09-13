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
