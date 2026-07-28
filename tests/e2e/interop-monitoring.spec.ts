import { test, expect } from '@playwright/test';
import {
  seedSensorWithPolicy,
  findTemperatureIncident,
  closeSeedSensorDb,
} from './helpers/seedSensor';
import { queryTemperaturePoints } from './helpers/queryInflux';

// Real backend only — see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack, never the mocked suite (telemetry persistence needs the real
// InfluxDB, not a mock).
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Telemetria e monitoramento ambiental (RF009) — real backend, ingestion path', () => {
  // Chunk A of #289: proves the ingestion/persistence/rejection path that
  // already exists (AC#1, AC#2, AC#3-partial, AC#4-invalid, AC#4-out-of-
  // range detection, AC#6-partial via the existing TemperatureIncident +
  // quarantine-evaluation path). NOT covered here, carried to follow-ups:
  // - AC#5/AC#7 (a real EnvironmentalExcursion record with
  //   startDateTime/endDateTime/minimumValue/maximumValue, distinct from
  //   the TemperatureIncident shape asserted below) — issue #298.
  // - AC#4's missing-reading half and AC#6's full alert/quarantine
  //   evaluation via TelemetryMonitor (currently stubbed to a no-op) —
  //   issue #299.
  // - A first-class Device entity for AC#3's "vincular ao Device" (today
  //   only a bare sensorId tag on the Influx point + a SensorMetadata doc,
  //   no resolvable storage-location reference) — also #298.

  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('persists a valid reading to InfluxDB, tagged by sensorId (criteria 1, 2, 3-partial)', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    const temperature = 4.5;

    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      data: { sensorId: sensor.sensorId, temperature, timestamp: new Date().toISOString() },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, accepted: true });

    // saveTelemetryPoint.js's Influx write is fired without awaiting the
    // controller's response, so the point may land a moment after the
    // 200 comes back.
    await expect
      .poll(async () => {
        const points = await queryTemperaturePoints(sensor.sensorId);
        return points.length;
      }, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const points = await queryTemperaturePoints(sensor.sensorId);
    expect(points[0].value).toBeCloseTo(temperature, 5);
  });

  test('rejects a reading with no sensorId (criterion 4, invalid)', async ({ request }) => {
    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      data: { temperature: 4.5 },
    });

    expect(response.status()).toBe(400);
  });

  test('rejects a reading with a non-numeric temperature (criterion 4, invalid)', async ({
    request,
  }) => {
    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      data: { sensorId: 'rf009-e2e-invalid-temp', temperature: 'not-a-number' },
    });

    expect(response.status()).toBe(400);
  });

  test('an out-of-range reading opens a TemperatureIncident against the sensor (criterion 4 out-of-range; criterion 6, evaluation)', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);

    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      data: { sensorId: sensor.sensorId, temperature: 25, timestamp: new Date().toISOString() },
    });

    expect(response.status()).toBe(200);

    // upsertTemperatureIncidentAndQuarantine runs fire-and-forget from the
    // controller too, after resolving the sensor's policy.
    await expect
      .poll(async () => findTemperatureIncident(sensor.sensorId), { timeout: 15_000 })
      .toBeTruthy();

    const incident = await findTemperatureIncident(sensor.sensorId);
    expect(incident.currentTemperature).toBe(25);
    expect(incident.samplesOutOfRange).toBeGreaterThanOrEqual(1);
  });

  test('an in-range reading for the same sensor never opens an incident', async ({ request }) => {
    const sensor = await seedSensorWithPolicy(2, 8);

    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      data: { sensorId: sensor.sensorId, temperature: 5, timestamp: new Date().toISOString() },
    });

    expect(response.status()).toBe(200);

    await expect
      .poll(async () => {
        const points = await queryTemperaturePoints(sensor.sensorId);
        return points.length;
      }, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const incident = await findTemperatureIncident(sensor.sensorId);
    expect(incident).toBeNull();
  });
});
