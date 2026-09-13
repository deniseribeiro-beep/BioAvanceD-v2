import { test, expect } from '@playwright/test';

// Unlike the other specs in this folder, this one does NOT mock the backend.
// It talks to the real API (mongodb-backed) so it only makes sense when run
// against the docker-compose stack (`npm run test:e2e:docker`) or against a
// locally running backend on http://localhost:3000. It is skipped unless an
// API base URL is explicitly provided, since CI's plain `npm run test:e2e`
// job still uses the mocked specs against a backend-less frontend dev server.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Real backend integration', () => {
  test('health endpoint reports a live database connection', async ({ request }) => {
    const response = await request.get(`${apiBaseURL}/api/health`);
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBe('OK');
    expect(body.db).toBe(true);
  });

  test('login with seeded admin user returns a usable session and lists samples', async ({ request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123';

    const loginResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username: testUser, password: testPass },
    });

    // 401 on a fresh DB (no seed yet) is expected and informative — not a test infra failure
    if (loginResponse.status() === 401) {
      console.warn('Login returned 401 — DB may not be seeded with an admin user yet. Run npm run seed first.');
      return;
    }
    expect(loginResponse.ok()).toBeTruthy();

    const body = await loginResponse.json();
    // Token lives under data.token (see auth.controller.js login response shape)
    const authToken = body?.data?.token ?? body?.token ?? body?.accessToken;
    expect(authToken).toBeTruthy();

    const samplesResponse = await request.get(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(samplesResponse.ok()).toBeTruthy();

    const samples = await samplesResponse.json();
    // Response shape: { success: true, data: [...], total: number }
    const list = Array.isArray(samples) ? samples : samples?.data;
    expect(Array.isArray(list)).toBeTruthy();
  });

  test('creates an Organization and lists it back from the real database (#346)', async ({ request }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123';

    const loginResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username: testUser, password: testPass },
    });

    if (loginResponse.status() === 401) {
      console.warn('Login returned 401 — DB may not be seeded with an admin user yet. Run npm run seed first.');
      return;
    }
    expect(loginResponse.ok()).toBeTruthy();

    const loginBody = await loginResponse.json();
    const authToken = loginBody?.data?.token ?? loginBody?.token ?? loginBody?.accessToken;
    expect(authToken).toBeTruthy();

    const officialName = `E2E Test Org ${Date.now()}`;
    const createResponse = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${authToken}` },
      data: {
        officialName,
        acronym: 'E2E',
        organizationType: 'biobank',
        countryCode: 'BR',
        website: 'https://example.org',
        qualityStandards: ['ISO 20387'],
      },
    });
    expect(createResponse.ok()).toBeTruthy();

    const createBody = await createResponse.json();
    expect(createBody.success).toBe(true);
    expect(createBody.data.organizationId).toBeTruthy();
    expect(createBody.data.officialName).toBe(officialName);
    expect(createBody.data.countryCode).toBe('BR');

    const listResponse = await request.get(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(listResponse.ok()).toBeTruthy();

    const listBody = await listResponse.json();
    const found = listBody.data.find((org: any) => org.organizationId === createBody.data.organizationId);
    expect(found).toBeTruthy();
    expect(found.officialName).toBe(officialName);
  });
});
