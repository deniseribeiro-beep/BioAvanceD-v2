import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { realLogin } from './helpers/realAuth';
import { deleteOrganizations } from './helpers/listOrganizations';
import {
  seedCustodyFixture,
  cleanupCustodyFixture,
  closeCustodyDb,
  type CustodyFixture,
} from './helpers/seedCustody';

// Real-backend proof for #1364: specimenStatus is the v2 six (RF006 AC2),
// quantityStatus is derived (RF006 AC3), and `closed` comes from an executed
// destroy/transfer disposition (RF026 AC7), never from an edit. A stored
// v1.3.0 document reads folded onto the v2 set; only the migration rewrites
// it. No case creates a sample through POST /api/samples: the specimens are
// written straight to Mongo, as seedCustody.ts does.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Specimen status v2 (RF006 AC2/AC3, RF026 AC7) — real backend', () => {
  const organizationIds: string[] = [];
  const specimenIds: string[] = [];
  const dispositionActionIds: string[] = [];
  const retentionPolicyIds: string[] = [];
  let fixture: CustodyFixture | null = null;
  let client: MongoClient | null = null;
  const suffix = `sv2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function getDb(): Promise<Db> {
    if (!client) {
      client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
      await client.connect();
    }
    return client.db(mongoDbName);
  }

  test.afterAll(async ({ request }) => {
    const db = await getDb().catch(() => null);
    if (db) {
      await Promise.all([
        db.collection('samples').deleteMany({ specimenId: { $in: specimenIds } }),
        db.collection('operationalStateDecisions').deleteMany({ specimenId: { $in: specimenIds } }),
        db.collection('dispositionActions').deleteMany({ dispositionActionId: { $in: dispositionActionIds } }),
        db.collection('retentionPolicies').deleteMany({ _id: { $in: retentionPolicyIds.map((id) => new ObjectId(id)) } }),
      ]).catch(() => {});
    }
    if (fixture) await cleanupCustodyFixture(fixture, [], [], [], []).catch(() => {});
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
    if (client) await client.close();
    await closeCustodyDb();
  });

  test('an executed destruction closes the specimen with an RF026 AC7 state decision, and no edit reopens it', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const org = await request.post(`${apiBaseURL}/api/organizations`, { headers: auth, data: { officialName: `#1364 custodian ${suffix}`, countryCode: 'BR' } });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);
    fixture = await seedCustodyFixture(suffix, organizationId);
    const { specimenId, approvalId } = fixture;
    specimenIds.push(specimenId);

    const custody = await request.post(`${apiBaseURL}/api/physical-chain/custody`, {
      headers: auth,
      data: { specimenId, custodianOrganizationId: organizationId, authorizationId: approvalId, responsibleInvestigatorId: 'inv-sv2' },
    });
    expect(custody.status(), await custody.text()).toBe(201);

    const policy = await request.post(`${apiBaseURL}/api/retention-policies`, {
      headers: auth,
      data: {
        applicableEntityTypes: ['Specimen'],
        triggerEvent: 'creation',
        postRetentionAction: 'destroy',
        retentionPeriod: 'P365D',
        jurisdiction: 'BR',
        retentionBasis: ['RF026 AC7 e2e fixture basis'],
        legalHoldRules: [{ when: 'legalHold=true', block: 'destroy' }],
        reviewRequired: false,
      },
    });
    expect(policy.status(), await policy.text()).toBe(201);
    const retentionPolicyId = String((await policy.json()).data._id);
    retentionPolicyIds.push(retentionPolicyId);

    const planned = await request.post(`${apiBaseURL}/api/disposition-actions`, {
      headers: auth,
      data: { retentionPolicyId, entityType: 'Specimen', affectedRecordIds: [specimenId], dispositionAction: 'destroy' },
    });
    expect(planned.status(), await planned.text()).toBe(201);
    const dispositionActionId = (await planned.json()).data.dispositionActionId as string;
    dispositionActionIds.push(dispositionActionId);

    const executed = await request.post(`${apiBaseURL}/api/disposition-actions/${dispositionActionId}/execute`, {
      headers: auth,
      data: { evidenceIds: ['file-rf026-ac7'] },
    });
    expect(executed.status(), await executed.text()).toBe(200);
    expect((await executed.json()).data.actionStatus).toBe('executed');

    const sample = await request.get(`${apiBaseURL}/api/samples/${specimenId}`, { headers: auth });
    expect(sample.status(), await sample.text()).toBe(200);
    expect((await sample.json()).data.specimenStatus).toBe('closed');

    const decisions = await request.get(`${apiBaseURL}/api/samples/${specimenId}/state-decisions`, { headers: auth });
    expect(decisions.status(), await decisions.text()).toBe(200);
    const rows = (await decisions.json()).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      previousStatus: 'available',
      newStatus: 'closed',
      rulesApplied: ['rf026_ac7_disposition_executed'],
      triggerEventId: dispositionActionId,
      reasonCodes: ['destroy'],
    }));

    // RF026 AC7: closed is final; an edit back to available is refused.
    const reopen = await request.put(`${apiBaseURL}/api/samples/${specimenId}`, { headers: auth, data: { specimenStatus: 'available' } });
    expect(reopen.status(), await reopen.text()).toBe(422);
    expect((await reopen.json()).error).toBe('SPECIMEN_STATUS_WRITE_REFUSED');
  });

  test('a stored v1.3.0 specimen reads folded onto the v2 set, and the read leaves the stored value as it was', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const org = await request.post(`${apiBaseURL}/api/organizations`, { headers: auth, data: { officialName: `#1364 legacy ${suffix}`, countryCode: 'BR' } });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);

    // The fold of Sample.js' LEGACY_SPECIMEN_STATUS_MAP, with quantityStatus
    // derived from the quantities (RULE-003..005).
    const legacy = [
      { stored: 'depleted', currentQuantity: 0, specimenStatus: 'available', quantityStatus: 'depleted' },
      { stored: 'partial', currentQuantity: 4, specimenStatus: 'available', quantityStatus: 'partial' },
      { stored: 'destroyed', currentQuantity: 10, specimenStatus: 'unavailable', quantityStatus: 'full' },
    ].map((row) => ({ ...row, specimenId: `SPC-SV2-${row.stored}-${suffix}` }));
    const db = await getDb();
    specimenIds.push(...legacy.map((row) => row.specimenId));
    await db.collection('samples').insertMany(legacy.map((row) => ({
      specimenId: row.specimenId,
      collectionSite: organizationId,
      specimenStatus: row.stored,
      initialQuantity: 10,
      currentQuantity: row.currentQuantity,
      createdAt: new Date(),
    })));

    for (const row of legacy) {
      const res = await request.get(`${apiBaseURL}/api/samples/${row.specimenId}`, { headers: auth });
      expect(res.status(), await res.text()).toBe(200);
      const data = (await res.json()).data;
      expect({ stored: row.stored, specimenStatus: data.specimenStatus, quantityStatus: data.quantityStatus })
        .toEqual({ stored: row.stored, specimenStatus: row.specimenStatus, quantityStatus: row.quantityStatus });
      const raw = await db.collection('samples').findOne({ specimenId: row.specimenId });
      expect(raw?.specimenStatus).toBe(row.stored);
    }

    // RF026 AC7: a stored depleted specimen is available with nothing left,
    // so its validated total consumption closes it.
    const depleted = legacy[0].specimenId;
    const close = await request.post(`${apiBaseURL}/api/samples/${depleted}/close`, { headers: auth });
    expect(close.status(), await close.text()).toBe(200);
    expect((await close.json()).data).toEqual(expect.objectContaining({ specimenStatus: 'closed', previousStatus: 'available' }));
  });
});
