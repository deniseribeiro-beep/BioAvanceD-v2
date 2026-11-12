import { test, expect } from '@playwright/test';
import { MongoClient, Db } from 'mongodb';
import { realLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  seedActiveConsent,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { bindSensor, unbindSensor, closeSeedSensorDb } from './helpers/seedSensor';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';

// The happy path of the two async importers, against the real stack: a valid
// row goes through the queue and the worker and is persisted.
//
// async-import-quarantine.spec.ts imports only rejected rows, so neither
// importer had a test that a GOOD row lands. Both had broken writers that no
// test saw, because their unit tests mock the persistence call:
//
//   - POST /api/import/batch (#1335): participantId, then boxId and
//     positionCode, were dropped by buildSampleRow's header map, so
//     createSample refused every sample row; and a file's own specimen id
//     column was dropped too, instead of landing in sourceRecordId.
//   - POST /api/import/import with dataType=results (#1327, #889 Part B):
//     the result worker looked samples up in 'amostras', a collection
//     nothing writes, so no result row was ever written and no importJobID
//     with it. results-import-job-view.spec.ts writes importJobID in its own
//     fixture, so it pins the reader only.
//
// Each test reads Mongo directly, because what matters is the persisted
// document, not the API's own response.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

let client: MongoClient | null = null;
let db: Db;
const seededBoxes: SeededStorageBox[] = [];
const createdImportJobIds: string[] = [];
const createdBatchJobIds: string[] = [];
const boundSensorIds: string[] = [];
// #1497 (RF004 AC2): every specimen these importers create enters a governed collection.
let governed: GovernedCollection | null = null;

test.describe('Async importers persist a valid row (RF029) -- real backend', () => {
  // API -> BullMQ -> worker -> Mongo; async-import-quarantine.spec.ts gives
  // the same path 60 s to poll in, inside a 90 s test.
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    db = client.db(mongoDbName);
    governed = await seedGovernedCollection(`async-import-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    if (client) {
      for (const jobID of createdImportJobIds) {
        await db.collection('results').deleteMany({ importJobID: jobID });
        await db.collection('importJobs').deleteOne({ jobID });
      }
      for (const jobId of createdBatchJobIds) {
        await db.collection('stagingImports').deleteOne({ jobId });
      }
      // The InfluxDB point stays: no e2e spec deletes points.
      await client.close();
      client = null;
    }
    await Promise.all(seededBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await closeSeedDb();
    for (const sensorId of boundSensorIds) {
      await unbindSensor(sensorId);
    }
    await closeSeedSensorDb();
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
  });

  test('POST /api/import/batch persists a valid sample row, keeping the file\'s id in sourceRecordId (#1335)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const box = await seedStorageBoxLocation();
    seededBoxes.push(box);

    const sourceRecordId = `LIMS-1335-${Date.now()}`;
    const csv = [
      'specimenId,participantId,sampleType,sampleOrigin,extractionProtocol,quantity,boxId,positionCode,linkedProject,collectionId',
      `${sourceRecordId},${participant.participantId},PLASMA,VENOUS_BLOOD,TUBE_EDTA,5,${box.boxId},${box.positionCode},RF029 async import e2e,${governed!.collectionId}`,
    ].join('\n');

    const upload = await request.post(`${apiBaseURL}/api/import/batch`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        file: { name: 'amostras-1335.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') },
      },
    });
    expect(upload.status()).toBe(202);
    const jobId = (await upload.json())?.data?.jobId;
    expect(jobId).toBeTruthy();
    createdBatchJobIds.push(String(jobId));

    let status: any = null;
    await expect
      .poll(
        async () => {
          const res = await request.get(`${apiBaseURL}/api/import/batch/${jobId}`, {
            headers: { Authorization: `Bearer ${admin.token}` },
          });
          status = (await res.json())?.data;
          return status?.status;
        },
        { timeout: 60_000, intervals: [1_000] }
      )
      .toMatch(/^(COMPLETED|FAILED)$/);

    // The job's own errors name the refusal when a row did not persist.
    expect(status.errors, JSON.stringify(status.errors)).toEqual([]);
    expect(status.status).toBe('COMPLETED');

    const sample = await db.collection('samples').findOne({ sourceRecordId });
    expect(sample, 'no sample carries the file\'s specimen id as sourceRecordId').not.toBeNull();
    expect(sample!.participantId).toBe(participant.participantId);
    expect(sample!.sampleType).toBe('PLASMA');
    // specimenId stays the system's own id, generated by createSample.
    expect(sample!.specimenId).toBeTruthy();
    expect(sample!.specimenId).not.toBe(sourceRecordId);
  });

  test('a results import through the async importer tags each result with its job\'s importJobID (#1327)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const box = await seedStorageBoxLocation();
    seededBoxes.push(box);

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: 'RF029 results import e2e',
        registeredAt: new Date().toISOString(),
        boxId: box.boxId,
        positionCode: box.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202]).toContain(create.status());
    const specimenId = (await create.json()).data.specimenId;
    expect(specimenId).toBeTruthy();

    const testCode = `E2E-1327-${Date.now()}`;
    const csv = ['specimenId,testName,testCode,resultValue', `${specimenId},Hemoglobina,${testCode},13.5`].join('\n');

    const upload = await request.post(`${apiBaseURL}/api/import/import`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        dataType: 'results',
        file: { name: 'resultados-1327.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') },
      },
    });
    expect(upload.status(), await upload.text()).toBe(202);
    const jobID = (await upload.json())?.data?.jobID;
    expect(jobID).toBeTruthy();
    createdImportJobIds.push(String(jobID));

    let job: any = null;
    await expect
      .poll(
        async () => {
          job = await db.collection('importJobs').findOne({ jobID: String(jobID) });
          return job?.status;
        },
        { timeout: 60_000, intervals: [1_000] }
      )
      .toMatch(/^(completed|completed_no_data|failed)$/);
    expect(job.status, JSON.stringify(job.result ?? job.error ?? null)).toBe('completed');

    // The writer: the row the worker wrote carries this job's id.
    const written = await db.collection('results').find({ importJobID: String(jobID) }).toArray();
    expect(written).toHaveLength(1);
    expect(written[0].specimenId).toBe(specimenId);
    expect(written[0].testCode).toBe(testCode);

    // And the reader the Results page's "Ver" button calls finds it by that id.
    const read = await request.get(`${apiBaseURL}/api/results?importJobID=${encodeURIComponent(String(jobID))}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(read.status()).toBe(200);
    const body = await read.json();
    expect(body.data.map((r: any) => r.testCode)).toEqual([testCode]);
  });

  // #1317 (RF009 AC1): the temperature history reads InfluxDB, and the
  // temperature import wrote Mongo only, so before this the history answered
  // total: 0 for an imported sensor.
  test('POST /api/import/import with dataType=temperature writes the reading to InfluxDB, so the temperature history shows it (#1317, RF009 AC1)', async ({ request }) => {
    const admin = await realLogin(request);
    const sensorId = `rf009-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await bindSensor(sensorId);
    boundSensorIds.push(sensorId);
    const csv = `sensorId,temperatureValue,temperatureUnit,timestamp\n${sensorId},-20,°C,${new Date().toISOString()}`;

    const upload = await request.post(`${apiBaseURL}/api/import/import`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        dataType: 'temperature',
        file: { name: 'temperaturas-1317.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') },
      },
    });
    expect(upload.status(), await upload.text()).toBe(202);
    const jobID = (await upload.json())?.data?.jobID;
    expect(jobID).toBeTruthy();
    createdImportJobIds.push(String(jobID));

    let job: any = null;
    await expect
      .poll(
        async () => {
          job = await db.collection('importJobs').findOne({ jobID: String(jobID) });
          return job?.status;
        },
        { timeout: 60_000, intervals: [1_000] }
      )
      .toMatch(/^(completed|completed_no_data|failed)$/);
    expect(job.status, JSON.stringify(job.result ?? job.error ?? null)).toBe('completed');

    const history = await request.get(`${apiBaseURL}/api/temperature/history?sensorId=${encodeURIComponent(sensorId)}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(history.status(), await history.text()).toBe(200);
    const page = (await history.json()).data;
    expect(page.total).toBe(1);
    expect(page.temperatures[0]).toMatchObject({ sensorId, temperatureValue: -20, temperatureUnit: '°C' });
    // #1391: InfluxDB is the reading's only store.
    expect(await db.collection('temperatures').countDocuments({ sensorId })).toBe(0);
  });
});
