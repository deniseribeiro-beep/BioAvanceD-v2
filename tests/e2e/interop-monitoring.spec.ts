import { test, expect } from '@playwright/test';
import {
  seedSensorWithPolicy,
  findTemperatureIncident,
  findEnvironmentalExcursion,
  countEnvironmentalExcursions,
  removeSeededSensor,
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
  // quarantine-evaluation path). #298 (below) adds the real Device entity
  // and EnvironmentalExcursion record for AC#3/AC#5/AC#7. AC#4's
  // missing-reading half is covered further below (#299, split into #303/
  // #304 for the real-InfluxDB critical-freezer detection and real-Neo4j
  // propagation halves of AC#6, still stubbed).

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

test.describe('Telemetria e monitoramento ambiental (RF009) — EnvironmentalExcursion (#298)', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('an out-of-range reading opens an EnvironmentalExcursion linked to the sensor\'s Device, preserving the original reading and the policy that triggered it (criteria 5, 7)', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);

    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      data: { sensorId: sensor.sensorId, temperature: 25, timestamp: new Date().toISOString() },
    });

    expect(response.status()).toBe(200);

    await expect
      .poll(async () => findEnvironmentalExcursion(sensor.deviceId), { timeout: 15_000 })
      .toBeTruthy();

    const excursion = await findEnvironmentalExcursion(sensor.deviceId);
    expect(excursion.equipmentId).toBe(sensor.deviceId);
    expect(excursion.originalReading).toBe(25);
    expect(excursion.minimumValue).toBe(25);
    expect(excursion.maximumValue).toBe(25);
    expect(excursion.triggeringPolicyId).toBe(sensor.policyId);
    expect(excursion.excursionStatus).toBe('open');
    expect(excursion.startDateTime).toBeTruthy();
  });

  test('a second out-of-range reading for the same device widens the existing excursion instead of opening a new one (criterion 5)', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);

    await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      data: { sensorId: sensor.sensorId, temperature: 25, timestamp: new Date().toISOString() },
    });
    await expect
      .poll(async () => findEnvironmentalExcursion(sensor.deviceId), { timeout: 15_000 })
      .toBeTruthy();

    await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      data: { sensorId: sensor.sensorId, temperature: 30, timestamp: new Date().toISOString() },
    });
    await expect
      .poll(async () => (await findEnvironmentalExcursion(sensor.deviceId))?.maximumValue, { timeout: 15_000 })
      .toBe(30);

    const excursion = await findEnvironmentalExcursion(sensor.deviceId);
    expect(excursion.minimumValue).toBe(25);
    expect(excursion.maximumValue).toBe(30);
  });

  test('an in-range reading never opens an EnvironmentalExcursion', async ({ request }) => {
    const sensor = await seedSensorWithPolicy(2, 8);

    await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      data: { sensorId: sensor.sensorId, temperature: 5, timestamp: new Date().toISOString() },
    });

    await expect
      .poll(async () => {
        const points = await queryTemperaturePoints(sensor.sensorId);
        return points.length;
      }, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const excursion = await findEnvironmentalExcursion(sensor.deviceId);
    expect(excursion).toBeNull();
  });
});

test.describe('Telemetria e monitoramento ambiental (RF009) — missing-reading detection (#299)', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  // TelemetryMonitor's cron defaults to a 5-minute interval, too slow for
  // e2e assertions — /api/iot/telemetry-monitor/run-cycle (test-support
  // only, gated out of production) runs the real runCycle() synchronously
  // instead.
  async function triggerMonitorCycle(request: import('@playwright/test').APIRequestContext) {
    const response = await request.post(`${apiBaseURL}/api/iot/telemetry-monitor/run-cycle`);
    expect(response.status()).toBe(200);
  }

  test('a sensor that has never sent a reading is flagged as missing, opening a missing_reading EnvironmentalExcursion (criteria 4, 6)', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    try {
      await triggerMonitorCycle(request);

      const excursion = await findEnvironmentalExcursion(sensor.deviceId);
      expect(excursion).toBeTruthy();
      expect(excursion.excursionType).toBe('missing_reading');
      expect(excursion.excursionStatus).toBe('open');
      expect(excursion.equipmentId).toBe(sensor.deviceId);
    } finally {
      await removeSeededSensor(sensor);
    }
  });

  test('running the monitor cycle twice for the same never-reported sensor does not open a second excursion', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    try {
      await triggerMonitorCycle(request);
      await triggerMonitorCycle(request);

      const count = await countEnvironmentalExcursions(sensor.deviceId, 'missing_reading');
      expect(count).toBe(1);
    } finally {
      await removeSeededSensor(sensor);
    }
  });

  test('a sensor with a fresh in-range reading is not flagged as missing', async ({ request }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    try {
      await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        data: { sensorId: sensor.sensorId, temperature: 5, timestamp: new Date().toISOString() },
      });
      await expect
        .poll(async () => {
          const points = await queryTemperaturePoints(sensor.sensorId);
          return points.length;
        }, { timeout: 15_000 })
        .toBeGreaterThan(0);

      await triggerMonitorCycle(request);

      const excursion = await findEnvironmentalExcursion(sensor.deviceId);
      expect(excursion).toBeNull();
    } finally {
      await removeSeededSensor(sensor);
    }
  });
});
test.describe('Telemetria e monitoramento ambiental (RF009) — real findCriticalFreezers detection (#303)', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  // TelemetryMonitor's real defaults (criticalDurationHours: 2h,
  // expectedReadingIntervalMinutes: 15) would need hours of real points to
  // exercise honestly. /api/iot/telemetry-monitor/find-critical-freezers
  // (test-support only, gated out of production, added alongside this
  // spec) calls the real findCriticalFreezers() directly — never touching
  // Neo4j, unlike run-cycle above — with these thresholds temporarily
  // overridden so a handful of one-minute-apart points can prove the same
  // sustained-streak logic deterministically and fast.
  async function findCriticalFreezers(
    request: import('@playwright/test').APIRequestContext,
    overrides: Record<string, number> = {}
  ) {
    const response = await request.post(`${apiBaseURL}/api/iot/telemetry-monitor/find-critical-freezers`, {
      data: overrides,
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    return body.criticalFreezers as Array<{
      freezerKey: string;
      rootSampleId: string | null;
      breachedSince: string;
      maxObservedTemp: number;
    }>;
  }

  async function postReadingAt(
    request: import('@playwright/test').APIRequestContext,
    sensorId: string,
    temperature: number,
    timestamp: Date
  ) {
    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      data: { sensorId, temperature, timestamp: timestamp.toISOString() },
    });
    expect(response.status()).toBe(200);
  }

  test('a sensor whose reading has stayed above criticalTemp for the full overridden duration is detected as a critical freezer', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    try {
      const now = Date.now();
      const timestamps = [3, 2, 1, 0].map((minutesAgo) => new Date(now - minutesAgo * 60_000));
      for (const timestamp of timestamps) {
        await postReadingAt(request, sensor.sensorId, -50, timestamp);
      }

      await expect
        .poll(async () => {
          const points = await queryTemperaturePoints(sensor.sensorId, 10);
          return points.length;
        }, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(timestamps.length);

      const criticalFreezers = await findCriticalFreezers(request, {
        // 2 minutes: shorter than the ~3-minute streak just written.
        criticalDurationHours: 2 / 60,
        expectedReadingIntervalMinutes: 5,
      });

      const detected = criticalFreezers.find((entry) => entry.freezerKey === sensor.sensorId);
      expect(detected).toBeTruthy();
      expect(detected!.maxObservedTemp).toBe(-50);
      expect(new Date(detected!.breachedSince).getTime()).toBeLessThanOrEqual(timestamps[0].getTime());
    } finally {
      await removeSeededSensor(sensor);
    }
  });

  test('a sensor whose streak has not yet lasted the overridden duration is not detected', async ({ request }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    try {
      await postReadingAt(request, sensor.sensorId, -50, new Date());

      await expect
        .poll(async () => {
          const points = await queryTemperaturePoints(sensor.sensorId, 10);
          return points.length;
        }, { timeout: 15_000 })
        .toBeGreaterThan(0);

      const criticalFreezers = await findCriticalFreezers(request, {
        // 2 minutes: longer than the single just-written reading's age.
        criticalDurationHours: 2 / 60,
        expectedReadingIntervalMinutes: 5,
      });

      expect(criticalFreezers.find((entry) => entry.freezerKey === sensor.sensorId)).toBeUndefined();
    } finally {
      await removeSeededSensor(sensor);
    }
  });

  test('a reading below criticalTemp (TelemetryMonitor default -80°C, distinct from the sensor policy range) never contributes to a critical-freezer detection', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    try {
      await postReadingAt(request, sensor.sensorId, -90, new Date());

      await expect
        .poll(async () => {
          const points = await queryTemperaturePoints(sensor.sensorId, 10);
          return points.length;
        }, { timeout: 15_000 })
        .toBeGreaterThan(0);

      const criticalFreezers = await findCriticalFreezers(request, {
        criticalDurationHours: 0,
        expectedReadingIntervalMinutes: 5,
      });

      expect(criticalFreezers.find((entry) => entry.freezerKey === sensor.sensorId)).toBeUndefined();
    } finally {
      await removeSeededSensor(sensor);
    }
  });
});
