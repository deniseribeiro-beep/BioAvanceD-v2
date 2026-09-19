import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const referenceData = require('../../src/services/rcs-reference-data');
const { RcsCertificationService } = require('../../src/services/rcs-certification.service');

function evidenceWith(overrides = {}) {
  return Object.fromEntries(referenceData.governanceEvidenceCategories.map(({ key }) => [
    key,
    Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : 'satisfied',
  ]));
}

describe('RCS-GOV item 8 residual canonical branches', () => {
  it('accepts snake_case evidence keys and object state/status/value aliases', () => {
    const service = new RcsCertificationService();
    const evidence = {};
    referenceData.governanceEvidenceCategories.forEach(({ key }, index) => {
      const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      evidence[snake] = index === 0
        ? { state: 'satisfied' }
        : index === 1
          ? { status: 'satisfied' }
          : index === 2
            ? { value: 'satisfied' }
            : 'satisfied';
    });

    const result = service.evaluateGovernanceEvidence({
      governance_evidence: evidence,
      governance_outcome: 'review required',
    });

    expect(result.valid).toBe(true);
    expect(result.status).toBe(0);
    expect(result.outcome).toBe('review');
    expect(Object.values(result.evidence)).toEqual(
      Array(referenceData.governanceEvidenceCategories.length).fill('satisfied')
    );
  });

  it('covers the compatibility evaluateGovernance default payload', () => {
    const service = new RcsCertificationService();
    const result = service.evaluateGovernance();
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Explicit governance evidence is required');
  });

  it('rejects an invalid matrix directly in SPREC reference validation', () => {
    const service = new RcsCertificationService();
    expect(service.validateSprecReference({}, 'unsupported')).toEqual({
      status: 'not_scoreable',
      reasons: ['Missing or invalid matrix type'],
      trace: [{ rule_code: 'MISSING_CRITICAL_METADATA', reason: 'Missing or invalid matrix type' }],
    });
  });

  it('uses the field name when no matrix axis exists', () => {
    const service = new RcsCertificationService();
    expect(service.axisCodeForField('unsupported', 'customField')).toBe('customField');
  });

  it('matches a conditional seeded severity by explicit workflow rule', () => {
    const service = new RcsCertificationService();
    const result = service.resolveSeverity(
      { Pcent2_workflow_rule: 'pcent2_not_required' },
      'fluid',
      'Pcent2',
      'N'
    );
    expect(result.is_scored).toBe(true);
    expect(result.workflow_rule).toBe('pcent2_not_required');
  });

  it('throws when a matrix-axis weight is absent from the configured reference data', () => {
    const service = new RcsCertificationService({ ...referenceData, weights: [] });
    expect(() => service.findWeight('fluid', 'Ppre')).toThrow('Missing RCS axis weight');
  });

  it('throws when no threshold covers a score', () => {
    const service = new RcsCertificationService({ ...referenceData, thresholds: [] });
    expect(() => service.gradeFromScore(50)).toThrow('RCS score outside configured thresholds');
  });

  it('throws when a mapped governance rule is not seeded', () => {
    const service = new RcsCertificationService({ ...referenceData, governanceRules: [] });
    expect(() => service.ruleCodeForReason('Unknown SPREC code')).toThrow('Missing seeded governance rule');
  });

  it('normalizes governance-failure trace reasons and the no-reason fallback', () => {
    const service = new RcsCertificationService();
    const result = service.governanceFailureResult(
      'fluid',
      ['Unknown SPREC code'],
      {},
      [
        { reason: 'Unknown SPREC code' },
        {},
      ],
      { governanceOutcome: 'failed', governanceEvidence: evidenceWith() }
    );

    expect(result.governance_rule_codes).toContain('UNKNOWN_SPREC_CODE');
    expect(result.calculation_trace.governance_trace).toEqual([
      expect.objectContaining({ rule_code: 'UNKNOWN_SPREC_CODE' }),
      expect.objectContaining({ rule_code: 'NOT_SCORED' }),
    ]);
  });

  it('fails closed if governanceFailureResult references a rule removed from the seed', () => {
    const service = new RcsCertificationService({ ...referenceData, governanceRules: [] });
    expect(() => service.governanceFailureResult(
      'fluid',
      ['Unknown SPREC code'],
      {},
      []
    )).toThrow('Missing seeded governance rule');
  });
});
