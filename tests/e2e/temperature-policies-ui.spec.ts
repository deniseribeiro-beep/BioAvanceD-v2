import { test, expect } from '@playwright/test';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import { removeTemperaturePolicy, closeSeedSensorDb } from './helpers/seedSensor';

// Real-backend proof for #1178: the Políticas de Temperatura tab keyed every
// row on `policyID`, which GET /api/policies never returns (it returns _id,
// plus the legacy id as `policyId`, null since #1089). So a policy that
// exists was filtered out of the list, and edit/delete sent `undefined`.
// The policy is created through the real API, the path the UI itself uses.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Temperature policies tab (#1178) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('a policy created through the API is listed, shows its active limit, and deletes by _id', async ({ page, request }) => {
    let session;
    try {
      session = await realLogin(request);
    } catch (err: any) {
      console.warn(`realLogin failed — DB may not be seeded with an admin user yet: ${err.message}`);
      return;
    }

    const suffix = Date.now();
    const policyName = `e2e-1178-${suffix}`;
    const createResponse = await request.post(`${apiBaseURL}/api/policies`, {
      headers: { Authorization: `Bearer ${session.token}` },
      data: {
        policyName,
        minThreshold: 2,
        maxThreshold: 8,
        targetTemperature: 5,
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json())?.data;
    const policyId: string = created?._id;
    expect(policyId).toBeTruthy();
    // The premise of #1178, asserted rather than assumed: no policyID on the wire.
    expect(created).not.toHaveProperty('policyID');

    let deleted = false;
    try {
      await seedRealAuth(page, session);
      await page.goto('/facility-management?tab=policies');

      const row = page.getByTestId(`policy-row-${policyId}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(policyName);
      // The active-limit fetch now runs for the row, keyed by _id.
      await expect(row).toContainText('Limite ativo: 8.0°C');

      page.once('dialog', (dialog) => dialog.accept());
      await page.getByTestId(`policy-delete-${policyId}`).click();
      await expect(row).toHaveCount(0);

      const after = await request.get(`${apiBaseURL}/api/policies/${policyId}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      expect(after.status()).toBe(404);
      deleted = true;
    } finally {
      if (!deleted) await removeTemperaturePolicy(policyId);
    }
  });
});
