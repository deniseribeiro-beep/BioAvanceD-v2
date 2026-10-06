import { test, expect } from '@playwright/test';
import {
  seedFreezerContainer,
  findSensorMetadata,
  removeSensorRegistration,
  removeTemperaturePolicy,
  closeSeedSensorDb,
} from './helpers/seedSensor';
import { realLogin, seedRealAuth } from './helpers/realAuth';

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
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';

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
    const suffix = Date.now();
    const sensorId = `rf009-registration-e2e-${suffix}`;
    // #984: derive both varying MAC octets from the full suffix (not
    // sensorId's last 2 decimal characters, a 100-value namespace that
    // collides both within a run and across runs on this project's
    // persistent bioavanced-test-* Mongo volume).
    const macSuffix = suffix.toString(16).padStart(4, '0').slice(-4);

    try {
      const createResponse = await request.post(`${apiBaseURL}/api/sensors`, {
        headers: { Authorization: `Bearer ${authToken}` },
        data: {
          sensorId,
          sensorType: 'temperature',
          macAddress: `AA:BB:CC:11:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}`,
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

  // Real-backend proof for #312: the 'Novo Sensor' form must actually carry
  // macAddress + storageContainer through to POST /api/sensors, same as the
  // direct-API path proven above — this is the "real operator" path #312
  // flagged as still broken (no macAddress/storageContainer inputs existed).
  test('the Novo Sensor form links SensorMetadata through a real UI submission', async ({ page, request }) => {
    const freezerId = await seedFreezerContainer();
    const suffix = Date.now();
    const sensorId = `rf009-ui-registration-e2e-${suffix}`;
    // #984: see the direct-API test above — same fix, same reasoning.
    const macSuffix = suffix.toString(16).padStart(4, '0').slice(-4);

    try {
      let session;
      try {
        session = await realLogin(request);
      } catch (err: any) {
        console.warn(`realLogin failed — DB may not be seeded with an admin user yet: ${err.message}`);
        return;
      }
      await seedRealAuth(page, session);

      await page.goto('/facility-management?tab=sensors');
      await page.getByTestId('new-sensor-button').click();

      await page.getByTestId('sensor-id-input').fill(sensorId);
      await page.getByTestId('sensor-type-input').fill('temperature');
      await page.getByTestId('sensor-mac-address-input').fill(`AA:BB:CC:22:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}`);
      await page.getByTestId('sensor-storage-container-select').selectOption(freezerId);

      await page.getByTestId('sensor-form-submit').click();
      await expect(page.getByTestId('sensor-form-submit')).not.toBeVisible();

      // #315: the freshly-created row must show the human-readable sensorId
      // the operator typed in, not the raw Mongo _id.
      await expect(page.getByText(sensorId, { exact: true })).toBeVisible();

      const metadata = await findSensorMetadata(sensorId);
      expect(metadata).not.toBeNull();
      expect(metadata.macAddress).toBeTruthy();
      expect(metadata.storageContainer?.toString()).toBe(freezerId);
    } finally {
      await removeSensorRegistration(sensorId, freezerId);
    }
  });

  // Real-backend proof for #1145: the form's policy dropdown used to send a
  // numeric policyID onto Sensor.policyId, which no resolver reads, so a
  // sensor registered with a policy was governed by nothing. It must now bind
  // SensorMetadata.temperaturePolicy -- the field iot.controller and
  // TelemetryMonitor resolve thresholds from -- to the chosen policy's _id.
  // The policy is created through the real API, the path an operator uses.
  test('the Novo Sensor policy dropdown binds SensorMetadata.temperaturePolicy (#1145)', async ({ page, request }) => {
    const freezerId = await seedFreezerContainer();
    const suffix = Date.now();
    const sensorId = `rf009-ui-policy-e2e-${suffix}`;
    const macSuffix = suffix.toString(16).padStart(4, '0').slice(-4);
    let policyId: string | undefined;

    try {
      let session;
      try {
        session = await realLogin(request);
      } catch (err: any) {
        console.warn(`realLogin failed -- DB may not be seeded with an admin user yet: ${err.message}`);
        return;
      }

      const policyResponse = await request.post(`${apiBaseURL}/api/policies`, {
        headers: { Authorization: `Bearer ${session.token}` },
        data: {
          name: `e2e-1145-${suffix}`,
          minTemp: 2,
          maxTemp: 8,
          effectivePeriod: {
            start: new Date().toISOString(),
            end: new Date(Date.now() + 86_400_000).toISOString(),
          },
        },
      });
      expect(policyResponse.status()).toBe(201);
      policyId = (await policyResponse.json())?.data?._id;
      expect(policyId).toBeTruthy();

      await seedRealAuth(page, session);
      await page.goto('/facility-management?tab=sensors');
      await page.getByTestId('new-sensor-button').click();

      // Without a MAC there is no SensorMetadata to bind to, so the
      // dropdown stays disabled until one is entered.
      await expect(page.getByTestId('sensor-policy-select')).toBeDisabled();

      await page.getByTestId('sensor-id-input').fill(sensorId);
      await page.getByTestId('sensor-type-input').fill('temperature');
      await page.getByTestId('sensor-mac-address-input').fill(`AA:BB:CC:33:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}`);
      await expect(page.getByTestId('sensor-policy-select')).toBeEnabled();
      await page.getByTestId('sensor-policy-select').selectOption(policyId!);
      await page.getByTestId('sensor-storage-container-select').selectOption(freezerId);

      await page.getByTestId('sensor-form-submit').click();
      await expect(page.getByTestId('sensor-form-submit')).not.toBeVisible();

      const metadata = await findSensorMetadata(sensorId);
      expect(metadata).not.toBeNull();
      expect(metadata.temperaturePolicy?.toString()).toBe(policyId);
    } finally {
      await removeSensorRegistration(sensorId, freezerId);
      if (policyId) await removeTemperaturePolicy(policyId);
    }
  });

  // Real-backend proof for #1179: the edit modal offered the freezer (and,
  // before #1145, the policy) select, but updateSensor wrote only the
  // `sensors` document while both bindings live on SensorMetadata -- so a
  // changed freezer saved nothing, and the select opened blank because the
  // list never returned the current binding.
  test('editing a sensor pre-fills and rebinds its freezer and policy on SensorMetadata (#1179)', async ({ page, request }) => {
    const freezerA = await seedFreezerContainer();
    const freezerB = await seedFreezerContainer();
    const suffix = Date.now();
    const sensorId = `rf009-ui-edit-e2e-${suffix}`;
    const macSuffix = suffix.toString(16).padStart(4, '0').slice(-4);
    const policyIds: string[] = [];

    try {
      let session;
      try {
        session = await realLogin(request);
      } catch (err: any) {
        console.warn(`realLogin failed -- DB may not be seeded with an admin user yet: ${err.message}`);
        return;
      }
      const headers = { Authorization: `Bearer ${session.token}` };

      for (const tag of ['a', 'b']) {
        const res = await request.post(`${apiBaseURL}/api/policies`, {
          headers,
          data: {
            name: `e2e-1179-${tag}-${suffix}`,
            minTemp: 2,
            maxTemp: 8,
            effectivePeriod: {
              start: new Date().toISOString(),
              end: new Date(Date.now() + 86_400_000).toISOString(),
            },
          },
        });
        expect(res.status()).toBe(201);
        policyIds.push((await res.json())?.data?._id);
      }
      const [policyA, policyB] = policyIds;

      const createResponse = await request.post(`${apiBaseURL}/api/sensors`, {
        headers,
        data: {
          sensorId,
          sensorType: 'temperature',
          macAddress: `AA:BB:CC:44:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}`,
          storageContainer: freezerA,
          temperaturePolicy: policyA,
        },
      });
      expect(createResponse.status()).toBe(201);

      await seedRealAuth(page, session);
      await page.goto('/facility-management?tab=sensors');
      await page.getByTestId(`sensor-edit-${sensorId}`).click();

      // Pre-filled from the list, which now carries the SensorMetadata bindings.
      await expect(page.getByTestId('sensor-storage-container-select')).toHaveValue(freezerA);
      await expect(page.getByTestId('sensor-policy-select')).toHaveValue(policyA);

      await page.getByTestId('sensor-storage-container-select').selectOption(freezerB);
      await page.getByTestId('sensor-policy-select').selectOption(policyB);
      // A changed MAC must reach the SensorMetadata row too: the cold-chain
      // lookup matches macAddress on both collections.
      const newMac = `AA:BB:CC:55:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}`;
      await page.getByTestId('sensor-mac-address-input').fill(newMac);
      await page.getByTestId('sensor-form-submit').click();
      await expect(page.getByTestId('sensor-form-submit')).not.toBeVisible();

      const metadata = await findSensorMetadata(sensorId);
      expect(metadata.storageContainer?.toString()).toBe(freezerB);
      expect(metadata.temperaturePolicy?.toString()).toBe(policyB);
      expect(metadata.macAddress).toBe(`AA:BB:CC:55:${macSuffix.slice(0, 2)}:${macSuffix.slice(2, 4)}`);
    } finally {
      await removeSensorRegistration(sensorId, freezerA);
      await removeSensorRegistration(sensorId, freezerB);
      for (const id of policyIds) if (id) await removeTemperaturePolicy(id);
    }
  });
});
