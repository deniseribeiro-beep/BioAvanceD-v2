import { describe, it, expect } from 'vitest';
const { rcsReadinessGate, RCS_GOLDEN_VECTORS } = require('../../../src/foundation/rcs-readiness');
const rcsService = require('../../../src/services/rcs-certification.service');
const { RcsCertificationService, referenceData } = require('../../../src/services/rcs-certification.service');

/**
 * RF022 AC3, plano §9 "RCS" and §11 (#1320): the Foundation `rcs` gate
 * evaluates the build's rule package, axes, six governance criteria, input
 * snapshot hash and golden-vector recalculation, and fails closed.
 *
 * Each mutated service gets fresh data; referenceData itself is never edited.
 */
const serviceWith = (overrides) => new RcsCertificationService({ ...referenceData, ...overrides });
const checkOf = (gate, name) => gate.evidence.checks.find((entry) => entry.check === name);

describe('Foundation rcs readiness gate', () => {
  it('passes on the build data with all five checks passed and the rule package as evidence', () => {
    const gate = rcsReadinessGate();

    expect(gate).toMatchObject({ gate: 'rcs', result: 'pass', p0: true });
    expect(gate.evidence.error).toBeUndefined();
    expect(gate.evidence.checks.map(({ check, passed }) => ({ check, passed }))).toEqual([
      { check: 'releases', passed: true },
      { check: 'axes', passed: true },
      { check: 'governance-evidence', passed: true },
      { check: 'input-snapshot', passed: true },
      { check: 'golden-vectors', passed: true },
    ]);
    expect(gate.evidence.rulePackage.checksum).toBe(rcsService.rulePackage().checksum);
    expect(gate.evidence).toMatchObject({
      governanceRuleSet: rcsService.governanceRuleSet(),
      matrixMappingRelease: rcsService.matrixMappingRelease(),
      sprecMappingRelease: rcsService.sprecMappingRelease(),
    });
    expect(RCS_GOLDEN_VECTORS).toHaveLength(10);
  });

  it('fails releases when the SPREC mapping release is absent', () => {
    const gate = rcsReadinessGate({ service: serviceWith({ sprecMapping: null }) });

    expect(gate.result).toBe('fail');
    expect(checkOf(gate, 'releases')).toMatchObject({ passed: false });
    expect(checkOf(gate, 'releases').detail).toContain('sprecMappingRelease is null');
    expect(checkOf(gate, 'releases').detail).toContain('rulePackage is null');
  });

  it('fails axes when a fluid axis has no weight row', () => {
    const weights = referenceData.weights.filter((row) => !(row.matrix_type === 'fluid' && row.axis_code === 'Ppre'));
    const gate = rcsReadinessGate({ service: serviceWith({ weights }) });

    expect(gate.result).toBe('fail');
    expect(checkOf(gate, 'axes')).toMatchObject({ passed: false });
    expect(checkOf(gate, 'axes').detail).toContain('fluid.Ppre: 0 weight rows, expected 1');
    expect(gate.evidence.error).toMatch(/Missing RCS axis weight for fluid\.Ppre/);
  });

  it('fails golden-vectors when a threshold moves a vector to another grade', () => {
    const thresholds = referenceData.thresholds.map((row) => {
      if (row.grade === 'B') return { ...row, min_inclusive: 86 };
      if (row.grade === 'C') return { ...row, max_exclusive: 86 };
      return { ...row };
    });
    const gate = rcsReadinessGate({ service: serviceWith({ thresholds }) });

    expect(gate.result).toBe('fail');
    expect(gate.evidence.error).toBeUndefined();
    expect(checkOf(gate, 'golden-vectors')).toMatchObject({ passed: false });
    expect(checkOf(gate, 'golden-vectors').detail).toContain('solid-b');
    expect(checkOf(gate, 'golden-vectors').detail).not.toContain('fluid-mid');
  });

  it('fails closed with the error as evidence, never throwing, when a governance rule is missing', () => {
    let gate;
    expect(() => { gate = rcsReadinessGate({ service: serviceWith({ governanceRules: [] }) }); }).not.toThrow();

    expect(gate).toMatchObject({ gate: 'rcs', result: 'fail', p0: true });
    expect(gate.evidence.error).toMatch(/Missing seeded governance rule/);
  });
});
