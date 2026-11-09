import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { realLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { seedSensorOnFreezer, removeSensorOnFreezer, closeSeedSensorDb, type SeededFreezerSensor } from './helpers/seedSensor';
import { queryTemperaturePoints } from './helpers/queryInflux';
import { waitForDerivedFrom, readSampleStatus, removeSampleNodes, countSampleNodes, closeNeo4jDriver } from './helpers/queryNeo4j';
import { sampleOutboxEvents, closeOutboxDb } from './helpers/queryOutbox';

// Real backend only — see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack: this spec needs neo4j-projection-worker-test (compose.test.yml)
// draining graph_projection_outbox and the real InfluxDB behind
// TelemetryMonitor.findCriticalFreezers.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

// directConnection=true (#297): see seedParticipant.ts.
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

// #1091: POST /api/iot/telemetry is gated by machineIngestGate.js.
const ingestHeaders = () => ({ 'x-telemetry-ingest-secret': process.env.TELEMETRY_INGEST_SECRET ?? '' });

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

// #1368 (dict-02 ELM-0120): a derivative registered through POST /api/samples
// with parentSpecimenIds gets a DERIVED_FROM edge to its parent in Neo4j, so
// a cold-chain compromise of the parent reaches it. TelemetryMonitor's
// resolveRootSamples compromises only the breached freezer's own samples, so
// the derivative lives in a second freezer: only the edge can carry the
// compromise to it, and a control sample in that same freezer stays clean.
test.describe('Specimen lineage (#1368) — real backend, compromise through DERIVED_FROM', () => {
  test.setTimeout(90_000);

  const seededBoxes: SeededStorageBox[] = [];
  const seededSensors: SeededFreezerSensor[] = [];
  const createdSamples: Array<{ mongoId: string; specimenId: string }> = [];

  test.afterAll(async () => {
    const mongoIds = createdSamples.map((sample) => sample.mongoId);
    const specimenIds = createdSamples.map((sample) => sample.specimenId);
    const client = new MongoClient(mongoUri);
    try {
      await client.connect();
      const db = client.db(mongoDbName);
      await Promise.all([
        db.collection('samples').deleteMany({ _id: { $in: mongoIds.map((id) => new ObjectId(id)) } }),
        // The birth movement carries the specimenId (sample.service.js's
        // buildBirthMovement); a quarantine movement carries sampleID.
        db.collection('sample_movements').deleteMany({
          $or: [
            { specimenId: { $in: [...specimenIds, ...mongoIds] } },
            { sampleID: { $in: [...specimenIds, ...mongoIds] } },
          ],
        }),
        db.collection('storageAssignments').deleteMany({ specimenId: { $in: mongoIds } }),
        // Every Sample event (SPECIMEN_UPSERTED, LINEAGE_REGISTERED,
        // CUSTODY_EVENT_RECORDED, SPECIMEN_COMPROMISED) is keyed by the _id.
        db.collection('graph_projection_outbox').deleteMany({ aggregateType: 'Sample', aggregateId: { $in: mongoIds } }),
        db.collection<{ _id: string }>('graph_projection_outbox_aggregate_versions').deleteMany({
          _id: { $in: mongoIds.map((id) => `Sample:${id}`) },
        }),
      ]);
    } finally {
      await client.close();
    }
    await removeSampleNodes(mongoIds);
    await Promise.all(seededSensors.map((sensor) => removeSensorOnFreezer(sensor).catch(() => {})));
    await Promise.all(seededBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await closeSeedSensorDb();
    await closeSeedDb();
    await closeNeo4jDriver();
    await closeOutboxDb();
  });

  async function createSample(
    request: import('@playwright/test').APIRequestContext,
    token: string,
    participantId: string,
    box: SeededStorageBox,
    extra: Record<string, unknown> = {}
  ) {
    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: '#1368 specimen-lineage e2e fixture',
        registeredAt: new Date().toISOString(),
        boxId: box.boxId,
        positionCode: box.positionCode,
        ...extra,
      },
    });
    expect([201, 202]).toContain(create.status());
    const specimenId = String((await create.json()).data.specimenId);
    const read = await request.get(`${apiBaseURL}/api/samples/${specimenId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(read.status()).toBe(200);
    const sample = { mongoId: String((await read.json()).data._id), specimenId };
    createdSamples.push(sample);
    return sample;
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

  test('a breach in the parent\'s freezer marks the parent and its API-registered derivative COMPROMISED, and not a sample beside the derivative', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const parentFreezer = await seedStorageBoxLocation();
    seededBoxes.push(parentFreezer);
    const derivativeFreezer = await seedStorageBoxLocation();
    seededBoxes.push(derivativeFreezer);

    const parent = await createSample(request, admin.token, participant.participantId, parentFreezer);
    const derivative = await createSample(request, admin.token, participant.participantId, derivativeFreezer, {
      parentSpecimenIds: [parent.specimenId],
    });

    const client = new MongoClient(mongoUri);
    try {
      await client.connect();
      const stored = await client.db(mongoDbName).collection('samples').findOne({ _id: new ObjectId(derivative.mongoId) });
      expect(stored?.parentSpecimenIds).toEqual([parent.specimenId]);
    } finally {
      await client.close();
    }

    // The control sits beside the derivative, in the same box one position
    // over (the seeded box is 8x12), and has no parent: only DERIVED_FROM
    // separates the two.
    const control = await createSample(request, admin.token, participant.participantId, derivativeFreezer, {
      positionCode: 'A2',
    });

    await waitForDerivedFrom(derivative.mongoId, parent.mongoId);

    const sensor = await seedSensorOnFreezer(parentFreezer.freezerId, 2, 8);
    seededSensors.push(sensor);

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
      // 2 minutes: shorter than the ~3-minute streak just written — the
      // same overrides as interop-monitoring.spec.ts's #304 case.
      criticalDurationHours: 2 / 60,
      expectedReadingIntervalMinutes: 5,
    });

    await expect
      .poll(async () => readSampleStatus(parent.mongoId), { timeout: 15_000 })
      .toBe('COMPROMISED');
    await expect
      .poll(async () => readSampleStatus(derivative.mongoId), { timeout: 15_000 })
      .toBe('COMPROMISED');
    expect(await readSampleStatus(control.mongoId)).not.toBe('COMPROMISED');
  });

  // #1502 (RF023 AC6, RNF016 C2, RNF019 C6 C7): the reconciliation runs
  // through its test-support route, scoped to this spec's own sample, since
  // the runner has no command line into the backend.
  async function reconcile(request: import('@playwright/test').APIRequestContext, specimenId: string, repair: boolean) {
    const response = await request.post(`${apiBaseURL}/api/_test-support/graph-projection/reconcile`, {
      headers: { 'x-test-support-secret': process.env.TEST_SUPPORT_SECRET ?? '' },
      data: { specimenIds: [specimenId], repair },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data as { samplesMissingFromGraph: Array<{ specimenId: string }>; reappended: number };
  }

  test('a deleted Sample node is reported missing, and the reconciliation\'s repair replays it from the outbox (RF023 AC6, RNF016 C2, RNF019 C6 C7)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const box = await seedStorageBoxLocation();
    seededBoxes.push(box);
    const sample = await createSample(request, admin.token, participant.participantId, box);

    // The projector created the node, and has applied every event of the
    // sample: each Sample projection MERGEs the node, so one still queued
    // would re-create it after the delete below.
    await expect.poll(() => countSampleNodes(sample.mongoId), { timeout: 15_000 }).toBe(1);
    await expect
      .poll(async () => {
        const events = await sampleOutboxEvents(sample.mongoId);
        return events.length > 0 && events.every((event) => event.status === 'PROJECTED');
      }, { timeout: 15_000 })
      .toBe(true);

    await removeSampleNodes([sample.mongoId]);
    expect(await countSampleNodes(sample.mongoId)).toBe(0);

    const report = await reconcile(request, sample.mongoId, false);
    expect(report.samplesMissingFromGraph.map((missing) => missing.specimenId)).toEqual([sample.mongoId]);
    expect(report.reappended).toBe(0);
    expect(await countSampleNodes(sample.mongoId)).toBe(0);

    const repaired = await reconcile(request, sample.mongoId, true);
    expect(repaired.reappended).toBe(1);
    await expect.poll(() => countSampleNodes(sample.mongoId), { timeout: 15_000 }).toBe(1);

    const after = await reconcile(request, sample.mongoId, false);
    expect(after.samplesMissingFromGraph).toEqual([]);
  });
});
