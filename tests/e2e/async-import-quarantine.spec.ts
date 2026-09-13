import { test, expect } from '@playwright/test';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { realLogin } from './helpers/realAuth';

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
const BAD_SAMPLES_CSV = [
  'participantId,sampleType,sampleOrigin,extractionProtocol,barcode',
  '81300001,,Coleta,DNA,E2E-813-A',
  '81300002,,Coleta,DNA,E2E-813-B',
].join('\n');

let client: MongoClient | null = null;
let db: Db;
const createdBatchIds: ObjectId[] = [];

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
  });

  test.afterAll(async () => {
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
          buffer: Buffer.from(BAD_SAMPLES_CSV, 'utf8'),
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

    // The whole point of the issue: the row itself is there, and it is the
    // row from the file -- not a line number, not an error message.
    const first = records[0];
    expect(first.status).toBe('ERROR');
    expect(first.errors.length).toBeGreaterThan(0);
    expect(first.row).toBeTruthy();
    expect(typeof first.row).toBe('object');
    expect(first.row.participantId).toBe('81300001');
    expect(first.row.barcode).toBe('E2E-813-A');
    // rowNumber is still recorded, alongside the data rather than instead of it.
    expect(first.rowNumber).toBe(2);
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
});
