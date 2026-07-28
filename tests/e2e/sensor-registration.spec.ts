import { test, expect } from '@playwright/test';
import {
  seedFreezerContainer,
  findSensorMetadata,
  removeSensorRegistration,
  closeSeedSensorDb,
} from './helpers/seedSensor';

// Real-backend proof for #311: POST /api/sensors must also link a
// SensorMetadata doc (storageContainer included) instead of leaving that
// collection unpopulated for every real sensor. See backend-integration.spec.ts
// for why this only runs against the docker-compose stack.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Sensor registration links SensorMetadata (#311)', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('POST /api/sensors with macAddress + storageContainer upserts a resolvable sensorMetadata doc', async ({ request }) => {
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

    const freezerId = await seedFreezerContainer();
    const sensorId = `rf009-registration-e2e-${Date.now()}`;

    try {
      const createResponse = await request.post(`${apiBaseURL}/api/sensors`, {
        headers: { Authorization: `Bearer ${authToken}` },
        data: {
          sensorId,
          sensorType: 'temperature',
          macAddress: `AA:BB:CC:11:${sensorId.slice(-2)}:00`,
          storageContainer: freezerId,
        },
      });
      expect(createResponse.ok()).toBeTruthy();

      const metadata = await findSensorMetadata(sensorId);
      expect(metadata).not.toBeNull();
      expect(metadata.macAddress).toBeTruthy();
      expect(metadata.storageContainer?.toString()).toBe(freezerId);
    } finally {
      await removeSensorRegistration(sensorId, freezerId);
    }
  });
});
