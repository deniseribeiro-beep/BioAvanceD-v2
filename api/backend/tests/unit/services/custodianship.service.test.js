import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../../src/services/custodianship.service');

// #1316: a query-matching fake, as the physical chain's test uses. A dotted
// `$set` key writes the nested field the way Mongo does.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => doc[key] === value);
}

function createFakeCollection() {
  const docs = [];
  const indexes = [];
  return {
    docs,
    async createIndex(keys, options = {}) { indexes.push({ keys, options }); },
    async insertOne(doc) {
      for (const { keys, options } of indexes) {
        if (!options.unique) continue;
        const [field] = Object.keys(keys);
        const inScope = (row) => !options.partialFilterExpression || matches(row, options.partialFilterExpression);
        if (inScope(doc) && docs.some((row) => inScope(row) && row[field] === doc[field])) {
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        }
      }
      docs.push(structuredClone(doc));
      return { insertedId: docs.length };
    },
    async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
    find(filter = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }; },
    async updateOne(filter, update) {
      const doc = docs.find((row) => matches(row, filter));
      if (doc) {
        for (const [key, value] of Object.entries(update.$set)) {
          const path = key.split('.');
          const last = path.pop();
          path.reduce((node, part) => node[part], doc)[last] = value;
        }
      }
      return { matchedCount: doc ? 1 : 0 };
    },
  };
}

function createFakeDb() {
  const collections = {};
  return {
    collections,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection();
      return collections[name];
    },
  };
}

const START = '2026-01-01T00:00:00Z';
const approval = (over = {}) => ({
  approvalId: 'appr-1', collectionId: 'COL-1', status: 'active', effectivePeriod: { start: '2025-01-01T00:00:00Z', end: null }, ...over,
});

async function expectRefusal(promise, code, statusCode) {
  await expect(promise).rejects.toMatchObject({ name: 'CustodianshipError', code, statusCode });
}

describe('custodianship.service (#1316, RF021 AC4-AC6)', () => {
  let db;
  const assign = (over = {}) => service.assignCustody(db, {
    specimenId: 'SPC-1', custodianOrganizationId: 'org-1', authorizationId: 'appr-1', effectivePeriod: { start: START }, ...over,
  });

  beforeEach(async () => {
    db = createFakeDb();
    await db.collection('samples').insertOne({ specimenId: 'SPC-1', collectionId: 'COL-1' });
    await db.collection('collections').insertOne({ collectionId: 'COL-1', governanceRegime: 'biobank', governanceContext: {} });
    await db.collection('organizations').insertOne({ organizationId: 'org-1' });
    await db.collection('organizations').insertOne({ organizationId: 'org-2' });
    await db.collection('collectionGovernanceApprovals').insertOne(approval());
  });

  it('records custody with its organization, approval and period (AC4)', async () => {
    const custody = await assign({ responsibleInvestigatorId: 'inv-1', locationId: 'loc-1' });
    expect(custody).toMatchObject({ specimenId: 'SPC-1', custodianOrganizationId: 'org-1', responsibleInvestigatorId: 'inv-1', locationId: 'loc-1', assignmentStatus: 'active' });
    expect(db.collections.custodianshipAssignments.docs).toHaveLength(1);
  });

  it('refuses an unknown specimen, organization or approval', async () => {
    await expectRefusal(assign({ specimenId: 'SPC-X' }), 'SPECIMEN_NOT_FOUND', 404);
    await expectRefusal(assign({ custodianOrganizationId: 'org-X' }), 'ORGANIZATION_NOT_FOUND', 404);
    await expectRefusal(assign({ authorizationId: 'appr-X' }), 'APPROVAL_NOT_FOUND', 404);
  });

  it("refuses an approval of another collection, or not in force at the custody's start (AC6)", async () => {
    await db.collection('collectionGovernanceApprovals').insertOne(approval({ approvalId: 'appr-other', collectionId: 'COL-2' }));
    await db.collection('collectionGovernanceApprovals').insertOne(approval({ approvalId: 'appr-susp', status: 'suspended' }));
    await expectRefusal(assign({ authorizationId: 'appr-other' }), 'APPROVAL_INCOMPATIBLE', 422);
    await expectRefusal(assign({ authorizationId: 'appr-susp' }), 'APPROVAL_INCOMPATIBLE', 422);
  });

  it("requires a biorepository's investigator and its own ethics approval", async () => {
    await db.collection('collections').updateOne({ collectionId: 'COL-1' }, { $set: { governanceRegime: 'biorepository', governanceContext: { ethicsApprovalId: 'appr-eth' } } });
    await db.collection('collectionGovernanceApprovals').insertOne(approval({ approvalId: 'appr-eth' }));
    await expectRefusal(assign({ authorizationId: 'appr-eth' }), 'VALIDATION_ERROR', 422);
    await expectRefusal(assign({ responsibleInvestigatorId: 'inv-1' }), 'APPROVAL_INCOMPATIBLE', 422);
    await expect(assign({ authorizationId: 'appr-eth', responsibleInvestigatorId: 'inv-1' })).resolves.toMatchObject({ authorizationId: 'appr-eth' });
  });

  it('keeps one custody per specimen at a time, the ended history included (AC5)', async () => {
    const first = await assign();
    await expectRefusal(assign({ custodianOrganizationId: 'org-2', effectivePeriod: { start: '2026-02-01T00:00:00Z' } }), 'ASSIGNMENT_OVERLAP', 409);
    await service.endCustody(db, first.custodianshipAssignmentId, '2026-03-01T00:00:00Z');
    await expectRefusal(assign({ custodianOrganizationId: 'org-2', effectivePeriod: { start: '2026-02-01T00:00:00Z' } }), 'ASSIGNMENT_OVERLAP', 409);
    await expect(assign({ custodianOrganizationId: 'org-2', effectivePeriod: { start: '2026-03-01T00:00:00Z' } })).resolves.toMatchObject({ assignmentStatus: 'active' });
  });

  it('ends a custody once, and only after its start', async () => {
    const first = await assign();
    await expectRefusal(service.endCustody(db, first.custodianshipAssignmentId, '2025-06-01T00:00:00Z'), 'VALIDATION_ERROR', 422);
    const closed = await service.endCustody(db, first.custodianshipAssignmentId, '2026-03-01T00:00:00Z');
    expect(closed.assignmentStatus).toBe('ended');
    expect(db.collections.custodianshipAssignments.docs[0].effectivePeriod.end).toEqual(new Date('2026-03-01T00:00:00Z'));
    await expectRefusal(service.endCustody(db, first.custodianshipAssignmentId), 'ASSIGNMENT_ENDED', 409);
    await expectRefusal(service.endCustody(db, 'nope'), 'ASSIGNMENT_NOT_FOUND', 404);
  });

  it('reads the custody holding a specimen at an instant', async () => {
    const first = await assign();
    await service.endCustody(db, first.custodianshipAssignmentId, '2026-03-01T00:00:00Z');
    await assign({ custodianOrganizationId: 'org-2', effectivePeriod: { start: '2026-03-01T00:00:00Z' } });
    expect((await service.currentCustody(db, 'SPC-1', '2026-02-15T00:00:00Z')).custodianOrganizationId).toBe('org-1');
    expect((await service.currentCustody(db, 'SPC-1', '2026-03-01T00:00:00Z')).custodianOrganizationId).toBe('org-2');
    expect(await service.currentCustody(db, 'SPC-1', '2025-06-01T00:00:00Z')).toBeNull();
  });

  it('refuses operation without custody, or once its approval is withdrawn (AC6)', async () => {
    expect(await service.operabilityRefusal(db, 'SPC-1', '2026-02-01T00:00:00Z')).toMatch('sem custódia vigente');
    await assign();
    expect(await service.operabilityRefusal(db, 'SPC-1', '2026-02-01T00:00:00Z')).toBeNull();
    await db.collection('collectionGovernanceApprovals').updateOne({ approvalId: 'appr-1' }, { $set: { status: 'suspended' } });
    expect(await service.operabilityRefusal(db, 'SPC-1', '2026-02-01T00:00:00Z')).toMatch('não está vigente');
  });

  it('builds the open-custody partial unique index, the backstop for a concurrent writer', async () => {
    await assign();
    const created = db.collections.custodianshipAssignments;
    await expect(created.insertOne({ specimenId: 'SPC-1', assignmentStatus: 'active' })).rejects.toMatchObject({ code: 11000 });
    await expect(created.insertOne({ specimenId: 'SPC-1', assignmentStatus: 'ended' })).resolves.toBeTruthy();
  });
});
