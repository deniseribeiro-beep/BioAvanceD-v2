import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const qualityDomain = require('../../src/services/quality-domain.service');
const rcsAssessmentService = require('../../src/services/rcs-assessment.service');
const rcsCertificationService = require('../../src/services/rcs-certification.service');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('quality-domain.service item 8 residual branches', () => {
  it('reports invalid RCS input using joined input_errors when present', () => {
    vi.spyOn(rcsCertificationService, 'certify').mockReturnValue({
      governance_status: 0,
      final_grade: 'E',
      rcs_score: 0,
      grade_route: 'blocked',
      input_status: 'invalid',
      input_errors: ['missing axis A', 'missing axis B'],
    });

    const result = qualityDomain.validateQualityForRelease({ specimenId: 'SPEC-1' });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('RCS-GOV entrada inválida: missing axis A; missing axis B');
  });

  it('approves release from a persisted RCS snapshot without recomputing', async () => {
    vi.spyOn(rcsAssessmentService, 'getAssessmentsForSpecimen').mockResolvedValue([{
      governanceStatus: 1,
      finalGrade: 'B',
      rcsScore: 88,
      gradeRoute: 'approved',
      axisPenalties: [],
      calculationTrace: {},
    }]);

    const result = await qualityDomain.validateQualityForReleaseFromSample(
      { collection: vi.fn() },
      { specimenId: 'SPEC-APPROVED' }
    );

    expect(result.valid).toBe(true);
    expect(result.reason).toBe('RCS-GOV B aprovado (rcs_score 88)');
    expect(result.assessment.final_grade).toBe('B');
  });

  it('falls back to legacy evaluation when specimenId is blank', async () => {
    const assessmentSpy = vi.spyOn(rcsAssessmentService, 'getAssessmentsForSpecimen');
    vi.spyOn(rcsCertificationService, 'certify').mockReturnValue({
      governance_status: 1,
      final_grade: 'A',
      rcs_score: 99,
      grade_route: 'approved',
      input_status: 'valid',
    });

    const result = await qualityDomain.validateQualityForReleaseFromSample(
      { collection: vi.fn() },
      { specimenId: '   ' }
    );

    expect(assessmentSpy).not.toHaveBeenCalled();
    expect(result.valid).toBe(true);
    expect(result.reason).toContain('aprovado');
  });
});
