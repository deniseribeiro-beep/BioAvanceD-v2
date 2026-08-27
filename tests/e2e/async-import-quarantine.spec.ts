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
// *** CURRENTLY RED, AND DELIBERATELY SO -- BLOCKED ON #826. ***
//
// The quarantine code this exercises is unit-proven (the '#813 quarantine of
// rejected rows' block in batch-validation-engine.service.test.js, 24/24,
// written red-first including the wiring test). What fails here is upstream
// of it: the worker process has no Mongoose connection, so the very first
// StagingImport write buffers and times out after 10s, the job fails, retries
// forever, and never reaches the per-row loop at all. Confirmed 2026-08-27 by
// the worker log ("Operation `stagingImports.updateOne()` buffering timed out")
// and by the job document sitting at status 'queued' with processedRows 0.
//
// Do NOT weaken these assertions or skip the spec to get a green run -- the
// failure is the proof of #826, the same way tcle-dinamico.spec.ts's RF010
// AC#2 test is left red as the proof of its own gap. Once #826 lands, this
// should pass unchanged; if it does not, that is a real #813 regression.
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
