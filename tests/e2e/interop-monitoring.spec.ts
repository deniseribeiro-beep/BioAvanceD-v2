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
} from './helpers/seedSensor';
import { queryTemperaturePoints, queryFreezerReadingIds } from './helpers/queryInflux';
import { realLogin } from './helpers/realAuth';
import { computeTotp } from './helpers/totp';
import { clearLoginAttempts, closeLoginAttemptsDb } from './helpers/queryLoginAttempts';
import { createRealParticipant, closeSeedDb as closeSeedParticipantDb } from './helpers/seedParticipant';
import { seedSampleNode, readSampleStatus, removeSampleNodes, closeNeo4jDriver } from './helpers/queryNeo4j';
import {
  findStagingRecordsByBatch,
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
      expect(committedIdentity?.patientNameEncrypted).toBeTruthy();
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
  test('a reading carries identity and time, and a replayed idempotencyKey writes nothing', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const sensorId = `rf009-idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();
    const send = (data: Record<string, unknown>) =>
      request.post(`${apiBaseURL}/api/temperature/reading`, { headers: auth, data: { sensorId, temperatureValue: 4.5, ...data } });

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
    expect(replayed.temperatureValue).toBe(4.5);

    // Control: another key is a new reading, and no device time is unknown.
    const other = await send({ idempotencyKey: `${sensorId}-k2` });
    expect(other.status(), await other.text()).toBe(201);
    const otherBody = (await other.json()).data;
    expect(otherBody.telemetryReadingId).not.toBe(stored.telemetryReadingId);
    expect(otherBody.clockStatus).toBe('unknown');

    const invalid = await send({ timestamp: 'not-a-date' });
    expect(invalid.status(), await invalid.text()).toBe(422);
  });
});
