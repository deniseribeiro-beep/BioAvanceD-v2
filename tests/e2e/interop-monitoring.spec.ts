import { test, expect } from '@playwright/test';
import {
  seedSensorWithPolicy,
  findTemperatureIncident,
  findEnvironmentalExcursion,
  countEnvironmentalExcursions,
  removeSeededSensor,
  closeSeedSensorDb,
  seedSensorWithFreezerSample,
  removeSeededFreezerSample,
  findFreezerSample,
  bindSensor,
  unbindSensor,
} from './helpers/seedSensor';
import { queryTemperaturePoints, queryFreezerReadingIds } from './helpers/queryInflux';
import { realLogin } from './helpers/realAuth';
import { computeTotp } from './helpers/totp';
import { clearLoginAttempts, closeLoginAttemptsDb } from './helpers/queryLoginAttempts';
import { createRealParticipant, closeSeedDb as closeSeedParticipantDb } from './helpers/seedParticipant';
import { seedSampleNode, readSampleStatus, removeSampleNodes, closeNeo4jDriver } from './helpers/queryNeo4j';
import {
  findStagingRecordsByBatch,
  findLgpdQuarantineBatch,
  findCommittedSample,
  findCommittedPatient,
  findCommittedParticipantIdentity,
  findFhirImportAuditLogs,
  removeFhirImportFixtures,
  closeFhirImportDb,
} from './helpers/queryFhirImport';

// Real backend only — see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack, never the mocked suite (telemetry persistence needs the real
// InfluxDB, not a mock).
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

// #1091: POST /api/iot/telemetry is gated by machineIngestGate.js, which
// fails closed on a missing/mismatched x-telemetry-ingest-secret header.
const ingestHeaders = () => ({ 'x-telemetry-ingest-secret': process.env.TELEMETRY_INGEST_SECRET ?? '' });

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
      headers: ingestHeaders(),
      data: { sensorId: sensor.sensorId, temperature, timestamp: new Date().toISOString() },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, accepted: true, clockStatus: 'synchronized' });
    // #1317 (RF009 AC1): acknowledged only after InfluxDB persisted it.
    expect(body.telemetryReadingId).toBeTruthy();
    expect(body.persistedAt).toBeTruthy();

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

  // #1317 (RF009 AC7): a resent client idempotencyKey replays the first
  // reading instead of writing a second one.
  test('replays a reading resent with the same idempotencyKey (RF009 AC7)', async ({ request }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    const data = { sensorId: sensor.sensorId, temperature: 4.5, timestamp: new Date().toISOString(), idempotencyKey: `rf009-ac7-${Date.now()}` };

    const first = await request.post(`${apiBaseURL}/api/iot/telemetry`, { headers: ingestHeaders(), data });
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.replayed).toBeUndefined();

    const second = await request.post(`${apiBaseURL}/api/iot/telemetry`, { headers: ingestHeaders(), data });
    expect(second.status()).toBe(200);
    expect(await second.json()).toMatchObject({ success: true, accepted: true, replayed: true, telemetryReadingId: firstBody.telemetryReadingId });
  });

  test('rejects a reading with no sensorId (criterion 4, invalid)', async ({ request }) => {
    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      headers: ingestHeaders(),
      data: { temperature: 4.5 },
    });

    expect(response.status()).toBe(400);
  });

  test('rejects a reading with a non-numeric temperature (criterion 4, invalid)', async ({
    request,
  }) => {
    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      headers: ingestHeaders(),
      data: { sensorId: 'rf009-e2e-invalid-temp', temperature: 'not-a-number' },
    });

    expect(response.status()).toBe(400);
  });

  test('an out-of-range reading opens a TemperatureIncident against the sensor (criterion 4 out-of-range; criterion 6, evaluation)', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);

    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      headers: ingestHeaders(),
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
      headers: ingestHeaders(),
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

  // #1207: the cold-chain quarantine waits until an excursion has lasted the
  // policy's minimumDuration, timed from the incident's excursionStartedAt.
  // This proves the clock against real Mongo: an out-of-range reading starts
  // it, and an in-range reading's `excursionStartedAt: { $ne: null }` update
  // actually matches and clears it.
  test('#1207: an out-of-range reading starts the incident excursion clock and an in-range reading stops it', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    try {
      const breachAt = new Date(Date.now() - 60_000);
      const breach = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: ingestHeaders(),
        data: { sensorId: sensor.sensorId, temperature: 25, timestamp: breachAt.toISOString() },
      });
      expect(breach.status()).toBe(200);

      await expect
        .poll(async () => (await findTemperatureIncident(sensor.sensorId))?.excursionStartedAt?.toISOString() ?? null, {
          timeout: 15_000,
        })
        .toBe(breachAt.toISOString());

      const recovery = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: ingestHeaders(),
        data: { sensorId: sensor.sensorId, temperature: 5, timestamp: new Date().toISOString() },
      });
      expect(recovery.status()).toBe(200);

      await expect
        .poll(async () => (await findTemperatureIncident(sensor.sensorId))?.excursionStartedAt, { timeout: 15_000 })
        .toBeNull();
      // The incident itself stays open: only a person resolves it.
      expect((await findTemperatureIncident(sensor.sensorId)).status).toBe('open');
    } finally {
      await removeSeededSensor(sensor);
    }
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
      headers: ingestHeaders(),
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
      headers: ingestHeaders(),
      data: { sensorId: sensor.sensorId, temperature: 25, timestamp: new Date().toISOString() },
    });
    await expect
      .poll(async () => findEnvironmentalExcursion(sensor.deviceId), { timeout: 15_000 })
      .toBeTruthy();

    await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      headers: ingestHeaders(),
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
      headers: ingestHeaders(),
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

  test('resolving the paired TemperatureIncident closes the matching open EnvironmentalExcursion (#301)', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);

    await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      headers: ingestHeaders(),
      data: { sensorId: sensor.sensorId, temperature: 25, timestamp: new Date().toISOString() },
    });

    await expect
      .poll(async () => findEnvironmentalExcursion(sensor.deviceId), { timeout: 15_000 })
      .toBeTruthy();
    await expect
      .poll(async () => findTemperatureIncident(sensor.sensorId), { timeout: 15_000 })
      .toBeTruthy();

    const incident = await findTemperatureIncident(sensor.sensorId);
    const session = await realLogin(request);

    const resolveResponse = await request.put(
      `${apiBaseURL}/api/incidents/${incident._id}/resolve`,
      {
        headers: { Authorization: `Bearer ${session.token}` },
        data: { userId: session.user._id, notes: 'RF009 e2e close' },
      }
    );
    expect(resolveResponse.ok()).toBeTruthy();

    await expect
      .poll(async () => (await findEnvironmentalExcursion(sensor.deviceId))?.excursionStatus, {
        timeout: 15_000,
      })
      .toBe('resolved');

    const excursion = await findEnvironmentalExcursion(sensor.deviceId);
    expect(excursion.excursionStatus).toBe('resolved');
    expect(excursion.endDateTime).toBeTruthy();
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
    const response = await request.post(`${apiBaseURL}/api/iot/telemetry-monitor/run-cycle`, {
      headers: { 'x-test-support-secret': process.env.TEST_SUPPORT_SECRET ?? '' },
    });
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
        headers: ingestHeaders(),
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

  // RF009 AC1 (#1317): the temperature route writes `freezer_temperature`,
  // which the missing-reading check reads alongside `temperature`.
  test('a sensor whose fresh reading arrives through the temperature route is not flagged as missing', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    try {
      const admin = await realLogin(request);
      const response = await request.post(`${apiBaseURL}/api/temperature/reading`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { sensorId: sensor.sensorId, temperatureValue: 5, timestamp: new Date().toISOString() },
      });
      expect(response.status(), await response.text()).toBe(201);

      await expect
        .poll(async () => {
          const points = await queryFreezerReadingIds(sensor.sensorId);
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
      headers: { 'x-test-support-secret': process.env.TEST_SUPPORT_SECRET ?? '' },
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
      headers: ingestHeaders(),
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

  // RF009 AC1 (#1317): the temperature route writes `freezer_temperature`
  // with its unit tag; the critical check compares it in Celsius.
  test('a sustained breach reported through the temperature route in °F is detected, in Celsius', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);
    try {
      const admin = await realLogin(request);
      const now = Date.now();
      const timestamps = [3, 2, 1, 0].map((minutesAgo) => new Date(now - minutesAgo * 60_000));
      for (const timestamp of timestamps) {
        // -90 °F is -67.78 °C: above the -80 °C criticalTemp.
        const response = await request.post(`${apiBaseURL}/api/temperature/reading`, {
          headers: { Authorization: `Bearer ${admin.token}` },
          data: {
            sensorId: sensor.sensorId,
            temperatureValue: -90,
            temperatureUnit: '°F',
            timestamp: timestamp.toISOString(),
          },
        });
        expect(response.status(), await response.text()).toBe(201);
      }

      await expect
        .poll(async () => {
          const points = await queryFreezerReadingIds(sensor.sensorId, 10);
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
      expect(detected!.maxObservedTemp).toBeCloseTo(-67.78, 1);
    } finally {
      await removeSeededSensor(sensor);
    }
  });
});

test.describe('Telemetria e monitoramento ambiental (RF009) — real Neo4j propagateCompromise (#304)', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
    await closeNeo4jDriver();
  });

  // /api/iot/telemetry-monitor/run-cycle-full (test-support only, gated out
  // of production, added alongside this spec) runs the real runCycle() —
  // findCriticalFreezers() (real InfluxDB, #303) followed by
  // propagateCompromise() (real Neo4j, #304) — synchronously, with the
  // same threshold overrides find-critical-freezers already uses.
  async function runCycleFull(
    request: import('@playwright/test').APIRequestContext,
    overrides: Record<string, number> = {}
  ) {
    const response = await request.post(`${apiBaseURL}/api/iot/telemetry-monitor/run-cycle-full`, {
      data: overrides,
      headers: { 'x-test-support-secret': process.env.TEST_SUPPORT_SECRET ?? '' },
    });
    expect(response.status()).toBe(200);
  }

  async function postReadingAt(
    request: import('@playwright/test').APIRequestContext,
    sensorId: string,
    temperature: number,
    timestamp: Date
  ) {
    const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      headers: ingestHeaders(),
      data: { sensorId, temperature, timestamp: timestamp.toISOString() },
    });
    expect(response.status()).toBe(200);
  }

  test('a sustained critical-freezer breach marks the real root Sample node COMPROMISED in Neo4j and propagates to its descendant', async ({
    request,
  }) => {
    const sensor = await seedSensorWithFreezerSample(2, 8);
    const descendantSampleId = `rf009-e2e-descendant-${Date.now()}`;
    try {
      await seedSampleNode(sensor.rootSampleId);
      await seedSampleNode(descendantSampleId, sensor.rootSampleId);

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

      await runCycleFull(request, {
        // 2 minutes: shorter than the ~3-minute streak just written — same
        // override shape as the #303 find-critical-freezers spec above.
        criticalDurationHours: 2 / 60,
        expectedReadingIntervalMinutes: 5,
      });

      await expect
        .poll(async () => readSampleStatus(sensor.rootSampleId), { timeout: 15_000 })
        .toBe('COMPROMISED');
      await expect
        .poll(async () => readSampleStatus(descendantSampleId), { timeout: 15_000 })
        .toBe('COMPROMISED');
    } finally {
      await removeSampleNodes([sensor.rootSampleId, descendantSampleId]);
      await removeSeededFreezerSample(sensor);
    }
  });

  test('a freezer whose breach has not lasted the overridden duration leaves its Sample node untouched', async ({
    request,
  }) => {
    const sensor = await seedSensorWithFreezerSample(2, 8);
    try {
      await seedSampleNode(sensor.rootSampleId);

      await postReadingAt(request, sensor.sensorId, -50, new Date());
      await expect
        .poll(async () => {
          const points = await queryTemperaturePoints(sensor.sensorId, 10);
          return points.length;
        }, { timeout: 15_000 })
        .toBeGreaterThan(0);

      await runCycleFull(request, {
        // 2 minutes: longer than the single just-written reading's age —
        // never crosses the sustained-breach threshold, so
        // findCriticalFreezers should never report this sensor and
        // propagateCompromise should never run for it.
        criticalDurationHours: 2 / 60,
        expectedReadingIntervalMinutes: 5,
      });

      const status = await readSampleStatus(sensor.rootSampleId);
      expect(status).toBeNull();
    } finally {
      await removeSampleNodes([sensor.rootSampleId]);
      await removeSeededFreezerSample(sensor);
    }
  });

  // #1207 + #1208: the Mongo cold-chain quarantine, end to end. The fixture
  // binds the sensor to its freezer by SensorMetadata.storageContainer (how
  // registration binds it, #311), which the quarantine never read before
  // #1208. Its policy has no minimumDuration, so the 2-hour
  // TELEMETRY_CRITICAL_DURATION_HOURS fallback governs (#1207): the first
  // reading, 121 minutes ago, opens the incident and quarantines nothing,
  // and the second, now, is past the limit.
  test('#1207/#1208: a sustained excursion quarantines the Mongo Sample in the sensor\'s freezer, and the first reading does not', async ({
    request,
  }) => {
    const sensor = await seedSensorWithFreezerSample(2, 8);
    try {
      await postReadingAt(request, sensor.sensorId, 25, new Date(Date.now() - 121 * 60_000));
      await expect
        .poll(async () => (await findTemperatureIncident(sensor.sensorId))?.excursionStartedAt ?? null, { timeout: 15_000 })
        .not.toBeNull();
      expect((await findFreezerSample(sensor))?.specimenStatus).not.toBe('quarantined');

      await postReadingAt(request, sensor.sensorId, 25, new Date());
      await expect
        .poll(async () => (await findFreezerSample(sensor))?.specimenStatus ?? null, { timeout: 15_000 })
        .toBe('quarantined');
      const sample = await findFreezerSample(sensor);
      expect(sample.quarantineReasonCode).toBe('COLD_CHAIN_INCIDENT');
      expect(sample.coldChainSensorKey).toBe(sensor.sensorId);
    } finally {
      await removeSeededFreezerSample(sensor);
    }
  });
});

// RF011 (#324): the FHIR bundle staging pipeline (stage -> validate ->
// commit, see fhir-import-staging.service.js) already exists — this
// proves it end-to-end against the real backend rather than building a
// new surface. RNF024 (FHIR boundary side-effect-free, criterion 7) is
// enforced separately by api/backend/tests/architecture/fhir-boundary.arch.test.js,
// not re-asserted here.
function buildFhirBundle(suffix: string) {
  const patientId = `rf011-patient-${suffix}`;
  const specimenId = `rf011-specimen-${suffix}`;
  return {
    patientId,
    specimenId,
    bundle: {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: patientId,
            identifier: [{ system: 'urn:oid:cpf', value: `cpf-${suffix}` }],
            name: [{ text: `RF011 e2e patient ${suffix}` }],
            birthDate: '1990-01-01',
            gender: 'female',
            telecom: [{ system: 'email', value: `rf011-${suffix}@example.com` }],
          },
        },
        {
          resource: {
            resourceType: 'Consent',
            status: 'active',
            patient: { reference: `Patient/${patientId}` },
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: specimenId,
            identifier: [{ value: specimenId }],
            subject: { reference: `Patient/${patientId}` },
            type: { text: 'Blood' },
            collection: { collectedDateTime: new Date().toISOString() },
          },
        },
        {
          resource: {
            resourceType: 'Observation',
            subject: { reference: `Patient/${patientId}` },
            specimen: { reference: `Specimen/${specimenId}` },
            code: { text: 'RF011 e2e biomarker' },
            valueQuantity: { value: 1.5, unit: 'mg/dL' },
          },
        },
      ],
    },
  };
}

test.describe('Interoperabilidade HL7 FHIR R4 (RF011) — real backend, staging pipeline', () => {
  test.afterAll(async () => {
    await closeFhirImportDb();
  });

  test('stages, validates and commits a FHIR Bundle — Patient/Specimen/Consent/Observation mapping and provenance (criteria 1,2,3,5,6)', async ({
    request,
  }) => {
    const { token } = await realLogin(request);
    const { patientId, specimenId, bundle } = buildFhirBundle(String(Date.now()));

    let batchId: string | undefined;
    try {
      const stageResponse = await request.post(`${apiBaseURL}/api/import/fhir/stage`, {
        headers: { Authorization: `Bearer ${token}` },
        data: bundle,
      });
      expect(stageResponse.status()).toBe(201);
      const stageBody = await stageResponse.json();
      expect(stageBody.success).toBe(true);
      expect(stageBody.records).toHaveLength(1);

      const record = stageBody.records[0];
      // Consent resource is active -> consentSigned, so staging resolves
      // straight to READY_TO_COMMIT without needing the e-consent-by-email
      // detour (criterion 6: staging + quarantine workflow evaluated).
      expect(record.status).toBe('READY_TO_COMMIT');
      expect(record.normalized.participantId).toBe(patientId);
      expect(record.normalized.specimenId).toBe(specimenId);
      expect(record.normalized.patientName).toContain('RF011 e2e patient');
      expect(record.normalized.sampleType).toBe('Blood');
      // The Observation matches by both patient and specimen reference,
      // so normalizeObservations collects it via both lookups —
      // asserting content, not count, avoids pinning that dedup gap.
      expect(record.normalized.biomarkers.length).toBeGreaterThanOrEqual(1);
      expect(record.normalized.biomarkers[0].biomarkerType).toBe('RF011 e2e biomarker');

      batchId = stageBody.batch._id;

      const commitResponse = await request.post(`${apiBaseURL}/api/import/fhir/batches/${batchId}/commit`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(commitResponse.status()).toBe(200);
      const commitBody = await commitResponse.json();
      expect(commitBody.committed).toBe(1);

      // Criterion 2: Participant mapped from FHIR Patient. patientName is
      // civil identity (#571/#575) — commitBatch never writes it onto the
      // canonical Patient document, only onto the segregated
      // ParticipantIdentity collection, so it's asserted there instead.
      await expect.poll(() => findCommittedPatient(patientId), { timeout: 10_000 }).not.toBeNull();
      // #1104: patientName is ciphertext-only at rest, so the raw row holds
      // no plaintext, and the name is read back through the one authorized
      // re-identification path, which decrypts.
      const committedIdentity = await findCommittedParticipantIdentity(patientId);
      expect(committedIdentity?.patientName ?? null).toBeNull();
      expect(committedIdentity?.patientNameCiphertext).toBeTruthy();
      const reidentifyResponse = await request.post(`${apiBaseURL}/api/patients/${patientId}/reidentify`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { reason: 'RF011 e2e: confirm the committed participant name' },
      });
      expect(reidentifyResponse.status(), await reidentifyResponse.text()).toBe(200);
      expect((await reidentifyResponse.json())?.data?.patientName).toContain('RF011 e2e patient');

      // Criteria 3, 5, 6: Specimen mapped, provenance recorded
      // (importBatchId/importedBy/importedAt), quarantine released once
      // consent resolved active.
      const committedSample = await findCommittedSample(specimenId);
      expect(committedSample).not.toBeNull();
      expect(committedSample?.importBatchId).toBe(String(batchId));
      expect(committedSample?.importedBy).toBeTruthy();
      expect(committedSample?.importedAt).toBeTruthy();
      // Canonical field (#409's commitBatch migration; legacy trio removed in #408).
      expect(committedSample?.specimenStatus).toBe('available');

      // Criterion 5 (origin/provenance): commit is audited.
      const auditLogs = await findFhirImportAuditLogs(String(batchId));
      const committedLog = auditLogs.find((log) => log.action === 'FHIR_IMPORT_RECORD_COMMITTED');
      expect(committedLog).toBeTruthy();
      expect(committedLog?.participantId).toBe(patientId);
      expect(committedLog?.specimenId).toBe(specimenId);
    } finally {
      await removeFhirImportFixtures(specimenId, patientId, batchId);
    }
  });

  test('rejects a non-Bundle FHIR payload (criterion 1, invalid structure)', async ({ request }) => {
    const { token } = await realLogin(request);

    const response = await request.post(`${apiBaseURL}/api/import/fhir/stage`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { resourceType: 'Patient', id: 'not-a-bundle' },
    });

    expect(response.status()).toBe(400);
  });

  test('keeps a Specimen missing canonical required fields in error/quarantine, never commits it (criterion 4)', async ({
    request,
  }) => {
    const { token } = await realLogin(request);
    const { patientId, specimenId, bundle } = buildFhirBundle(`invalid-${Date.now()}`);
    // Drop the Specimen's type (sampleType) — a canonical-required field —
    // and the Consent resource, so normalizeSpecimen's own validation
    // rejects the record instead of it sailing through to commit.
    bundle.entry = bundle.entry.filter((entry) => entry.resource.resourceType !== 'Consent');
    const specimenEntry = bundle.entry.find((entry) => entry.resource.resourceType === 'Specimen');
    delete (specimenEntry!.resource as { type?: unknown }).type;

    let batchId: string | undefined;
    try {
      const stageResponse = await request.post(`${apiBaseURL}/api/import/fhir/stage`, {
        headers: { Authorization: `Bearer ${token}` },
        data: bundle,
      });
      expect(stageResponse.status()).toBe(201);
      const stageBody = await stageResponse.json();
      const record = stageBody.records[0];
      expect(record.status).toBe('ERROR');
      expect(record.errors.some((error: { field: string }) => error.field === 'sampleType')).toBe(true);

      batchId = stageBody.batch._id;
      const commitResponse = await request.post(`${apiBaseURL}/api/import/fhir/batches/${batchId}/commit`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const commitBody = await commitResponse.json();
      expect(commitBody.committed).toBe(0);

      const [stagingRecord] = await findStagingRecordsByBatch(batchId!);
      expect(stagingRecord?.status).toBe('ERROR');

      const committedSample = await findCommittedSample(specimenId);
      expect(committedSample).toBeNull();
    } finally {
      await removeFhirImportFixtures(specimenId, patientId, batchId);
    }
  });

  // #1478, RF011 AC1-AC3, RNF024 AC1: the import validation reads its FHIR
  // profiles and identifier namespaces from the stored registries, and the
  // mapping release those rows hang off is created and read back.
  test('validates an import against a registered FHIR profile and identifier namespace, read from the mapping and profile registries (RF011 AC1, AC2, AC3, RNF024 AC1)', async ({
    request,
  }) => {
    const { token } = await realLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = String(Date.now());
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const systemUri = `https://bioadvanced.dev/fhir/NamingSystem/e2e-rf011-${suffix}`;
    const canonicalUrl = `https://bioadvanced.dev/fhir/StructureDefinition/e2e-rf011-patient-${suffix}`;

    let namespaceId: string | undefined;
    let releaseId: string | undefined;
    let profileId: string | undefined;
    try {
      // RF011 AC3: the identifier namespace the Patient's identifier.system names.
      const namespaceResponse = await request.post(`${apiBaseURL}/api/identifier-namespaces`, {
        headers,
        data: {
          namespaceKey: `e2e-rf011-${suffix}`,
          systemUri,
          authorityDomain: 'bioadvanced.dev',
          targetTypes: ['patient'],
          semanticVersion: '1.0.0',
          status: 'active',
          effectivePeriod: { start: dayAgo },
          configurationReleaseId: 'e2e-rf011-config',
        },
      });
      expect(namespaceResponse.status(), await namespaceResponse.text()).toBe(201);
      namespaceId = (await namespaceResponse.json()).data.identifierNamespaceRegistryId;

      // RF011 AC2: a mapping release naming that namespace, read back from the registry.
      const releaseResponse = await request.post(`${apiBaseURL}/api/interoperability-mapping-releases`, {
        headers,
        data: {
          standard: 'FHIR R4',
          mappingVersion: `e2e-rf011-${suffix}`,
          mappingUri: `https://bioadvanced.dev/fhir/mappings/e2e-rf011-${suffix}`,
          checksum: `sha256:${'a'.repeat(64)}`,
          authorId: 'e2e-rf011-author',
          status: 'approved',
          roundTripLossReportUri: 'https://bioadvanced.dev/fhir/reports/e2e-rf011-loss',
          canonicalModelReleaseId: 'canonical-model-v2.0.0',
          fhirVersion: '4.0.1',
          mappingDefinitionUri: 'https://bioadvanced.dev/fhir/mappings/e2e-rf011.map',
          mappingDefinitionHash: 'b'.repeat(64),
          conformanceTestReportUri: 'https://bioadvanced.dev/fhir/reports/e2e-rf011-conformance',
          coverageNumerator: 3,
          coverageDenominator: 4,
          coverageRatio: 0.75,
          roundTripLossesPresent: true,
          profileRegistryIds: [`e2e-rf011-profile-${suffix}`],
          resourceTypes: ['Patient'],
          identifierNamespaceRegistryIds: [namespaceId],
          approvedBy: ['e2e-rf011-approver'],
          approvedAt: new Date().toISOString(),
          effectivePeriod: { start: dayAgo },
        },
      });
      expect(releaseResponse.status(), await releaseResponse.text()).toBe(201);
      releaseId = (await releaseResponse.json()).data.interoperabilityMappingReleaseId;

      const releaseRead = await request.get(`${apiBaseURL}/api/interoperability-mapping-releases/${releaseId}`, { headers });
      expect(releaseRead.status()).toBe(200);
      const release = (await releaseRead.json()).data;
      expect(release.mappingVersion).toBe(`e2e-rf011-${suffix}`);
      expect(release.status).toBe('approved');
      expect(release.identifierNamespaceRegistryIds).toEqual([namespaceId]);
      expect(release.coverageRatio).toBe(0.75);

      // RF011 AC2: a profile must hang off a stored release.
      const profileBody = {
        canonicalUrl,
        fhirVersion: '4.0.1',
        profileVersion: '1.0.0',
        identifierSystems: [systemUri],
        status: 'active',
      };
      const orphanProfile = await request.post(`${apiBaseURL}/api/fhir-profiles`, {
        headers,
        data: { ...profileBody, mappingReleaseId: `no-such-release-${suffix}` },
      });
      expect(orphanProfile.status()).toBe(404);
      expect((await orphanProfile.json()).error).toBe(`mappingReleaseId no-such-release-${suffix} não encontrado`);

      const profileResponse = await request.post(`${apiBaseURL}/api/fhir-profiles`, {
        headers,
        data: { ...profileBody, mappingReleaseId: releaseId },
      });
      expect(profileResponse.status(), await profileResponse.text()).toBe(201);
      profileId = (await profileResponse.json()).data.fhirProfileRegistryId;

      const profileRead = await request.get(`${apiBaseURL}/api/fhir-profiles/${profileId}`, { headers });
      expect(profileRead.status()).toBe(200);
      const profile = (await profileRead.json()).data;
      expect(profile.canonicalUrl).toBe(canonicalUrl);
      expect(profile.mappingReleaseId).toBe(releaseId);
      expect(profile.status).toBe('active');

      const validate = (resource: unknown) =>
        request.post(`${apiBaseURL}/api/import/validate`, {
          headers,
          multipart: {
            dataType: 'patients',
            file: {
              name: 'rf011-patient.json',
              mimeType: 'application/json',
              buffer: Buffer.from(JSON.stringify(resource)),
            },
          },
        });
      const good = {
        resourceType: 'Patient',
        id: `rf011-validate-${suffix}`,
        meta: { profile: [`${canonicalUrl}|1.0.0`] },
        identifier: [{ system: systemUri, value: `rf011-${suffix}` }],
        name: [{ text: 'RF011 validate' }],
        gender: 'female',
        birthDate: '1990-01-01',
      };

      // RF011 AC1, RNF024 AC1: the registered profile and namespace validate.
      const accepted = await validate(good);
      expect(accepted.status(), await accepted.text()).toBe(200);
      const acceptedBody = await accepted.json();
      expect(acceptedBody.success).toBe(true);
      expect(acceptedBody.metadata.fhir).toBe(true);
      expect(acceptedBody.metadata.fhirResourcesValidated).toBe(1);

      // An unsupported FHIR version, an unregistered profile version and an
      // unregistered identifier.system are each refused, located by expression.
      const unregisteredSystem = `https://bioadvanced.dev/fhir/NamingSystem/e2e-rf011-unregistered-${suffix}`;
      const refused = await validate({
        ...good,
        fhirVersion: '3.0.2',
        meta: { profile: [`${canonicalUrl}|9.9.9`] },
        identifier: [{ system: unregisteredSystem, value: 'x' }],
      });
      expect(refused.status()).toBe(400);
      const refusedBody = await refused.json();
      expect(refusedBody.errors).toEqual([
        'Versão FHIR não suportada: 3.0.2 (aceitas: 4.0.1, R4)',
        `Perfil FHIR não registrado: ${canonicalUrl}|9.9.9`,
        `identifier.system fora de namespace registrado: ${unregisteredSystem}`,
      ]);
      expect(refusedBody.operationOutcome.issue.map((issue: { expression?: string[] }) => issue.expression)).toEqual([
        ['/fhirVersion'],
        ['/meta/profile/0'],
        ['/identifier/0/system'],
      ]);

      // Control: with the profile row deleted the same resource is refused,
      // so the 200 above came from the stored profile.
      const profileDelete = await request.delete(`${apiBaseURL}/api/fhir-profiles/${profileId}`, { headers });
      expect(profileDelete.status()).toBe(200);
      profileId = undefined;
      const afterDelete = await validate(good);
      expect(afterDelete.status()).toBe(400);
      expect((await afterDelete.json()).errors).toEqual([`Perfil FHIR não registrado: ${canonicalUrl}|1.0.0`]);
    } finally {
      if (profileId) await request.delete(`${apiBaseURL}/api/fhir-profiles/${profileId}`, { headers });
      if (releaseId) await request.delete(`${apiBaseURL}/api/interoperability-mapping-releases/${releaseId}`, { headers });
      if (namespaceId) await request.delete(`${apiBaseURL}/api/identifier-namespaces/${namespaceId}`, { headers });
    }
  });

  // #1478, RF011 AC4, AC6: staging maps a ResearchStudy onto Study and writes
  // the round-trip loss report on the batch and on each record, kept at rest.
  test('stages a Bundle that writes its round-trip loss report and maps a ResearchStudy (RF011 AC4, AC6)', async ({
    request,
  }) => {
    const { token } = await realLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = String(Date.now());
    const { patientId, specimenId, bundle } = buildFhirBundle(`loss-${suffix}`);
    const payload = {
      ...bundle,
      entry: [
        ...bundle.entry,
        {
          resource: {
            resourceType: 'ResearchStudy',
            id: `rf011-study-${suffix}`,
            identifier: [{ value: `rf011-study-${suffix}` }],
            title: `RF011 e2e study ${suffix}`,
            status: 'active',
            relatedArtifact: [{ type: 'documentation', label: 'CAAE-e2e-rf011' }],
            keyword: [{ text: 'rf011-e2e' }],
          },
        },
        {
          resource: {
            resourceType: 'Organization',
            id: `rf011-org-${suffix}`,
            name: 'RF011 e2e unattached organization',
          },
        },
      ],
    };

    let batchId: string | undefined;
    try {
      const stageResponse = await request.post(`${apiBaseURL}/api/import/fhir/stage`, { headers, data: payload });
      expect(stageResponse.status(), await stageResponse.text()).toBe(201);
      const stageBody = await stageResponse.json();
      batchId = stageBody.batch._id;

      // RF011 AC4: the ResearchStudy maps onto Study, its keyword reported unmapped.
      expect(stageBody.batch.mappedResources.mappedResourceCount).toBe(1);
      expect(stageBody.batch.mappedResources.mappedResources[0]).toMatchObject({
        resourceIndex: 4,
        resourceType: 'ResearchStudy',
        mappingId: 'MAP-V2-009',
        canonicalEntity: 'Study',
        canonicalFields: ['ethicsApprovalId', 'studyId', 'studyStatus', 'studyTitle'],
        unmappedCount: 1,
        unmapped: ['ResearchStudy.keyword[0].text'],
        truncated: false,
      });

      // RF011 AC6: the batch's loss report names the resource no record took.
      expect(stageBody.batch.roundTripLoss).toEqual({
        unattachedResourceCount: 1,
        unattached: [{ resourceIndex: 5, resourceType: 'Organization' }],
      });

      // RF011 AC6: each record's loss report names the paths it drops.
      const record = stageBody.records[0];
      expect(record.status).toBe('READY_TO_COMMIT');
      expect(record.roundTripLoss.unmappedCount).toBe(2);
      expect(record.roundTripLoss.unmapped).toEqual([
        { source: 'patient', path: 'Patient.identifier[0].system' },
        { source: 'specimen', path: 'Specimen.identifier[0].value' },
      ]);
      expect(record.roundTripLoss.truncated).toBe(false);
      expect(record.roundTripLoss.limitations).toContain('O system do identificador do Patient não é mantido.');

      // The reports are written at rest, in plain form, on the stored rows.
      const storedBatch = await findLgpdQuarantineBatch(String(batchId));
      expect(storedBatch?.roundTripLoss).toEqual(stageBody.batch.roundTripLoss);
      expect(storedBatch?.mappedResources?.mappedResourceCount).toBe(1);
      const [storedRecord] = await findStagingRecordsByBatch(String(batchId));
      expect(storedRecord?.roundTripLoss?.unmapped).toEqual(record.roundTripLoss.unmapped);
    } finally {
      await removeFhirImportFixtures(specimenId, patientId, batchId);
    }
  });

  // #1478, RNF024 AC1-AC3: the FHIR export carries each record's canonical
  // identifier, validates as R4 under its mapping, and writes nothing back.
  test('exports a Study and a WorkflowRun as FHIR R4 carrying their canonical identifiers, writing neither (RNF024 AC1, AC2, AC3)', async ({
    request,
  }) => {
    const { token, user } = await realLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const suffix = String(Date.now());
    const studyId = `rf011-export-study-${suffix}`;
    const ethics = `CAAE-e2e-rnf024-${suffix}`;

    let workflowRunId: string | undefined;
    try {
      const createStudy = await request.post(`${apiBaseURL}/api/studies`, {
        headers,
        data: { studyId, studyTitle: `e2e RNF024 ${studyId}`, ethicsApprovalId: [ethics] },
      });
      expect(createStudy.status(), await createStudy.text()).toBe(201);
      const before = await (await request.get(`${apiBaseURL}/api/studies/${studyId}`, { headers })).json();

      const studyExport = await request.get(`${apiBaseURL}/api/export/fhir/studies/${studyId}`, { headers });
      expect(studyExport.status(), await studyExport.text()).toBe(200);
      const data = (await studyExport.json()).data;
      expect(data.standard).toBe('HL7 FHIR');
      expect(data.fhirVersion).toBe('4.0.1');
      expect(data.mapping.mappingId).toBe('MAP-V2-009');
      expect(data.mappingReleaseId).toBeNull();
      expect(data.conformanceClaimed).toBe(false);
      expect(data.bundle.resourceType).toBe('Bundle');
      expect(data.bundle.type).toBe('collection');
      expect(data.bundle.entry).toHaveLength(1);
      // RNF024 AC2: the canonical studyId is the resource id and identifier.
      const resource = data.bundle.entry[0].resource;
      expect(resource.resourceType).toBe('ResearchStudy');
      expect(resource.id).toBe(studyId);
      expect(resource.identifier).toEqual([{ value: studyId }]);
      expect(resource.title).toBe(`e2e RNF024 ${studyId}`);
      expect(resource.status).toBe('active');
      expect(resource.relatedArtifact).toEqual([{ type: 'documentation', label: ethics }]);

      // RNF024 AC3: the export leaves the Study as it was.
      const after = await (await request.get(`${apiBaseURL}/api/studies/${studyId}`, { headers })).json();
      expect(after).toEqual(before);
      const missingStudy = await request.get(`${apiBaseURL}/api/export/fhir/studies/no-such-study-${suffix}`, { headers });
      expect(missingStudy.status()).toBe(404);

      const createRun = await request.post(`${apiBaseURL}/api/workflow-runs`, {
        headers,
        data: {
          workflowId: 'variant-calling-pipeline',
          workflowVersion: '2.3.1',
          createdBy: `User/${user._id}`,
          containerImageDigest: 'sha256:e2e0000000000000000000000000000000000000000000000000000000000',
          softwareDependencies: [{ name: 'bwa', version: '0.7.17' }],
          parameters: { threads: 8 },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          runStatus: 'succeeded',
          hardwareProfile: { cpu: 'synthetic', gpu: null },
          environmentManifestUri: 'object://synthetic/environment.json',
        },
      });
      expect(createRun.status(), await createRun.text()).toBe(201);
      workflowRunId = (await createRun.json()).data.workflowRunId;

      // RNF024 AC2: the run's id and its author's identifier carry into Provenance.
      const runExport = await request.get(`${apiBaseURL}/api/export/fhir/workflow-runs/${workflowRunId}`, { headers });
      expect(runExport.status(), await runExport.text()).toBe(200);
      const runData = (await runExport.json()).data;
      expect(runData.mapping.mappingId).toBe('MAP-V2-008');
      const provenance = runData.bundle.entry[0].resource;
      expect(provenance.resourceType).toBe('Provenance');
      expect(provenance.id).toBe(workflowRunId);
      expect(provenance.agent[0].who.identifier.value).toBe(`User/${user._id}`);

      const lineageExport = await request.get(`${apiBaseURL}/api/export/fhir/workflow-runs/${workflowRunId}/lineage`, { headers });
      expect(lineageExport.status(), await lineageExport.text()).toBe(200);
      const lineageData = (await lineageExport.json()).data;
      expect(lineageData.lineage.workflowRunId).toBe(workflowRunId);
      expect(lineageData.bundle.entry[0].resource.id).toBe(workflowRunId);
    } finally {
      await request.delete(`${apiBaseURL}/api/studies/${studyId}`, { headers });
      if (workflowRunId) await request.delete(`${apiBaseURL}/api/workflow-runs/${workflowRunId}`, { headers });
    }
  });
});

// Wave 3 kickoff (#646). RF015's 7 acceptance criteria (requisitos-index.md)
// and RNF026 (latência/confiabilidade de alertas críticos) are proven here
// against the real trigger #298 already exercises above: an out-of-range
// telemetry reading opening/widening a real EnvironmentalExcursion. No
// NotificationRule exists for 'environmental_excursion' until this describe
// block creates one -- every earlier real-backend run in this suite that
// triggered an excursion (including #298's own tests above) no-opped
// through the dispatch engine harmlessly (dispatchNotification's own
// no-active-rule short-circuit), so creating the rule here doesn't
// retroactively affect anything already proven.
test.describe('Alertas e notificações (RF015) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
    await closeSeedParticipantDb();
  });

  test('a real environmental excursion creates a rule-driven, versioned, event-linked notification within SLA (criteria 1,2,3,6,7)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const ruleRes = await request.post(`${apiBaseURL}/api/notification-rules`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        eventType: 'environmental_excursion',
        channels: ['in_app'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: ['sensorId', 'temperatureValue'],
        maxDeliveryMinutes: 2,
      },
    });
    expect(ruleRes.ok(), await ruleRes.text()).toBeTruthy();
    const rule = (await ruleRes.json()).data;

    const sensor = await seedSensorWithPolicy(2, 8);
    const telemetryRes = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      headers: ingestHeaders(),
      data: { sensorId: sensor.sensorId, temperature: 25, timestamp: new Date().toISOString() },
    });
    expect(telemetryRes.status()).toBe(200);

    await expect
      .poll(async () => findEnvironmentalExcursion(sensor.deviceId), { timeout: 15_000 })
      .toBeTruthy();
    const excursion = await findEnvironmentalExcursion(sensor.deviceId);

    const findNotification = async () => {
      const res = await request.get(
        `${apiBaseURL}/api/notifications?eventType=environmental_excursion&limit=50`,
        { headers: { Authorization: `Bearer ${admin.token}` } }
      );
      if (!res.ok()) return null;
      const body = await res.json();
      return (body.data || []).find((n: any) => n.sourceEventId === String(excursion._id)) || null;
    };

    await expect.poll(findNotification, { timeout: 15_000 }).toBeTruthy();
    const notification = await findNotification();

    // Criterion 1 - created from the versioned rule.
    expect(notification.ruleId).toBe(rule._id);
    expect(notification.ruleVersion).toBe(rule.version);
    // Criterion 2 - delivered via an enabled channel.
    expect(notification.status).toBe('delivered');
    expect(notification.deliveredChannel).toBe('in_app');
    // Criterion 3 - the attempt is recorded (channel, timestamp, result).
    expect(notification.attempts).toEqual([
      expect.objectContaining({ channel: 'in_app', result: 'success' }),
    ]);
    // Criterion 6 - linked to the originating event.
    expect(notification.sourceEventType).toBe('EnvironmentalExcursion');
    expect(notification.sourceEventId).toBe(String(excursion._id));
    expect(notification.payload).toEqual({ sensorId: sensor.sensorId, temperatureValue: 25 });
    // Criterion 7 / RNF026 AC#1 - delivered well within the SLA window (the
    // rule's own maxDeliveryMinutes, itself inside RNF026's 2-minute p95).
    expect(notification.withinSla).toBe(true);
    expect(notification.deliveryDurationMs).toBeLessThan(2 * 60000);

    // Criterion 3 "confirmação" - an explicit read receipt.
    const confirmRes = await request.put(`${apiBaseURL}/api/notifications/${notification._id}/confirm`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy();
    expect((await confirmRes.json()).data.confirmedAt).toBeTruthy();
  });

  test('escalates to the fallback channel when the primary channel has no resolvable recipients (criterion 4)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    // A role code no user can hold resolves to zero recipients -- a real
    // resolution failure, not a simulated one, same technique
    // notificationDispatch.service.test.js uses natively. #1223: this was
    // 'coordinator', which is empty only on a fresh volume; once any spec
    // registers a Coordenador, the email channel resolves a recipient and
    // nothing escalates. NotificationRule.validate does not check codes
    // against the RBAC catalog, so a per-run code is accepted and empty by
    // construction on any volume.
    const ruleRes = await request.post(`${apiBaseURL}/api/notification-rules`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        eventType: 'environmental_excursion',
        channels: ['email'],
        recipientRoleCodes: [`e2e-no-holder-${Date.now()}`],
        sensitiveFieldsAllowlist: ['sensorId'],
        maxDeliveryMinutes: 2,
        escalation: { enabled: true, afterFailures: 1, channel: 'in_app' },
      },
    });
    expect(ruleRes.ok(), await ruleRes.text()).toBeTruthy();
    const rule = (await ruleRes.json()).data;
    expect(rule.version).not.toBe('v1'); // versions the prior test's rule, doesn't overwrite it

    const sensor = await seedSensorWithPolicy(2, 8);
    await request.post(`${apiBaseURL}/api/iot/telemetry`, {
      headers: ingestHeaders(),
      data: { sensorId: sensor.sensorId, temperature: 30, timestamp: new Date().toISOString() },
    });

    await expect
      .poll(async () => findEnvironmentalExcursion(sensor.deviceId), { timeout: 15_000 })
      .toBeTruthy();
    const excursion = await findEnvironmentalExcursion(sensor.deviceId);

    const findNotification = async () => {
      const res = await request.get(
        `${apiBaseURL}/api/notifications?eventType=environmental_excursion&limit=50`,
        { headers: { Authorization: `Bearer ${admin.token}` } }
      );
      if (!res.ok()) return null;
      const body = await res.json();
      return (body.data || []).find((n: any) => n.sourceEventId === String(excursion._id)) || null;
    };

    await expect.poll(findNotification, { timeout: 15_000 }).toBeTruthy();
    const notification = await findNotification();

    expect(notification.escalated).toBe(true);
    expect(notification.status).toBe('delivered');
    expect(notification.deliveredChannel).toBe('in_app');
    expect(notification.attempts).toEqual([
      expect.objectContaining({ channel: 'email', result: 'failure', reason: 'no_recipients', escalation: false }),
      expect.objectContaining({ channel: 'in_app', result: 'success', escalation: true }),
    ]);
  });

  // #650 (RF015 follow-up, segurança domain) — the first of the 4 remaining
  // domains named in the issue (segurança/consentimento/qualidade/
  // governança). RF003's real MFA brute-force lockout (auth.service.js's
  // processLogin, mfaFailedAttempts >= 5) now also fires dispatchNotification
  // -- same "prove the real trigger, not a simulated one" bar as the
  // environmental_excursion tests above.
  test('a real MFA brute-force lockout creates a rule-driven notification (RF015 segurança domain)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const ruleRes = await request.post(`${apiBaseURL}/api/notification-rules`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        eventType: 'mfa_brute_force_lockout',
        channels: ['in_app'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: ['userId', 'username', 'failedAttempts'],
        maxDeliveryMinutes: 2,
      },
    });
    expect(ruleRes.ok(), await ruleRes.text()).toBeTruthy();
    const rule = (await ruleRes.json()).data;

    const username = `tecnico.rf015sec.${Date.now()}`;
    const password = 'Tecnico@123456-forte';
    const registerRes = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF015 Segurança Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerRes.ok(), await registerRes.text()).toBeTruthy();
    const userId = (await registerRes.json()).data?._id || (await registerRes.json()).data?.id;

    const qrRes = await request.post(`${apiBaseURL}/api/auth/two-factor/qr-first-login`, {
      data: { username, password },
    });
    expect(qrRes.ok(), await qrRes.text()).toBeTruthy();
    const totpSecret = (await qrRes.json()).data?.secret;
    expect(totpSecret).toBeTruthy();
    const enableRes = await request.post(`${apiBaseURL}/api/auth/two-factor/enable-first-login`, {
      data: { username, password, code: computeTotp(totpSecret) },
    });
    expect(enableRes.ok(), await enableRes.text()).toBeTruthy();

    // 5 wrong codes in a row locks MFA (auth.service.js's processLogin,
    // mfaFailedAttempts >= 5 on the 5th). Deterministically wrong against
    // the real secret (not just improbable): the real code is computed and
    // avoided outright.
    const realCode = computeTotp(totpSecret);
    const wrongCode = realCode === '000000' ? '111111' : '000000';

    let lastLoginBody: { message?: string } = {};
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const loginRes = await request.post(`${apiBaseURL}/api/auth/login`, {
        data: { username, password, twoFactorCode: wrongCode },
      });
      expect(loginRes.status()).toBe(401);
      lastLoginBody = await loginRes.json();
    }
    expect(lastLoginBody.message).toContain('MFA bloqueado');

    // #1255: these five deliberate failures also count against the runner's
    // source address, which every direct spec call shares. Clear them so
    // they do not spend the suite's blockIPAfterAttempts budget.
    await clearLoginAttempts();
    await closeLoginAttemptsDb();

    const findNotification = async () => {
      const res = await request.get(
        `${apiBaseURL}/api/notifications?eventType=mfa_brute_force_lockout&limit=50`,
        { headers: { Authorization: `Bearer ${admin.token}` } }
      );
      if (!res.ok()) return null;
      const body = await res.json();
      return (body.data || []).find((n: any) => n.payload?.userId === String(userId)) || null;
    };

    await expect.poll(findNotification, { timeout: 15_000 }).toBeTruthy();
    const notification = await findNotification();

    expect(notification.ruleId).toBe(rule._id);
    expect(notification.status).toBe('delivered');
    expect(notification.deliveredChannel).toBe('in_app');
    expect(notification.sourceEventType).toBe('User');
    expect(notification.sourceEventId).toBe(String(userId));
    expect(notification.payload).toEqual({
      userId: String(userId),
      username,
      failedAttempts: 5,
    });
  });

  // #650 (RF015 follow-up, consentimento domain) — the 2nd of the 4 domains
  // named in the issue. A real consent revocation (consent.service.js's
  // revokeConsent, the same endpoint eConsent.js's own full-revocation path
  // and POST /consents/:id/revoke both use) now also fires
  // dispatchNotification.
  test('a real consent revocation creates a rule-driven notification (RF015 consentimento domain)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const ruleRes = await request.post(`${apiBaseURL}/api/notification-rules`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        eventType: 'consent_revoked',
        channels: ['in_app'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: ['participantId', 'consentId'],
        maxDeliveryMinutes: 2,
      },
    });
    expect(ruleRes.ok(), await ruleRes.text()).toBeTruthy();
    const rule = (await ruleRes.json()).data;

    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const consentRes = await request.post(`${apiBaseURL}/api/e-consent/consents`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        consentTemplateId: participant.consentTemplateId,
        responses: {},
        signatureName: 'RF015 consentimento e2e signatory',
        signatureImageBase64:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      },
    });
    expect(consentRes.ok(), await consentRes.text()).toBeTruthy();
    const consent = (await consentRes.json()).data;

    const revokeRes = await request.post(`${apiBaseURL}/api/e-consent/consents/${consent._id}/revoke`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(revokeRes.ok(), await revokeRes.text()).toBeTruthy();

    const findNotification = async () => {
      const res = await request.get(
        `${apiBaseURL}/api/notifications?eventType=consent_revoked&limit=50`,
        { headers: { Authorization: `Bearer ${admin.token}` } }
      );
      if (!res.ok()) return null;
      const body = await res.json();
      return (body.data || []).find((n: any) => n.payload?.consentId === String(consent._id)) || null;
    };

    await expect.poll(findNotification, { timeout: 15_000 }).toBeTruthy();
    const notification = await findNotification();

    expect(notification.ruleId).toBe(rule._id);
    expect(notification.status).toBe('delivered');
    expect(notification.deliveredChannel).toBe('in_app');
    expect(notification.sourceEventType).toBe('PatientConsent');
    expect(notification.sourceEventId).toBe(String(consent._id));
    expect(notification.payload).toEqual({
      participantId: participant.participantId,
      consentId: String(consent._id),
    });
  });

  // #650 (RF015 follow-up, governança domain) — the 3rd of the 4 domains
  // named in the issue. A real disposition action (dispositionAction.
  // service.js's recordDisposition, RF026's own "Retenção e destinação"
  // trigger) now also fires dispatchNotification.
  test('a real disposition action creates a rule-driven notification (RF015 governança domain)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const ruleRes = await request.post(`${apiBaseURL}/api/notification-rules`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        eventType: 'disposition_action_recorded',
        channels: ['in_app'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: ['entityType', 'dispositionAction', 'retentionPolicyId'],
        maxDeliveryMinutes: 2,
      },
    });
    expect(ruleRes.ok(), await ruleRes.text()).toBeTruthy();
    const rule = (await ruleRes.json()).data;

    const policyRes = await request.post(`${apiBaseURL}/api/retention-policies`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        applicableEntityTypes: ['Log'],
        triggerEvent: 'creation',
        postRetentionAction: 'destroy',
        retentionPeriod: 'P365D',
        jurisdiction: 'BR',
        retentionBasis: ['RF015 e2e fixture basis'],
        legalHoldRules: [{ when: 'legalHold=true', block: 'destroy' }],
        reviewRequired: false,
      },
    });
    expect(policyRes.ok(), await policyRes.text()).toBeTruthy();
    const retentionPolicyId = String((await policyRes.json()).data._id);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dispositionRes = await request.post(`${apiBaseURL}/api/disposition-actions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        retentionPolicyId,
        entityType: 'Log',
        affectedRecordIds: [`log-rf015gov-${suffix}`],
        dispositionAction: 'destroy',
        dispositionMethod: 'secure-wipe',
      },
    });
    expect(dispositionRes.ok(), await dispositionRes.text()).toBeTruthy();
    const disposition = (await dispositionRes.json()).data;

    const findNotification = async () => {
      const res = await request.get(
        `${apiBaseURL}/api/notifications?eventType=disposition_action_recorded&limit=50`,
        { headers: { Authorization: `Bearer ${admin.token}` } }
      );
      if (!res.ok()) return null;
      const body = await res.json();
      return (body.data || []).find((n: any) => n.sourceEventId === disposition.dispositionActionId) || null;
    };

    await expect.poll(findNotification, { timeout: 15_000 }).toBeTruthy();
    const notification = await findNotification();

    expect(notification.ruleId).toBe(rule._id);
    expect(notification.status).toBe('delivered');
    expect(notification.deliveredChannel).toBe('in_app');
    expect(notification.sourceEventType).toBe('DispositionAction');
    expect(notification.sourceEventId).toBe(disposition.dispositionActionId);
    expect(notification.payload).toEqual({
      entityType: 'Log',
      dispositionAction: 'destroy',
      retentionPolicyId,
    });
  });

  // #650 (RF015 follow-up, qualidade domain) — the 4th and final of the 4
  // domains named in the issue. A real non-conformance open
  // (nonconformance.service.js's open, RF025's own "Ensaios e qualidade"
  // AC#5 trigger) now also fires dispatchNotification. affectedEntityIds
  // has no referential check (format-only validation), so no assay/sample
  // fixture is needed here, unlike specimen-quality-inventory.spec.ts's own
  // RF025 non-conformance test which builds a real assay first.
  test('a real non-conformance open creates a rule-driven notification (RF015 qualidade domain)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const ruleRes = await request.post(`${apiBaseURL}/api/notification-rules`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        eventType: 'nonconformance_opened',
        channels: ['in_app'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: ['nonconformanceType', 'affectedEntityIds'],
        maxDeliveryMinutes: 2,
      },
    });
    expect(ruleRes.ok(), await ruleRes.text()).toBeTruthy();
    const rule = (await ruleRes.json()).data;

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const openRes = await request.post(`${apiBaseURL}/api/nonconformances`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        nonconformanceType: 'deviation',
        detectedAt: new Date().toISOString(),
        description: 'RF015 qualidade e2e fixture',
        affectedEntityIds: [`rf015qual-${suffix}`],
      },
    });
    expect(openRes.status(), await openRes.text()).toBe(201);
    const nonconformance = (await openRes.json()).data;

    const findNotification = async () => {
      const res = await request.get(
        `${apiBaseURL}/api/notifications?eventType=nonconformance_opened&limit=50`,
        { headers: { Authorization: `Bearer ${admin.token}` } }
      );
      if (!res.ok()) return null;
      const body = await res.json();
      return (body.data || []).find((n: any) => n.sourceEventId === nonconformance.nonconformanceId) || null;
    };

    await expect.poll(findNotification, { timeout: 15_000 }).toBeTruthy();
    const notification = await findNotification();

    expect(notification.ruleId).toBe(rule._id);
    expect(notification.status).toBe('delivered');
    expect(notification.deliveredChannel).toBe('in_app');
    expect(notification.sourceEventType).toBe('Nonconformance');
    expect(notification.sourceEventId).toBe(nonconformance.nonconformanceId);
    expect(notification.payload).toEqual({
      nonconformanceType: 'deviation',
      affectedEntityIds: [`rf015qual-${suffix}`],
    });
  });
});

// #1317 (RF009 AC2/AC3/AC7): a reading carries its TelemetryReading identity
// and time, and a replayed idempotencyKey returns the stored reading.
test.describe('Telemetry reading identity and replay (#1317, RF009) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('a reading carries identity and time, and a replayed idempotencyKey writes nothing', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const sensorId = `rf009-idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();
    const send = (data: Record<string, unknown>) =>
      request.post(`${apiBaseURL}/api/temperature/reading`, { headers: auth, data: { sensorId, temperatureValue: 4.5, ...data } });

    await bindSensor(sensorId);
    try {
      const first = await send({ timestamp, idempotencyKey: `${sensorId}-k1` });
      expect(first.status(), await first.text()).toBe(201);
      const stored = (await first.json()).data;
      expect(stored).toMatchObject({ clockStatus: 'synchronized', idempotencyKeySource: 'client', idempotencyKey: `${sensorId}-k1` });
      expect(new Date(stored.observedAt).toISOString()).toBe(timestamp);
      expect(stored.telemetryReadingId).toMatch(/^[0-9a-f-]{36}$/);
      expect(stored.receivedAt).toBeTruthy();
      expect(stored.payloadHash).toMatch(/^[0-9a-f]{64}$/);
      // RF009 AC2: provenance.
      expect(stored).toMatchObject({ schemaVersion: 'telemetry.reading.v1', ingestionService: 'temperature-api', sourceEventId: stored.telemetryReadingId });
      expect(stored.canonicalModelReleaseId).toMatch(/^release-/);
      expect(stored.traceId).toBeTruthy();
      // RF009 AC1: acknowledged only after InfluxDB holds the point, at observedAt.
      expect(stored.persistedAt).toBeTruthy();
      const points = await queryFreezerReadingIds(sensorId);
      expect(points.map((p) => ({ time: new Date(p.time).toISOString(), id: p.telemetryReadingId })))
        .toEqual([{ time: timestamp, id: stored.telemetryReadingId }]);

      const replay = await send({ timestamp, idempotencyKey: `${sensorId}-k1`, temperatureValue: 9 });
      expect(replay.status(), await replay.text()).toBe(200);
      const replayed = (await replay.json()).data;
      expect(replayed.telemetryReadingId).toBe(stored.telemetryReadingId);
      expect(replayed.replayed).toBe(true);
      // #1391: the replay answers from the key store, which holds no value, and
      // InfluxDB still holds the single first point.
      expect(replayed).not.toHaveProperty('temperatureValue');
      expect((await queryFreezerReadingIds(sensorId)).map((p) => ({ time: new Date(p.time).toISOString(), id: p.telemetryReadingId })))
        .toEqual([{ time: timestamp, id: stored.telemetryReadingId }]);

      // Control: another key is a new reading, and no device time is unknown.
      const other = await send({ idempotencyKey: `${sensorId}-k2` });
      expect(other.status(), await other.text()).toBe(201);
      const otherBody = (await other.json()).data;
      expect(otherBody.telemetryReadingId).not.toBe(stored.telemetryReadingId);
      expect(otherBody.clockStatus).toBe('unknown');

      const invalid = await send({ timestamp: 'not-a-date' });
      expect(invalid.status(), await invalid.text()).toBe(422);
    } finally {
      await unbindSensor(sensorId);
    }
  });
});

// #1317 (RF009 AC4, RF017 AC5): a reading is bound to the TelemetryDatastream
// of its sensor valid at its observedAt, created through the route.
test.describe('Telemetry datastream binding (#1317, RF009 AC4) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('a reading inside a datastream validity carries its id and location; one after the end is refused (422)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const sensorId = `rf009-bind-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() - 30 * 60 * 1000);

    await bindSensor(sensorId, { datastream: false, registration: false });
    try {
      const created = await request.post(`${apiBaseURL}/api/telemetry-datastreams`, {
        headers: auth,
        data: {
          sensorId, equipmentId: `${sensorId}-freezer`, storageLocationId: `${sensorId}-loc`, observedProperty: 'temperature', unit: 'Cel',
          samplingPolicyId: 'sampling-e2e', thresholdProfileId: 'threshold-e2e', validityPeriod: { start: start.toISOString() },
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const stream = (await created.json()).data;
      const registered = await request.post(`${apiBaseURL}/api/device-registrations`, {
        headers: auth,
        data: { deviceId: sensorId, communicationProfileId: 'https-e2e', credentialReference: `secret-manager:device/${sensorId}` },
      });
      expect(registered.status(), await registered.text()).toBe(201);
      const ended = await request.post(`${apiBaseURL}/api/telemetry-datastreams/${stream.telemetryDatastreamId}/end`, {
        headers: auth, data: { end: end.toISOString() },
      });
      expect(ended.status(), await ended.text()).toBe(200);

      const send = (timestamp: Date) =>
        request.post(`${apiBaseURL}/api/temperature/reading`, { headers: auth, data: { sensorId, temperatureValue: -80, timestamp: timestamp.toISOString() } });
      const inside = await send(new Date(start.getTime() + 60 * 1000));
      expect(inside.status(), await inside.text()).toBe(201);
      const insideReading = (await inside.json()).data;
      expect(insideReading.datastreamId).toBe(stream.telemetryDatastreamId);
      expect(insideReading.storageLocationId).toBe(`${sensorId}-loc`);

      // compose.test.yml sets TELEMETRY_BINDING_MODE=enforce, which refuses a
      // reading outside every datastream validity, so it reaches no InfluxDB.
      const after = await send(end);
      expect(after.status(), await after.text()).toBe(422);
      // The inside reading is stamped about 59 minutes ago, so the lookback is 90.
      expect((await queryFreezerReadingIds(sensorId, 90)).map((p) => p.telemetryReadingId)).toEqual([insideReading.telemetryReadingId]);
    } finally {
      await unbindSensor(sensorId);
    }
  });

  // V2E-0569: the reading is judged against its datastream's threshold
  // profile, 2..8, not the sensor's own -100..100 policy.
  test('a reading on POST /api/iot/telemetry opens an incident against its datastream threshold profile', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const sensor = await seedSensorWithPolicy(-100, 100, { datastream: false });
    const profile = await seedSensorWithPolicy(2, 8);
    try {
      const created = await request.post(`${apiBaseURL}/api/telemetry-datastreams`, {
        headers: auth,
        data: {
          sensorId: sensor.sensorId, equipmentId: `${sensor.sensorId}-freezer`, storageLocationId: `${sensor.sensorId}-loc`,
          observedProperty: 'temperature', unit: 'Cel', samplingPolicyId: 'sampling-e2e', thresholdProfileId: profile.policyId,
          validityPeriod: { start: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        },
      });
      expect(created.status(), await created.text()).toBe(201);

      const response = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: ingestHeaders(),
        data: { sensorId: sensor.sensorId, temperature: 25, timestamp: new Date().toISOString() },
      });
      expect(response.status(), await response.text()).toBe(200);

      await expect
        .poll(async () => findTemperatureIncident(sensor.sensorId), { timeout: 15_000 })
        .not.toBeNull();
    } finally {
      await removeSeededSensor(sensor);
      await removeSeededSensor(profile);
    }
  });
});

// #1317 (RF009 AC1): the temperature report reads its readings from
// InfluxDB, both the temperature route's `freezer_temperature` points (unit
// tag, converted to Celsius) and POST /api/iot/telemetry's `temperature`
// points (Celsius, no unit tag).
test.describe('Temperature report reads InfluxDB (#1317, RF009 AC1) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('a reading posted on either route shows in the report, with its unit and its Celsius value', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const routeSensorId = `rf009-report-route-${suffix}`;
    const iotSensorId = `rf009-report-iot-${suffix}`;
    const now = new Date();

    await bindSensor(routeSensorId);
    await bindSensor(iotSensorId);
    try {
      const routeReading = await request.post(`${apiBaseURL}/api/temperature/reading`, {
        headers: auth,
        data: { sensorId: routeSensorId, temperatureValue: 41, temperatureUnit: '°F', timestamp: now.toISOString() },
      });
      expect(routeReading.status(), await routeReading.text()).toBe(201);
      const stored = (await routeReading.json()).data;

      const iotReading = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: ingestHeaders(),
        data: { sensorId: iotSensorId, temperature: 5, timestamp: new Date().toISOString() },
      });
      expect(iotReading.status(), await iotReading.text()).toBe(200);
      const iotBody = await iotReading.json();

      const preview = await request.post(`${apiBaseURL}/api/reports/temperature/preview`, {
        headers: auth,
        data: { filters: { startDate: now.toISOString().slice(0, 10) } },
      });
      expect(preview.status(), await preview.text()).toBe(200);
      const temperatures: Array<Record<string, unknown>> = (await preview.json()).data.temperatures;

      const routeRow = temperatures.find((row) => row.sensorId === routeSensorId);
      expect(routeRow).toMatchObject({ temperatureValue: 41, temperatureUnit: '°F', logId: stored.telemetryReadingId });
      expect(routeRow?.temperatureCelsius as number).toBeCloseTo(5, 6);

      const iotRow = temperatures.find((row) => row.sensorId === iotSensorId);
      expect(iotRow).toMatchObject({ temperatureValue: 5, temperatureUnit: '°C', logId: iotBody.telemetryReadingId });
    } finally {
      await unbindSensor(routeSensorId);
      await unbindSensor(iotSensorId);
    }
  });
});

// #1317 (RF009 AC1): the temperature history reads its readings from
// InfluxDB, so a POST /api/iot/telemetry reading (InfluxDB only) shows in it,
// and skip pages through it.
test.describe('Temperature history reads InfluxDB (#1317, RF009 AC1) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('a reading posted to /api/iot/telemetry shows in the history, and skip pages past it', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const sensorId = `rf009-history-iot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await bindSensor(sensorId);
    try {
      const reading = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: ingestHeaders(),
        data: { sensorId, temperature: 5, timestamp: new Date().toISOString() },
      });
      expect(reading.status(), await reading.text()).toBe(200);
      const readingBody = await reading.json();

      const history = await request.get(`${apiBaseURL}/api/temperature/history?sensorId=${encodeURIComponent(sensorId)}`, { headers: auth });
      expect(history.status(), await history.text()).toBe(200);
      const page = (await history.json()).data;
      expect(page.total).toBe(1);
      expect(page.temperatures).toHaveLength(1);
      expect(page.temperatures[0]).toMatchObject({ logId: readingBody.telemetryReadingId, temperatureValue: 5, temperatureUnit: '°C' });

      const skipped = await request.get(`${apiBaseURL}/api/temperature/history?sensorId=${encodeURIComponent(sensorId)}&skip=1`, { headers: auth });
      expect(skipped.status(), await skipped.text()).toBe(200);
      const skippedPage = (await skipped.json()).data;
      expect(skippedPage.temperatures).toEqual([]);
      expect(skippedPage.total).toBe(1);
    } finally {
      await unbindSensor(sensorId);
    }
  });
});

// #1391 (RF009 AC1): a reading lives in InfluxDB only, so GET
// /api/temperature/:id reads it there by its telemetryReadingId.
test.describe('GET /api/temperature/:id reads InfluxDB (#1391, RF009 AC1) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedSensorDb();
  });

  test('a reading posted to /api/iot/telemetry is read back by its telemetryReadingId, and an unknown id is 404', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const sensorId = `rf009-by-id-iot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await bindSensor(sensorId);
    try {
      const reading = await request.post(`${apiBaseURL}/api/iot/telemetry`, {
        headers: ingestHeaders(),
        data: { sensorId, temperature: 5, timestamp: new Date().toISOString() },
      });
      expect(reading.status(), await reading.text()).toBe(200);
      const { telemetryReadingId } = await reading.json();

      const found = await request.get(`${apiBaseURL}/api/temperature/${telemetryReadingId}`, { headers: auth });
      expect(found.status(), await found.text()).toBe(200);
      expect((await found.json()).data).toMatchObject({ telemetryReadingId, sensorId, temperatureValue: 5, temperatureUnit: '°C' });

      const missing = await request.get(`${apiBaseURL}/api/temperature/${crypto.randomUUID()}`, { headers: auth });
      expect(missing.status(), await missing.text()).toBe(404);
    } finally {
      await unbindSensor(sensorId);
    }
  });
});
