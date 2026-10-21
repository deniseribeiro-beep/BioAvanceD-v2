import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  seedSensorWithPolicy,
  removeSeededSensor,
  closeSeedSensorDb,
  findTemperatureIncident,
  findEnvironmentalExcursion,
  removeEnvironmentalExcursions,
  type SeededSensor,
} from './helpers/seedSensor';
import { realLogin } from './helpers/realAuth';

// Real backend only — see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack, never the mocked suite (the report reads the real InfluxDB).
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

// #1091: POST /api/iot/telemetry is gated by machineIngestGate.js, which
// fails closed on a missing/mismatched x-telemetry-ingest-secret header.
const ingestHeaders = () => ({ 'x-telemetry-ingest-secret': process.env.TELEMETRY_INGEST_SECRET ?? '' });

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

// #1392: the SensorMetadata readers read the sensor's temperature
// datastream valid now first; SensorMetadata is the fallback when that
// datastream names no policy.
test.describe('Sensor readers take the TelemetryDatastream first (#1392) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('the temperature report bounds a bound sensor by its datastream policy and one whose datastream names no policy by SensorMetadata', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const bound = await seedSensorWithPolicy(2, 8, { datastream: false });
    const profile = await seedSensorWithPolicy(-90, -60);
    const control = await seedSensorWithPolicy(2, 8, { thresholdProfileId: 'threshold-e2e' });
    const now = new Date();
    try {
      const created = await request.post(`${apiBaseURL}/api/telemetry-datastreams`, {
        headers: auth,
        data: {
          sensorId: bound.sensorId, equipmentId: `${bound.sensorId}-freezer`, storageLocationId: `${bound.sensorId}-loc`,
          observedProperty: 'temperature', unit: 'Cel', samplingPolicyId: 'sampling-e2e', thresholdProfileId: profile.policyId,
          validityPeriod: { start: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        },
      });
      expect(created.status(), await created.text()).toBe(201);

      // -70 °C is inside the datastream's -90..-60, so no incident opens.
      for (const [sensorId, temperature] of [[bound.sensorId, -70], [control.sensorId, 5]] as const) {
        const reading = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
          headers: ingestHeaders(),
          data: { sensorId, temperature, timestamp: new Date().toISOString() },
        });
        expect(reading.status(), await reading.text()).toBe(200);
      }

      const preview = await request.post(`${apiBaseURL}/api/reports/temperature/preview`, {
        headers: auth,
        data: { filters: { startDate: now.toISOString().slice(0, 10) } },
      });
      expect(preview.status(), await preview.text()).toBe(200);
      const temperatures: Array<Record<string, unknown>> = (await preview.json()).data.temperatures;

      expect(temperatures.find((row) => row.sensorId === bound.sensorId)).toMatchObject({ minThreshold: -90, maxThreshold: -60 });
      expect(temperatures.find((row) => row.sensorId === control.sensorId)).toMatchObject({ minThreshold: 2, maxThreshold: 8 });
    } finally {
      await removeSeededSensor(bound);
      await removeSeededSensor(profile);
      await removeSeededSensor(control);
    }
  });

  // #1392: an EnvironmentalExcursion is keyed by the equipmentId of the
  // sensor's datastream valid now, not by its SensorMetadata device.
  async function createDatastream(request: APIRequestContext, token: string, sensor: SeededSensor): Promise<string> {
    const equipmentId = `${sensor.sensorId}-freezer`;
    const created = await request.post(`${apiBaseURL}/api/telemetry-datastreams`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        sensorId: sensor.sensorId, equipmentId, storageLocationId: `${sensor.sensorId}-loc`,
        observedProperty: 'temperature', unit: 'Cel', samplingPolicyId: 'sampling-e2e', thresholdProfileId: sensor.policyId,
        validityPeriod: { start: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    return equipmentId;
  }

  test('a bound sensor opens its excursion under its datastream equipmentId, and resolving its incident closes it (#1392)', async ({ request }) => {
    const admin = await realLogin(request);
    const sensor = await seedSensorWithPolicy(2, 8, { datastream: false });
    let equipmentId: string | null = null;
    try {
      equipmentId = await createDatastream(request, admin.token, sensor);

      const reading = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: ingestHeaders(),
        data: { sensorId: sensor.sensorId, temperature: 25, timestamp: new Date().toISOString() },
      });
      expect(reading.status(), await reading.text()).toBe(200);

      await expect.poll(async () => findEnvironmentalExcursion(equipmentId!), { timeout: 15_000 }).toBeTruthy();
      expect(await findEnvironmentalExcursion(sensor.deviceId)).toBeNull();
      await expect.poll(async () => findTemperatureIncident(sensor.sensorId), { timeout: 15_000 }).toBeTruthy();

      const incident = await findTemperatureIncident(sensor.sensorId);
      const resolved = await request.put(`${apiBaseURL}/api/incidents/${incident._id}/resolve`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { userId: admin.user._id, notes: '#1392 e2e close' },
      });
      expect(resolved.ok(), await resolved.text()).toBeTruthy();

      await expect
        .poll(async () => (await findEnvironmentalExcursion(equipmentId!))?.excursionStatus, { timeout: 15_000 })
        .toBe('resolved');
    } finally {
      await removeSeededSensor(sensor);
      if (equipmentId) await removeEnvironmentalExcursions(equipmentId);
    }
  });

  test('a bound sensor that never reported has its missing_reading excursion under its datastream equipmentId (#1392)', async ({ request }) => {
    const admin = await realLogin(request);
    const sensor = await seedSensorWithPolicy(2, 8, { datastream: false });
    let equipmentId: string | null = null;
    try {
      equipmentId = await createDatastream(request, admin.token, sensor);

      const cycle = await request.post(`${apiBaseURL}/api/iot/telemetry-monitor/run-cycle`, {
        headers: { 'x-test-support-secret': process.env.TEST_SUPPORT_SECRET ?? '' },
      });
      expect(cycle.status(), await cycle.text()).toBe(200);

      const excursion = await findEnvironmentalExcursion(equipmentId);
      expect(excursion).toMatchObject({ equipmentId, excursionType: 'missing_reading', excursionStatus: 'open' });
      expect(await findEnvironmentalExcursion(sensor.deviceId)).toBeNull();
    } finally {
      await removeSeededSensor(sensor);
      if (equipmentId) await removeEnvironmentalExcursions(equipmentId);
    }
  });
});
