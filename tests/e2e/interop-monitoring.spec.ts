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
} from './helpers/seedSensor';
import { queryTemperaturePoints } from './helpers/queryInflux';
import { realLogin } from './helpers/realAuth';
import { seedSampleNode, readSampleStatus, removeSampleNodes, closeNeo4jDriver } from './helpers/queryNeo4j';
import {
  findStagingRecordBySpecimenId,
  findCommittedSample,
  findCommittedPatient,
  findFhirImportAuditLogs,
  removeFhirImportFixtures,
  closeFhirImportDb,
} from './helpers/queryFhirImport';

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

  test('resolving the paired TemperatureIncident closes the matching open EnvironmentalExcursion (#301)', async ({
    request,
  }) => {
    const sensor = await seedSensorWithPolicy(2, 8);

    await request.post(`${apiBaseURL}/api/iot/telemetry`, {
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

      const batchId = stageBody.batch._id;

      const commitResponse = await request.post(`${apiBaseURL}/api/import/fhir/batches/${batchId}/commit`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(commitResponse.status()).toBe(200);
      const commitBody = await commitResponse.json();
      expect(commitBody.committed).toBe(1);

      // Criterion 2: Participant mapped from FHIR Patient.
      await expect.poll(() => findCommittedPatient(patientId), { timeout: 10_000 }).not.toBeNull();
      const committedPatient = await findCommittedPatient(patientId);
      expect(committedPatient?.patientName).toContain('RF011 e2e patient');

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
      await removeFhirImportFixtures(specimenId, patientId);
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

      const batchId = stageBody.batch._id;
      const commitResponse = await request.post(`${apiBaseURL}/api/import/fhir/batches/${batchId}/commit`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const commitBody = await commitResponse.json();
      expect(commitBody.committed).toBe(0);

      const stagingRecord = await findStagingRecordBySpecimenId(specimenId);
      expect(stagingRecord?.status).toBe('ERROR');

      const committedSample = await findCommittedSample(specimenId);
      expect(committedSample).toBeNull();
    } finally {
      await removeFhirImportFixtures(specimenId, patientId);
    }
  });
});
