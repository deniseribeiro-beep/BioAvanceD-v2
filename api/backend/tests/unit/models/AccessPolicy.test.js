import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const AccessPolicyModel = require('../../../src/models/AccessPolicy');
const { evaluatePolicies, policiesInForce, compareVersions, accessRequestFacts } = AccessPolicyModel;

function payload(overrides = {}) {
  return {
    policyName: 'Oncologia',
    policyVersion: '1.0.0',
    applicableEntityTypes: ['AccessRequest'],
    purposeCodes: [],
    decisionEffect: 'permit',
    ruleExpression: 'all-conditions',
    effectivePeriod: { start: '2020-01-01', end: null },
    roleCodes: ['researcher'],
    organizationScopeIds: ['org-1'],
    resourceScopes: ['Specimen', 'DataFile'],
    conditions: [{ consent: 'compatible' }],
    decisionReasonsRequired: true,
    ...overrides,
  };
}

function policy(overrides = {}) {
  return AccessPolicyModel.create({ accessPolicyId: 'policy-1', ...payload(overrides) });
}

const request = {
  organizationId: 'org-1',
  studyId: 'study-1',
  protocolId: 'protocol-1',
  requestedPurpose: 'Estudo de biomarcadores',
  duoCode: 'DUO:0000007',
  requestedItems: [{ itemType: 'specimen', itemId: 'SPEC-1' }],
};
const compatible = [{ consentValid: true, duoCompatible: true, studyActive: true }];
const now = new Date('2026-06-15T00:00:00Z');

describe('AccessPolicy model', () => {
  describe('validate', () => {
    it('accepts a complete policy', () => {
      expect(AccessPolicyModel.validate(payload())).toEqual({ isValid: true, errors: [] });
    });

    it.each([
      ['a non-SemVer policyVersion', { policyVersion: 'v1' }, /policyVersion/],
      ['an unknown decisionEffect', { decisionEffect: 'allow' }, /decisionEffect/],
      ['an unknown ruleExpression', { ruleExpression: 'x && y' }, /ruleExpression/],
      ['empty roleCodes', { roleCodes: [] }, /roleCodes/],
      ['empty organizationScopeIds', { organizationScopeIds: [] }, /organizationScopeIds/],
      ['empty resourceScopes', { resourceScopes: [] }, /resourceScopes/],
      ['empty applicableEntityTypes', { applicableEntityTypes: [] }, /applicableEntityTypes/],
      ['no conditions', { conditions: [] }, /conditions é obrigatório/],
      ['an unknown fact', { conditions: [{ weather: 'sunny' }] }, /fato desconhecido/],
      ['a value outside a fact\'s set', { conditions: [{ consent: 'maybe' }] }, /consent deve ser um de/],
      ['an empty condition', { conditions: [{}] }, /objeto não vazio/],
      ['no effectivePeriod.start', { effectivePeriod: {} }, /effectivePeriod.start/],
      ['an end before the start', { effectivePeriod: { start: '2026-01-01', end: '2025-01-01' } }, /posterior/],
      ['a missing decisionReasonsRequired', { decisionReasonsRequired: undefined }, /decisionReasonsRequired/],
    ])('refuses %s', (_label, overrides, message) => {
      const { isValid, errors } = AccessPolicyModel.validate(payload(overrides));
      expect(isValid).toBe(false);
      expect(errors.join('; ')).toMatch(message);
    });
  });

  it('compares SemVer numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  describe('policiesInForce', () => {
    it('takes the highest version of each policy whose period holds', () => {
      const versions = [
        policy({ policyVersion: '1.0.0' }),
        policy({ policyVersion: '1.10.0' }),
        policy({ policyVersion: '1.9.0' }),
        policy({ policyVersion: '2.0.0', effectivePeriod: { start: '2027-01-01' } }),
      ];
      expect(policiesInForce(versions, now).map((p) => p.policyVersion)).toEqual(['1.10.0']);
    });

    it('drops a version whose period has ended', () => {
      expect(policiesInForce([policy({ effectivePeriod: { start: '2020-01-01', end: '2026-01-01' } })], now)).toEqual([]);
    });
  });

  describe('accessRequestFacts', () => {
    it('reads consent, DUO and study from the compatibility entries', () => {
      expect(accessRequestFacts(request, compatible)).toMatchObject({ consent: 'compatible', duo: 'compatible', study: 'active' });
      expect(accessRequestFacts(request, [{ consentValid: false, duoCompatible: null, studyActive: false }]))
        .toMatchObject({ consent: 'incompatible', duo: 'not_requested', study: 'inactive' });
    });
  });

  describe('evaluatePolicies', () => {
    it('is review_required with no applicable policy', () => {
      const result = evaluatePolicies([], request, compatible, now);
      expect(result).toMatchObject({ effect: 'review_required', appliedPolicies: [] });
      expect(result.reasons).toEqual(['nenhuma AccessPolicy aplicável: requer revisão do comitê']);
    });

    it('permits under a policy whose conditions hold', () => {
      const result = evaluatePolicies([policy()], request, compatible, now);
      expect(result.effect).toBe('permit');
      expect(result.appliedPolicies).toEqual([
        { accessPolicyId: 'policy-1', policyVersion: '1.0.0', decisionEffect: 'permit', decisionReasonsRequired: true },
      ]);
      expect(result.decisionReasonsRequired).toBe(true);
    });

    it('lets deny override review_required, and review_required override permit', () => {
      const permit = policy();
      const review = policy({ policyName: 'Revisão', decisionEffect: 'review_required' });
      review.accessPolicyId = 'policy-2';
      const deny = policy({ policyName: 'Embargo', decisionEffect: 'deny' });
      deny.accessPolicyId = 'policy-3';

      expect(evaluatePolicies([permit, review], request, compatible, now).effect).toBe('review_required');
      expect(evaluatePolicies([permit, review, deny], request, compatible, now).effect).toBe('deny');
    });

    it('denies an incompatible request whatever the policies say', () => {
      const result = evaluatePolicies([policy({ conditions: [{ organizationId: 'org-1' }] })], request, [{ consentValid: false, duoCompatible: null, studyActive: true }], now);
      expect(result.effect).toBe('deny');
      expect(result.reasons[0]).toMatch(/incompatível/);
    });

    it('records a policy in scope whose conditions fail as a reason, not as applied', () => {
      const result = evaluatePolicies([policy({ conditions: [{ protocolId: 'protocol-x' }] })], request, compatible, now);
      expect(result.appliedPolicies).toEqual([]);
      expect(result.reasons[0]).toBe('Oncologia 1.0.0: condições não atendidas');
    });

    it('applies an any-condition rule when one condition holds', () => {
      const rule = policy({ ruleExpression: 'any-condition', conditions: [{ protocolId: 'protocol-x' }, { studyId: 'study-1' }] });
      expect(evaluatePolicies([rule], request, compatible, now).effect).toBe('permit');
    });

    it('requires every key of one condition to hold', () => {
      const rule = policy({ conditions: [{ studyId: 'study-1', protocolId: 'protocol-x' }] });
      expect(evaluatePolicies([rule], request, compatible, now).appliedPolicies).toEqual([]);
    });

    it.each([
      ['another organization', { organizationScopeIds: ['org-2'] }],
      ['another resource', { resourceScopes: ['Dataset'] }],
      ['another role', { roleCodes: ['curator'] }],
      ['another entity type', { applicableEntityTypes: ['Specimen'] }],
      ['another purpose', { purposeCodes: ['DUO:0000042'] }],
      ['a period not yet begun', { effectivePeriod: { start: '2027-01-01' } }],
    ])('does not apply a policy scoped to %s', (_label, overrides) => {
      const result = evaluatePolicies([policy({ decisionEffect: 'deny', ...overrides })], request, compatible, now);
      expect(result.effect).toBe('review_required');
      expect(result.appliedPolicies).toEqual([]);
    });

    it('applies a policy whose purposeCodes name the request\'s DUO code', () => {
      const result = evaluatePolicies([policy({ purposeCodes: ['DUO:0000007'] })], request, compatible, now);
      expect(result.effect).toBe('permit');
    });

    it('matches a file item through the DataFile resource scope', () => {
      const fileRequest = { ...request, requestedItems: [{ itemType: 'file', itemId: 'f1' }] };
      expect(evaluatePolicies([policy({ resourceScopes: ['DataFile'] })], fileRequest, compatible, now).effect).toBe('permit');
    });
  });
});
