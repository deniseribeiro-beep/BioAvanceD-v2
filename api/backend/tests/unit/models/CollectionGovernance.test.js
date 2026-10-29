import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ApprovalModel = require('../../../src/models/CollectionGovernanceApproval');
const ContextModel = require('../../../src/models/CollectionGovernanceContext');
const EventModel = require('../../../src/models/CollectionGovernanceEvent');

const APPROVAL = {
  collectionId: 'col-1',
  authority: 'CEP',
  documentUri: 'https://docs.example.org/parecer.pdf',
  documentChecksum: 'b'.repeat(64),
  effectivePeriod: { start: '2026-01-01' },
  responsibleOrganizationId: 'org-1',
};

describe('CollectionGovernanceApproval (V2E-0067..0075)', () => {
  it('accepts a minimal approval and defaults it to draft', () => {
    expect(ApprovalModel.validate(APPROVAL).errors).toEqual([]);
    expect(ApprovalModel.create(APPROVAL).status).toBe('draft');
  });

  it.each([
    ['documentUri', 'not a uri', /documentUri/],
    ['documentChecksum', 'abc', /documentChecksum/],
    ['effectivePeriod', { start: '2026-02-01', end: '2026-01-01' }, /anterior/],
    ['status', 'expired', /status deve ser um de/],
    ['authority', '', /authority/],
  ])('rejects a bad %s', (field, value, message) => {
    const result = ApprovalModel.validate({ ...APPROVAL, [field]: value });
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(message);
  });

  it('is in force only while active and inside its period', () => {
    const now = new Date('2026-06-01');
    expect(ApprovalModel.isInForce({ status: 'active', effectivePeriod: { start: '2026-01-01' } }, now)).toBe(true);
    expect(ApprovalModel.isInForce({ status: 'draft', effectivePeriod: { start: '2026-01-01' } }, now)).toBe(false);
    expect(ApprovalModel.isInForce({ status: 'active', effectivePeriod: { start: '2026-07-01' } }, now)).toBe(false);
    expect(ApprovalModel.isInForce({ status: 'active', effectivePeriod: { start: '2025-01-01', end: '2026-05-31' } }, now)).toBe(false);
  });

  it('treats revoked as final', () => {
    expect(ApprovalModel.canTransition('suspended', 'active')).toBe(true);
    expect(ApprovalModel.canTransition('revoked', 'active')).toBe(false);
  });
});

describe('CollectionGovernanceContext (RULE-001/002)', () => {
  const biorepository = {
    studyId: 's', protocolId: 'p', protocolVersion: '1', caae: 'c', responsibleOrganizationId: 'o',
    responsibleInvestigatorId: 'i', ethicsApprovalId: 'a', validityPeriod: { start: '2026-01-01' }, closureCondition: 'fim do estudo',
  };
  const biobank = {
    broadPurpose: 'health-research', governancePolicyId: 'p', accessCommitteeId: 'c', institutionalCustodianId: 'o',
    futureUseConditions: [{ code: 'compatible_consent' }], applicableConsentModel: ['broad', 'tiered'], newEthicsReviewRule: 'always',
  };

  it('accepts each regime\'s own context', () => {
    expect(ContextModel.validate('biorepository', biorepository).errors).toEqual([]);
    expect(ContextModel.validate('biobank', biobank).errors).toEqual([]);
  });

  it('refuses the other regime\'s context', () => {
    expect(ContextModel.validate('biobank', biorepository).errors.join(' ')).toMatch(/RULE-001\/002/);
    expect(ContextModel.validate('biorepository', biobank).errors.join(' ')).toMatch(/RULE-001\/002/);
  });

  it('asks a biorepository for an end date or a closure condition (RF021 AC3)', () => {
    const { closureCondition, ...rest } = biorepository;
    expect(ContextModel.validate('biorepository', rest).errors.join(' ')).toMatch(/plannedEndDate ou closureCondition/);
  });

  it('refuses an unknown consent model or ethics review rule', () => {
    expect(ContextModel.validate('biobank', { ...biobank, applicableConsentModel: ['open'] }).isValid).toBe(false);
    expect(ContextModel.validate('biobank', { ...biobank, newEthicsReviewRule: 'never' }).isValid).toBe(false);
  });

  it('stores only the regime\'s own fields, with its context id', () => {
    const stored = ContextModel.create('biobank', 'col-1', { ...biobank, stray: 'x' });
    expect(stored.biobankGovernanceContextId).toEqual(expect.any(String));
    expect(stored.collectionId).toBe('col-1');
    expect(stored.stray).toBeUndefined();
    expect(ContextModel.matchesRegime('biobank', stored)).toBe(true);
    expect(ContextModel.matchesRegime('biorepository', stored)).toBe(false);
  });
});

describe('CollectionGovernanceEvent (V2E-0097..0104)', () => {
  const event = { collectionId: 'col-1', previousRegime: 'biobank', newRegime: 'biorepository', decisionType: 'regime_change', approvalIds: ['a'], justification: 'j' };

  it('accepts a complete event', () => {
    expect(EventModel.validate(event).errors).toEqual([]);
  });

  it('requires an approval and a justification', () => {
    expect(EventModel.validate({ ...event, approvalIds: [] }).errors.join(' ')).toMatch(/approvalIds/);
    expect(EventModel.validate({ ...event, justification: ' ' }).errors.join(' ')).toMatch(/justification/);
  });
});
