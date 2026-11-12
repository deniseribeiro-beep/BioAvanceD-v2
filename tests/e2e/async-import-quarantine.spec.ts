import { test, expect } from '@playwright/test';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { realLogin } from './helpers/realAuth';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';

// #813 (RNF011 AC#4 / RF029 AC#6): proof against the real stack that the
// importer an operator can actually reach now quarantines its rejected rows.
//
// /import renders ImportForm -> POST /api/import/batch -> a `batch-import`
// job -> batchValidationEngine.processBatchImport. That path classified rows
// VALID/PARTIAL/INVALID and recorded `{row: <line number>, errors}` on the
// StagingImport document -- error messages only. The rejected row's data was
// never persisted, so once the job aged out there was nothing to correct and
// resubmit, and while it existed there was still no row to correct.
//
// This spec drives the real HTTP endpoint with a real file and then reads
// Mongo directly, because the observable that matters is the persisted
// quarantine, not the API's own response.
//
// *** GREEN as of 2026-08-29. Was deliberately red on two upstream blockers. ***
//
// The quarantine code this exercises was always unit-proven (the '#813
// quarantine of rejected rows' block in batch-validation-engine.service.test.js,
// 24/24, written red-first including the wiring test). What failed was upstream
// of it, twice over:
//
//   1. #826 -- the worker process had no Mongoose connection, so the first
//      StagingImport read/write buffered and timed out after 10s. FIXED
//      (8c707744).
//   2. #828 -- the upload was handed from the API process to the worker as a
//      filesystem *path*, but they are separate containers and neither declared
//      any volumes, so the worker's fs.existsSync(storagePath) failed and the
//      job died at batch-validation-engine.service.js:932 with "Arquivo bruto
//      do staging nao encontrado". FIXED (9ce27678): compose.test.yml now
//      mounts one named volume at /app/uploads on both backend-app-test and
//      worker-test.
//
// Both halves of this spec passed in the 2026-08-29 full gate (219 passed / 1
// skipped / 0 failed, --workers=1, fresh volumes, full 17-service bootstrap).
//
// Do NOT weaken these assertions. They are now the regression proof for #828's
// volume as well as for #813's quarantine -- if the volume is ever removed (and
// it should be, once the bytes are stored via the storageType discriminator
// rather than a shared filesystem), this is what will catch a path-based
// handoff silently returning.
//
// Note for whoever lands #828: the poll below declares a 60s timeout but the
// Playwright test timeout is 30s, so it can never use its stated budget --
// the failure reads "Test timeout of 30000ms exceeded". Worth raising the
// test timeout rather than trusting the poll's number.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

// Sample-shaped headers so detectDataType resolves 'samples'. Every row is
// deliberately invalid: this spec is about what happens to rejected rows, and
// a row that succeeds would need the whole storage hierarchy seeded.
// #1497 (RF004 AC2): each row names a governed collection, so a row is
// rejected for its own invalid value and never for a missing collection.
const badSamplesCsv = (collectionId: string) => [
  'participantId,sampleType,sampleOrigin,extractionProtocol,barcode,collectionId',
  `81300001,,Coleta,DNA,E2E-813-A,${collectionId}`,
  `81300002,,Coleta,DNA,E2E-813-B,${collectionId}`,
].join('\n');

let client: MongoClient | null = null;
let db: Db;
const createdBatchIds: ObjectId[] = [];
let governed: GovernedCollection | null = null;

test.describe('RF029 AC#6 / RNF011 AC#4 -- the async importer quarantines rejected rows', () => {
  // #828: the poll below budgets 60s, but Playwright's default test timeout is
  // 30s, so the poll could never spend its stated budget and the failure always
  // read "Test timeout of 30000ms exceeded" rather than a poll timeout. The
  // batch path is API -> BullMQ -> worker -> Mongo, so 60s is the realistic
  // figure; this makes the declared budget the effective one.
  //
  // NOT a weakening: no assertion changes, and a genuinely broken import still
  // fails -- it just now fails with the poll's own diagnostic instead of an
  // unrelated harness timeout.
  test.setTimeout(90_000);
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  test.beforeAll(async () => {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(mongoDbName);
    governed = await seedGovernedCollection(`813-${Date.now()}`);
  });

  test.afterAll(async () => {
    await cleanupGovernedCollection(governed);
    governed = null;
    await closeGovernedCollectionDb();
    if (!client) return;
    for (const batchId of createdBatchIds) {
      await db.collection('import_staging_records').deleteMany({ batchId });
      await db.collection('import_batches').deleteOne({ _id: batchId });
    }
    await client.close();
    client = null;
  });

  test('a rejected row is persisted with its original data, not just its line number', async ({ request }) => {
    const admin = await realLogin(request);

    const upload = await request.post(`${apiBaseURL}/api/import/batch`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        file: {
          name: 'amostras-813.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(badSamplesCsv(governed!.collectionId), 'utf8'),
        },
      },
    });

    expect(upload.status()).toBe(202);
    const jobId = (await upload.json())?.data?.jobId;
    expect(jobId).toBeTruthy();

    // The worker picks the job off the queue asynchronously; poll Mongo for
    // the quarantine batch rather than guessing at a sleep.
    let batch: any = null;
    await expect
      .poll(
        async () => {
          batch = await db.collection('import_batches').findOne({
            type: 'ASYNC_BATCH_IMPORT',
            jobId: String(jobId),
          });
          return batch ? 'found' : 'pending';
        },
        { timeout: 60_000, intervals: [1_000] }
      )
      .toBe('found');

    createdBatchIds.push(batch._id);

    expect(batch.status).toBe('QUARANTINED');
    expect(batch.source).toBe('ASYNC_BATCH');
    expect(batch.dataType).toBe('samples');
    expect(batch.counts.errors).toBeGreaterThan(0);

    const records = await db
      .collection('import_staging_records')
      .find({ batchId: batch._id })
      .sort({ rowNumber: 1 })
      .toArray();

    expect(records.length).toBe(batch.counts.errors);

    // #807: at rest the row is sealed -- no value from the file in the stored
    // document, one envelope, and the rejection reasons still readable.
    const first = records[0];
    expect(first.status).toBe('ERROR');
    expect(first.errors.length).toBeGreaterThan(0);
    expect(first.row ?? null).toBeNull();
    expect(first.sealedPayload).toMatchObject({ alg: 'aes-256-gcm' });
    expect(JSON.stringify(records)).not.toContain('E2E-813-A');
    // rowNumber is still recorded, alongside the data rather than instead of it.
    expect(first.rowNumber).toBe(2);

    // The whole point of the issue: the row itself is kept, and it is the row
    // from the file -- read back through the reader that decrypts it.
    const read = await request.get(`${apiBaseURL}/api/import/batch/quarantine/${batch._id}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(read.status()).toBe(200);
    const { records: readRecords } = await read.json();
    expect(readRecords[0].row).toMatchObject({ participantId: '81300001', barcode: 'E2E-813-A' });
  });

  // #799 in the other direction: import_batches is shared with the LGPD and
  // FHIR importers, whose readers filter on `type`. A batch from this
  // importer must not be picked up by the LGPD quarantine listing.
  test('the quarantine batch is discriminated by type, not mixed into the LGPD listing', async () => {
    const batch = await db.collection('import_batches').findOne({
      _id: createdBatchIds[createdBatchIds.length - 1],
    });

    expect(batch?.type).toBe('ASYNC_BATCH_IMPORT');

    const lgpdListing = await db
      .collection('import_batches')
      .find({ type: 'LGPD_SAMPLE_CSV' })
      .toArray();

    expect(lgpdListing.map((b) => String(b._id))).not.toContain(String(batch?._id));
  });

  // #813's patients half, unblocked by #807: a rejected patient row is
  // quarantined too, and its civil values are sealed at rest the way
  // participantIdentities stores them.
  test('a rejected patient row is quarantined with its civil values sealed at rest', async ({ request }) => {
    const admin = await realLogin(request);
    const name = `E2E Paciente 813 ${Date.now()}`;
    const csv = ['patientName,birthDate,email', `${name},not-a-date,e2e-813@example.com`].join('\n');

    const upload = await request.post(`${apiBaseURL}/api/import/batch`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      multipart: {
        file: { name: 'pacientes-813.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') },
      },
    });
    expect(upload.status()).toBe(202);
    const jobId = (await upload.json())?.data?.jobId;
    expect(jobId).toBeTruthy();

    let batch: any = null;
    await expect
      .poll(
        async () => {
          batch = await db.collection('import_batches').findOne({ type: 'ASYNC_BATCH_IMPORT', jobId: String(jobId) });
          return batch ? 'found' : 'pending';
        },
        { timeout: 60_000, intervals: [1_000] }
      )
      .toBe('found');
    createdBatchIds.push(batch._id);

    expect(batch.dataType).toBe('patients');
    expect(batch.counts.errors).toBe(1);

    const records = await db.collection('import_staging_records').find({ batchId: batch._id }).toArray();
    expect(records).toHaveLength(1);
    expect(records[0].sealedPayload).toMatchObject({ alg: 'aes-256-gcm' });
    const atRest = JSON.stringify(records);
    expect(atRest).not.toContain(name);
    expect(atRest).not.toContain('e2e-813@example.com');

    const read = await request.get(`${apiBaseURL}/api/import/batch/quarantine/${batch._id}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(read.status()).toBe(200);
    const { records: readRecords } = await read.json();
    expect(readRecords[0].row).toMatchObject({ patientName: name, email: 'e2e-813@example.com' });
  });
});
