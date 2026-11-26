import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { realLogin } from './helpers/realAuth';

// Real-backend proof for #1462 (RNF022 AC1): "Cada classe possui finalidade,
// sensibilidade, política, prazo e responsável." Each data class answered by
// GET /api/retention-policies/data-classes carries its purpose, sensitivity
// and owner, and its family's active RetentionPolicy with that policy's period.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const SENSITIVITIES = ['Low/metadata', 'Baixa', 'Moderada', 'Alta', 'Crítica', 'Restricted'];
const OWNER_ROLES = ['Administrador', 'Coordenador', 'Tecnico', 'UsuarioExterno'];

interface DataClassEntry {
  code: string;
  purpose: string;
  ownerRole: string;
  entityTypes: string[];
  sensitivity: string;
  retentionPolicyId: string | null;
  retentionPeriod: string | null;
}

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('RNF022 AC1 data classes — real backend', () => {
  const retentionPolicyIds: string[] = [];
  let client: MongoClient | null = null;

  async function getDb(): Promise<Db> {
    if (!client) {
      client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
      await client.connect();
    }
    return client.db(mongoDbName);
  }

  test.afterAll(async () => {
    const db = await getDb().catch(() => null);
    if (db) {
      await db.collection('retentionPolicies')
        .deleteMany({ _id: { $in: retentionPolicyIds.map((id) => new ObjectId(id)) } })
        .catch(() => {});
    }
    if (client) await client.close();
  });

  test('each data class records its purpose, sensitivity, policy, period and owner (RNF022 AC1)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };

    const policy = await request.post(`${apiBaseURL}/api/retention-policies`, {
      headers: auth,
      data: {
        applicableEntityTypes: ['Specimen'],
        triggerEvent: 'creation',
        postRetentionAction: 'destroy',
        retentionPeriod: 'P365D',
        jurisdiction: 'BR',
        retentionBasis: ['RNF022 AC1 e2e fixture basis'],
        legalHoldRules: [{ when: 'legalHold=true', block: 'destroy' }],
        reviewRequired: false,
      },
    });
    expect(policy.status(), await policy.text()).toBe(201);
    const specimenPolicyId = String((await policy.json()).data._id);
    retentionPolicyIds.push(specimenPolicyId);

    const res = await request.get(`${apiBaseURL}/api/retention-policies/data-classes`, { headers: auth });
    expect(res.status(), await res.text()).toBe(200);
    const classes = (await res.json()).data as DataClassEntry[];
    const codes = classes.map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining(['auditTrail', 'specimen', 'dataFile']));

    for (const entry of classes) {
      expect(entry.purpose.trim(), entry.code).not.toBe('');
      expect(SENSITIVITIES, entry.code).toContain(entry.sensitivity);
      expect(OWNER_ROLES, entry.code).toContain(entry.ownerRole);
      expect(entry.entityTypes.length, entry.code).toBeGreaterThan(0);
    }

    const specimen = classes.find((entry) => entry.code === 'specimen')!;
    expect(specimen.retentionPolicyId).toBe(specimenPolicyId);
    expect(specimen.retentionPeriod).toBe('P365D');

    for (const entry of classes.filter((candidate) => candidate.retentionPolicyId !== null)) {
      const read = await request.get(`${apiBaseURL}/api/retention-policies/${entry.retentionPolicyId}`, { headers: auth });
      expect(read.status(), await read.text()).toBe(200);
      const stored = (await read.json()).data;
      expect(stored.active, entry.code).toBe(true);
      expect(stored.retentionPeriod, entry.code).toBe(entry.retentionPeriod);
      expect((stored.applicableEntityTypes as string[]).some((type) => entry.entityTypes.includes(type)), entry.code).toBe(true);
    }
  });
});
