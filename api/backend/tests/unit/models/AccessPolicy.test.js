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
// RNF008 AC3 (#1496): each entry carries its item's study and protocol.
const compatible = [{ consentValid: true, duoCompatible: true, studyActive: true, studyId: 'study-1', protocolId: 'protocol-1' }];
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
      ['another study', { conditions: [{ studyId: 'study-2' }] }],
      ['another protocol', { conditions: [{ protocolId: 'protocol-2' }] }],
      ['another collection', { conditions: [{ collectionId: 'collection-2' }] }],
    ])('does not apply a policy scoped to %s', (_label, overrides) => {
      const result = evaluatePolicies([policy({ decisionEffect: 'deny', ...overrides })], request, compatible, now);
      expect(result.effect).toBe('review_required');
      expect(result.appliedPolicies).toEqual([]);
    });

    // RNF008 AC3 (#1496): collection scope through the collectionId fact.
    it('applies a policy conditioned on the collection every requested item belongs to', () => {
      expect(AccessPolicyModel.validate(payload({ conditions: [{ collectionId: 'collection-1' }] })).isValid).toBe(true);
      const twoSpecimens = {
        ...request,
        requestedItems: [{ itemType: 'specimen', itemId: 'SPEC-1' }, { itemType: 'specimen', itemId: 'SPEC-2' }],
      };
      const entry = { consentValid: true, duoCompatible: true, studyActive: true, collectionId: 'collection-1' };
      const result = evaluatePolicies(
        [policy({ conditions: [{ consent: 'compatible', collectionId: 'collection-1' }] })],
        twoSpecimens,
        [entry, { ...entry }],
        now
      );
      expect(result.effect).toBe('permit');
    });

    it('does not apply a collection condition to items of two collections or an item with no collection', () => {
      const twoSpecimens = {
        ...request,
        requestedItems: [{ itemType: 'specimen', itemId: 'SPEC-1' }, { itemType: 'specimen', itemId: 'SPEC-2' }],
      };
      const entry = { consentValid: true, duoCompatible: true, studyActive: true, collectionId: 'collection-1' };
      const rule = policy({ conditions: [{ consent: 'compatible', collectionId: 'collection-1' }] });
      for (const other of [{ ...entry, collectionId: 'collection-2' }, { ...entry, collectionId: null }]) {
        const result = evaluatePolicies([rule], twoSpecimens, [entry, other], now);
        expect(result.effect).toBe('review_required');
        expect(result.appliedPolicies).toEqual([]);
      }
    });

    it('applies a deny or review_required conditioned on a collection when any requested item is in it', () => {
      const twoItems = {
        ...request,
        requestedItems: [{ itemType: 'specimen', itemId: 'SPEC-1' }, { itemType: 'dataset', itemId: 'DS-1' }],
      };
      const entry = { consentValid: true, duoCompatible: true, studyActive: true, collectionId: 'collection-1' };
      const broad = policy();
      const deny = policy({ policyName: 'Embargo', decisionEffect: 'deny', conditions: [{ collectionId: 'collection-1' }] });
      deny.accessPolicyId = 'policy-2';
      const review = policy({ policyName: 'Revisão', decisionEffect: 'review_required', conditions: [{ collectionId: 'collection-1' }] });
      review.accessPolicyId = 'policy-3';
      for (const other of [{ ...entry, collectionId: 'collection-2' }, { ...entry, collectionId: null }]) {
        expect(evaluatePolicies([broad, deny], twoItems, [entry, other], now).effect).toBe('deny');
        expect(evaluatePolicies([broad, review], twoItems, [entry, other], now).effect).toBe('review_required');
      }
      expect(evaluatePolicies([broad, deny], twoItems, [{ ...entry, collectionId: 'collection-2' }, { ...entry, collectionId: null }], now).effect)
        .toBe('permit');
    });

    it('reads study and protocol per item: a permit does not apply to an item of another study or protocol', () => {
      const twoSpecimens = {
        ...request,
        requestedItems: [{ itemType: 'specimen', itemId: 'SPEC-1' }, { itemType: 'specimen', itemId: 'SPEC-2' }],
      };
      const [entry] = compatible;
      const studyPermit = policy({ conditions: [{ consent: 'compatible', studyId: 'study-1' }] });
      const protocolPermit = policy({ conditions: [{ consent: 'compatible', protocolId: 'protocol-1' }] });
      expect(evaluatePolicies([studyPermit], twoSpecimens, [entry, { ...entry }], now).effect).toBe('permit');
      expect(evaluatePolicies([studyPermit], twoSpecimens, [entry, { ...entry, studyId: 'study-2' }], now).appliedPolicies).toEqual([]);
      expect(evaluatePolicies([studyPermit], twoSpecimens, [entry, { ...entry, studyId: null }], now).appliedPolicies).toEqual([]);
      expect(evaluatePolicies([protocolPermit], twoSpecimens, [entry, { ...entry, protocolId: 'protocol-2' }], now).appliedPolicies).toEqual([]);
      // The items agree with each other but not with the request's declared study.
      const declaredOther = { ...twoSpecimens, studyId: 'study-2' };
      expect(evaluatePolicies([studyPermit], declaredOther, [entry, { ...entry }], now).appliedPolicies).toEqual([]);
    });

    it('applies a deny conditioned on a study or protocol when one item matches every item fact of the condition', () => {
      const twoSpecimens = {
        ...request,
        requestedItems: [{ itemType: 'specimen', itemId: 'SPEC-1' }, { itemType: 'specimen', itemId: 'SPEC-2' }],
      };
      const [entry] = compatible;
      const broad = policy();
      const denyOf = (condition) => {
        const deny = policy({ policyName: 'Embargo', decisionEffect: 'deny', conditions: [condition] });
        deny.accessPolicyId = 'policy-2';
        return deny;
      };
      expect(evaluatePolicies([broad, denyOf({ studyId: 'study-2' })], twoSpecimens, [entry, { ...entry, studyId: 'study-2' }], now).effect)
        .toBe('deny');
      expect(evaluatePolicies([broad, denyOf({ protocolId: 'protocol-2' })], twoSpecimens, [entry, { ...entry, protocolId: 'protocol-2' }], now).effect)
        .toBe('deny');
      // The request declares study-1 for every item, a dataset item included.
      expect(evaluatePolicies([broad, denyOf({ studyId: 'study-1' })], twoSpecimens, [{ ...entry, studyId: null }], now).effect)
        .toBe('deny');
      // Collection 1 and study 2 on two different items: no one item is both.
      const split = [{ ...entry, collectionId: 'collection-1' }, { ...entry, studyId: 'study-2', collectionId: 'collection-2' }];
      expect(evaluatePolicies([broad, denyOf({ collectionId: 'collection-1', studyId: 'study-2' })], twoSpecimens, split, now).effect)
        .toBe('permit');
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
