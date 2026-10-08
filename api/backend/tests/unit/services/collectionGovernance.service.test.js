import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const collectionGovernanceService = require('../../../src/services/collectionGovernance.service');

// Exact-match fake, as in accessPolicy.service.test.js, with Mongo's null
// semantics (null matches a missing field) and whole-value equality for an
// embedded document, which the service's guarded update relies on.
function same(actual, expected) {
  if (expected === null) return actual === null || actual === undefined;
  if (expected && typeof expected === 'object') return JSON.stringify(actual) === JSON.stringify(expected);
  return actual === expected;
}

function createFakeCollection(seedDocs = []) {
  const docs = seedDocs.map((d) => ({ ...d }));
  const matches = (doc, filter) => Object.keys(filter).every((key) => same(doc[key], filter[key]));
  return {
    docs,
    failInsert: false,
    async insertOne(doc) {
      if (this.failInsert) throw new Error('insert failed');
      docs.push(doc);
      return { insertedId: `fake-${docs.length}` };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    find(filter = {}) {
      const matched = docs.filter((doc) => matches(doc, filter));
      return { sort() { return this; }, async toArray() { return matched; } };
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async findOneAndUpdate(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return null;
      Object.assign(doc, update.$set);
      for (const [key, value] of Object.entries(update.$push || {})) doc[key] = [...(doc[key] || []), value];
      return doc;
    },
  };
}

let collections;
const db = { collection: (name) => {
  if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
  return collections[name];
} };

const CHECKSUM = `sha256:${'a'.repeat(64)}`;

function approvalPayload(overrides = {}) {
  return {
    authority: 'CEP Hospital Sintético',
    caae: '00000000.0.0000.0000',
    documentUri: 'https://docs.example.org/parecer.pdf',
    documentChecksum: CHECKSUM,
    effectivePeriod: { start: '2026-01-01', end: '2028-12-31' },
    status: 'active',
    responsibleOrganizationId: 'org-1',
    ...overrides,
  };
}

function biorepositoryContext(approvalId, overrides = {}) {
  return {
    studyId: 'study-1',
    protocolId: 'protocol-1',
    protocolVersion: '1.0',
    caae: '00000000.0.0000.0000',
    responsibleOrganizationId: 'org-1',
    responsibleInvestigatorId: 'actor-1',
    ethicsApprovalId: approvalId,
    validityPeriod: { start: '2026-01-01', end: '2028-12-31' },
    plannedEndDate: '2028-12-31',
    ...overrides,
  };
}

function biobankContext(overrides = {}) {
  return {
    broadPurpose: { code: 'health-research' },
    governancePolicyId: 'policy-1',
    accessCommitteeId: 'committee-1',
    institutionalCustodianId: 'org-1',
    futureUseConditions: ['compatible_consent'],
    applicableConsentModel: ['broad'],
    newEthicsReviewRule: 'when_required_by_policy',
    ...overrides,
  };
}

const NOW = new Date('2026-10-08T12:00:00Z');

beforeEach(() => {
  collections = {
    collections: createFakeCollection([
      { _id: 'c1', collectionId: 'col-rep', governanceRegime: 'biorepository' },
      { _id: 'c2', collectionId: 'col-bank', governanceRegime: 'biobank' },
      { _id: 'c3', collectionId: 'col-legacy' },
    ]),
    collectionGovernanceApprovals: createFakeCollection(),
    collectionGovernanceEvents: createFakeCollection(),
    organizations: createFakeCollection([{ organizationId: 'org-1' }]),
    studies: createFakeCollection([{ studyId: 'study-1' }]),
    protocols: createFakeCollection([{ protocolId: 'protocol-1', protocolVersion: '1.0' }]),
    accessPolicies: createFakeCollection([{ accessPolicyId: 'policy-1' }]),
  };
});

describe('collectionGovernance.service approvals', () => {
  it('registers an approval for an existing collection', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-rep', approvalPayload(), 'u1');
    expect(approval.collectionId).toBe('col-rep');
    expect(approval.status).toBe('active');
    expect(collections.collectionGovernanceApprovals.docs).toHaveLength(1);
  });

  it('answers 404 for an unknown collection and 422 for an unknown organization', async () => {
    await expect(collectionGovernanceService.createApproval(db, 'nope', approvalPayload(), 'u1'))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(collectionGovernanceService.createApproval(db, 'col-rep', approvalPayload({ responsibleOrganizationId: 'org-x' }), 'u1'))
      .rejects.toMatchObject({ statusCode: 422 });
  });

  it('moves an approval through its allowed transitions and refuses the others', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-rep', approvalPayload({ status: 'draft' }), 'u1');
    const active = await collectionGovernanceService.setApprovalStatus(db, 'col-rep', approval.approvalId, { status: 'active' }, 'u1');
    expect(active.status).toBe('active');
    expect(active.statusHistory).toEqual([expect.objectContaining({ from: 'draft', to: 'active' })]);
    await collectionGovernanceService.setApprovalStatus(db, 'col-rep', approval.approvalId, { status: 'revoked' }, 'u1');
    await expect(collectionGovernanceService.setApprovalStatus(db, 'col-rep', approval.approvalId, { status: 'active' }, 'u1'))
      .rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('collectionGovernance.service recordEvent', () => {
  it('records the first biorepository context as a created event resting on its ethics approval', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-rep', approvalPayload(), 'u1');
    const result = await collectionGovernanceService.recordEvent(db, 'col-rep', {
      governanceContext: biorepositoryContext(approval.approvalId),
      justification: 'Contexto inicial do biorrepositório',
    }, 'u1', NOW);

    expect(result.event).toMatchObject({ decisionType: 'created', previousRegime: null, newRegime: 'biorepository', approvalIds: [approval.approvalId] });
    const stored = collections.collections.docs.find((d) => d.collectionId === 'col-rep');
    expect(stored.governanceContext.biorepositoryContextId).toEqual(expect.any(String));
    expect(stored.governanceContext.studyId).toBe('study-1');
    expect(collections.collectionGovernanceEvents.docs).toHaveLength(1);
  });

  it('refuses a context carrying the other regime\'s fields (RULE-001/002)', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-rep', approvalPayload(), 'u1');
    await expect(collectionGovernanceService.recordEvent(db, 'col-rep', {
      governanceContext: { ...biorepositoryContext(approval.approvalId), governancePolicyId: 'policy-1' },
      justification: 'x',
    }, 'u1', NOW)).rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/RULE-001\/002/) });
  });

  it('refuses a biorepository context missing its study (RF004 AC4)', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-rep', approvalPayload(), 'u1');
    await expect(collectionGovernanceService.recordEvent(db, 'col-rep', {
      governanceContext: biorepositoryContext(approval.approvalId, { studyId: undefined }),
      justification: 'x',
    }, 'u1', NOW)).rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/studyId é obrigatório/) });
  });

  it('refuses an ethics approval that is not in force', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-rep', approvalPayload({ status: 'draft' }), 'u1');
    await expect(collectionGovernanceService.recordEvent(db, 'col-rep', {
      governanceContext: biorepositoryContext(approval.approvalId),
      justification: 'x',
    }, 'u1', NOW)).rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/não vigentes/) });
    expect(collections.collectionGovernanceEvents.docs).toHaveLength(0);
  });

  it('refuses a biobank context with no approval named', async () => {
    await expect(collectionGovernanceService.recordEvent(db, 'col-bank', {
      governanceContext: biobankContext(),
      justification: 'x',
    }, 'u1', NOW)).rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/approvalIds/) });
  });

  it('refuses a second created event once a context is set', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-bank', approvalPayload(), 'u1');
    const body = { governanceContext: biobankContext(), approvalIds: [approval.approvalId], justification: 'Política do biobanco' };
    await collectionGovernanceService.recordEvent(db, 'col-bank', body, 'u1', NOW);
    await expect(collectionGovernanceService.recordEvent(db, 'col-bank', body, 'u1', NOW))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/RF020 AC4/) });
  });

  it('converts a regime as a regime_change event that replaces the context', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-bank', approvalPayload(), 'u1');
    await collectionGovernanceService.recordEvent(db, 'col-bank', { governanceContext: biobankContext(), approvalIds: [approval.approvalId], justification: 'inicial' }, 'u1', NOW);
    const result = await collectionGovernanceService.recordEvent(db, 'col-bank', {
      newRegime: 'biorepository',
      governanceContext: biorepositoryContext(approval.approvalId),
      justification: 'Coleção passa a servir a um único estudo',
    }, 'u1', NOW);

    expect(result.event).toMatchObject({ decisionType: 'regime_change', previousRegime: 'biobank', newRegime: 'biorepository' });
    const stored = collections.collections.docs.find((d) => d.collectionId === 'col-bank');
    expect(stored.governanceRegime).toBe('biorepository');
    expect(stored.governanceContext.biobankGovernanceContextId).toBeUndefined();
    expect(collections.collectionGovernanceEvents.docs.map((e) => e.decisionType)).toEqual(['created', 'regime_change']);
  });

  it('gives a legacy collection with no regime its first one through a created event', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-legacy', approvalPayload(), 'u1');
    const result = await collectionGovernanceService.recordEvent(db, 'col-legacy', {
      newRegime: 'biobank', governanceContext: biobankContext(), approvalIds: [approval.approvalId], justification: 'legado',
    }, 'u1', NOW);
    expect(result.event).toMatchObject({ decisionType: 'created', previousRegime: null, newRegime: 'biobank' });
  });

  it('restores the collection when the event append fails', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-rep', approvalPayload(), 'u1');
    collections.collectionGovernanceEvents.failInsert = true;
    await expect(collectionGovernanceService.recordEvent(db, 'col-rep', {
      governanceContext: biorepositoryContext(approval.approvalId), justification: 'x',
    }, 'u1', NOW)).rejects.toThrow('insert failed');
    const stored = collections.collections.docs.find((d) => d.collectionId === 'col-rep');
    expect(stored.governanceContext).toBeNull();
    expect(stored.governanceRegime).toBe('biorepository');
  });
});

describe('collectionGovernance.service registrationRefusal (RF004 AC3/AC7)', () => {
  const refusal = (collectionId, now = NOW) => collectionGovernanceService.registrationRefusal(
    db, collections.collections.docs.find((d) => d.collectionId === collectionId), now
  );

  it('refuses a collection with a regime but no context', async () => {
    expect(await refusal('col-rep')).toMatch(/sem contexto de governança/);
  });

  it('refuses a collection with no regime', async () => {
    expect(await refusal('col-legacy')).toMatch(/sem regime de governança/);
  });

  it('admits a governed collection, and refuses it once its approval is suspended or out of period', async () => {
    const approval = await collectionGovernanceService.createApproval(db, 'col-rep', approvalPayload(), 'u1');
    await collectionGovernanceService.recordEvent(db, 'col-rep', { governanceContext: biorepositoryContext(approval.approvalId), justification: 'x' }, 'u1', NOW);
    expect(await refusal('col-rep')).toBeNull();
    expect(await refusal('col-rep', new Date('2029-06-01'))).toMatch(/fora da vigência/);
    await collectionGovernanceService.setApprovalStatus(db, 'col-rep', approval.approvalId, { status: 'suspended' }, 'u1');
    expect(await refusal('col-rep')).toMatch(/sem aprovação de governança vigente/);
  });
});
