import { test, expect, APIRequestContext } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { realLogin, seedRealAuth, RealAuthSession } from './helpers/realAuth';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import { deleteOrganizations } from './helpers/listOrganizations';

// RF002 (Requisitos v4.0.0), real backend: what the Técnico, the Coordenador
// and the Usuário Externo see.
//   AC1  the Técnico's dashboard shows registration, custody and storage
//        operations, and no governance or administration card.
//   AC2  the Coordenador's dashboard shows the operational indicators, the
//        active temperature alerts the backend holds and the governance
//        reports of its organization, and no administration card.
//   AC4  the Usuário Externo sees only the reports a grant authorizes: the
//        API lists and reads only the granted one, and the dashboard shows
//        only the authorized-reports card, counting it.

const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('RF002: role views on the real backend', () => {
  const organizationIds: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
  });

  async function provision(
    request: APIRequestContext,
    adminToken: string,
    accessType: number,
    roleName: string,
    organizationId: string
  ): Promise<RealAuthSession> {
    const username = `rf002.${accessType}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    const password = 'Rf002@12345-forte';
    const res = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: `RF002 ${roleName}`, email: `${username}@example.com`, username, password, accessType, roleName, organizationId },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return completeFirstLoginMfa(request, apiBaseURL!, username, password);
  }

  test('AC4: the Usuário Externo sees only the granted report, in the API and on the dashboard', async ({ request, page }) => {
    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };

    const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: adminAuth,
      data: { officialName: `RF002 AC4 ${Date.now()}`, countryCode: 'BR' },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const organizationId = (await orgRes.json()).data.organizationId as string;
    organizationIds.push(organizationId);

    // A Coordenador in the organization generates two reports, so both carry
    // its organization and an external user of the same organization is in
    // scope for both: only the grant separates them.
    const coordinator = await provision(request, admin.token, 3, 'Coordenador', organizationId);
    const coordAuth = { Authorization: `Bearer ${coordinator.token}` };
    const generate = async () => {
      const res = await request.post(`${apiBaseURL}/api/reports/generate`, { headers: coordAuth, data: { reportType: 'equipment' } });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).reportID as number;
    };
    const granted = await generate();
    const ungranted = await generate();

    const external = await provision(request, admin.token, 1, 'Usuário Externo', organizationId);
    const extAuth = { Authorization: `Bearer ${external.token}` };

    // Before any grant, the external user lists nothing of the two.
    const before = await request.get(`${apiBaseURL}/api/reports`, { headers: extAuth });
    expect(before.status(), await before.text()).toBe(200);
    const beforeIds = ((await before.json()) as Array<{ reportID: number }>).map((r) => r.reportID);
    expect(beforeIds).not.toContain(granted);
    expect(beforeIds).not.toContain(ungranted);

    const grantRes = await request.post(`${apiBaseURL}/api/access`, {
      headers: adminAuth,
      data: { reportID: granted, reportType: 'equipment', userId: String(external.user._id) },
    });
    expect(grantRes.ok(), await grantRes.text()).toBeTruthy();

    // #1201: the grant is stored under its dict-02 AccessGrant names
    // (P1X-0238, P1X-0239, P1X-0243), while the response keeps userId.
    const grantBody = (await grantRes.json()).data;
    expect(grantBody.userId).toBe(String(external.user._id));
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    try {
      await client.connect();
      const stored = await client.db(mongoDbName).collection('access').findOne({ _id: new ObjectId(String(grantBody._id)) });
      expect(stored).not.toBeNull();
      expect(stored!.userAccountId).toBe(String(external.user._id));
      expect(stored!.accessGrantId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(stored!.accessGrantId).toBe(grantBody.accessID);
      expect(stored!.permissionCodes).toEqual(['viewReports']);
      expect(stored).not.toHaveProperty('userId');
      expect(stored).not.toHaveProperty('accessID');
    } finally {
      await client.close();
    }

    const list = await request.get(`${apiBaseURL}/api/reports`, { headers: extAuth });
    expect(list.status(), await list.text()).toBe(200);
    expect(((await list.json()) as Array<{ reportID: number }>).map((r) => r.reportID)).toEqual([granted]);

    const readGranted = await request.get(`${apiBaseURL}/api/reports/${granted}`, { headers: extAuth });
    expect(readGranted.status(), await readGranted.text()).toBe(200);
    const readOther = await request.get(`${apiBaseURL}/api/reports/${ungranted}`, { headers: extAuth });
    expect(readOther.status(), await readOther.text()).toBe(403);

    // A type no grant names is refused; the granted type builds. The type is
    // a code the seed's active templates hold ('sensors', not its handler key
    // 'sensor'): an unknown code answers the no-preview 200 before the grant
    // check runs.
    const otherType = await request.post(`${apiBaseURL}/api/reports/sensors/preview`, { headers: extAuth, data: {} });
    expect(otherType.status(), await otherType.text()).toBe(403);
    expect((await otherType.json()).message).toBe('Relatório não autorizado para este usuário.');
    const grantedType = await request.post(`${apiBaseURL}/api/reports/equipment/preview`, { headers: extAuth, data: {} });
    expect(grantedType.status(), await grantedType.text()).toBe(200);

    await seedRealAuth(page, external);
    await page.goto('/dashboard');
    const card = page.getByTestId('dashboard-card-authorizedReports');
    await expect(card).toBeVisible();
    await expect(card.locator('.kpi-value')).toHaveText('1');
    await expect(page.locator('[data-testid^="dashboard-card-"]')).toHaveCount(1);
  });

  test('AC1: the Técnico dashboard shows registration, custody and storage, and no governance or admin card', async ({ request, page }) => {
    const admin = await realLogin(request);
    const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { officialName: `RF002 AC1 ${Date.now()}`, countryCode: 'BR' },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const organizationId = (await orgRes.json()).data.organizationId as string;
    organizationIds.push(organizationId);

    const technician = await provision(request, admin.token, 2, 'Técnico', organizationId);
    await seedRealAuth(page, technician);
    await page.goto('/dashboard');

    for (const key of ['patients', 'samples', 'custodyReports', 'storage']) {
      await expect(page.getByTestId(`dashboard-card-${key}`)).toBeVisible();
    }
    for (const key of ['governanceReports', 'authorizedReports', 'users', 'security', 'audit', 'settings']) {
      await expect(page.getByTestId(`dashboard-card-${key}`)).toHaveCount(0);
    }
  });

  test('AC2: the Coordenador dashboard shows operational indicators, active alerts and governance reports, and no admin card', async ({ request, page }) => {
    const admin = await realLogin(request);
    const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { officialName: `RF002 AC2 ${Date.now()}`, countryCode: 'BR' },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const organizationId = (await orgRes.json()).data.organizationId as string;
    organizationIds.push(organizationId);

    const coordinator = await provision(request, admin.token, 3, 'Coordenador', organizationId);
    const coordAuth = { Authorization: `Bearer ${coordinator.token}` };

    // Two governance reports in the new organization: the card counts the
    // reports GET /api/reports lists for the Coordenador, which the backend
    // limits to its organization.
    for (let i = 0; i < 2; i += 1) {
      const res = await request.post(`${apiBaseURL}/api/reports/generate`, { headers: coordAuth, data: { reportType: 'equipment' } });
      expect(res.status(), await res.text()).toBe(201);
    }
    const listed = await request.get(`${apiBaseURL}/api/reports`, { headers: coordAuth });
    expect(listed.status(), await listed.text()).toBe(200);
    expect(((await listed.json()) as unknown[]).length).toBe(2);

    // An open temperature incident, so the alerts panel has a backend alert
    // to show (#1397: the dashboard reads GET /api/incidents, never a
    // browser-side alert).
    const sensorName = `RF002 AC2 sensor ${Date.now()}`;
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    const incidents = client.db(mongoDbName).collection('temperatureIncidents');
    const now = new Date();
    const inserted = await incidents.insertOne({
      sensorKey: `rf002-ac2-${Date.now()}`, sensorName, openedAt: now, closedAt: null, excursionStartedAt: null,
      acknowledgedAt: null, acknowledgedBy: null, currentTemperature: 12, maxTemperature: 12, minTemperature: 12,
      samplesOutOfRange: 0, status: 'open', notes: [], escalationLevel: 0, lastEscalatedAt: null, emailsSent: [],
      createdAt: now, updatedAt: now,
    });
    try {
      await seedRealAuth(page, coordinator);
      await page.goto('/dashboard');

      for (const key of ['patients', 'samples', 'custodyReports', 'storage', 'results', 'temperatureAlerts', 'governanceReports']) {
        await expect(page.getByTestId(`dashboard-card-${key}`)).toBeVisible();
      }
      for (const key of ['authorizedReports', 'users', 'security', 'audit', 'settings']) {
        await expect(page.getByTestId(`dashboard-card-${key}`)).toHaveCount(0);
      }
      await expect(page.locator('[data-testid^="dashboard-card-"]')).toHaveCount(7);

      await expect(page.getByTestId('dashboard-card-governanceReports').locator('.kpi-value')).toHaveText('2');
      await expect(page.getByTestId('dashboard-card-temperatureAlerts').locator('.kpi-value')).toHaveText(/^[1-9][0-9]*$/);
      const alert = page.getByTestId(`dashboard-alert-${inserted.insertedId.toHexString()}`);
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(sensorName);
      await expect(page.getByTestId('dashboard-alerts-error')).toHaveCount(0);
    } finally {
      await incidents.deleteOne({ _id: inserted.insertedId });
      await client.close();
    }
  });
});
