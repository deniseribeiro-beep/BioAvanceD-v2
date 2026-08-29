import { test, expect } from '@playwright/test';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import { realLogin, seedRealAuth } from './helpers/realAuth';

// #889 Part A -- Results page import-job filter.
//
// ResultsPage.tsx renders a "Ver" button per completed import job
// (~line 179) that sets `importJobID` on the query string; useResults()
// reads that param and calls GET /api/results?importJobID=<id>, which
// result.routes.js's GET / handler (~lines 73-74) narrows on only when the
// query param is present. This spec pins that reader + the button's wiring
// of job.jobID into the query string.
//
// *** SCOPE CAVEAT -- READ BEFORE TRUSTING THIS AS FULL COVERAGE ***
// This spec deliberately does NOT drive a real results import. Doing so is
// impossible on the current test stack: the API and worker containers share
// no upload volume (#828), so a real upload job never reaches `completed`
// here. Instead, the fixture below seeds an `importJobs` document and its
// `results` documents directly into Mongo, writing `importJobID` onto the
// result docs itself -- mirroring the field shape result-worker.js's
// processResultRow builds (~lines 258-277), including its #861 fix (the
// field is omitted entirely, not written as null/undefined, when there is
// no job id).
//
// Because the fixture writes `importJobID` itself, this spec would NOT have
// caught #861, the defect that motivated it: no writer set importJobID at
// all, so the query returned [] unconditionally for every job. (The
// `if (jobID)` guard above is a safeguard added alongside that fix, not
// the defect itself.) It pins the
// reader and the button, not the writer. Do not overstate what it covers.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

let client: MongoClient | null = null;
let db: Db;
const createdImportJobIds: ObjectId[] = [];
const createdResultIds: ObjectId[] = [];

test.describe('Results page import-job filter (#889 Part A)', () => {
  test.beforeAll(async () => {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(mongoDbName);
  });

  test.afterAll(async () => {
    if (!client) return;
    await db.collection('importJobs').deleteMany({ _id: { $in: createdImportJobIds } });
    await db.collection('results').deleteMany({ _id: { $in: createdResultIds } });
    await client.close();
    client = null;
  });

  test('GET /api/results?importJobID narrows to the tagged rows, and the Ver button binds job.jobID into the URL', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);
    await seedRealAuth(page, admin);

    const suffix = Date.now();
    const jobID = `e2e-889-${randomUUID()}`;
    const unusedJobID = `e2e-889-unused-${randomUUID()}`;
    const specimenIdA = `E2E-889-SPEC-A-${suffix}`;
    const specimenIdB = `E2E-889-SPEC-B-${suffix}`;
    const specimenIdControl = `E2E-889-SPEC-CTRL-${suffix}`;
    const fileName = `e2e-889-results-${suffix}.csv`;

    // --- seed: one completed 'results' importJobs doc ---
    // #889: GET /api/import/jobs (the endpoint ResultsPage.tsx's
    // loadImportJobs() calls) filters on `userID` (import-async.controller.js
    // listJobs) -- without this the job list stays empty for the logged-in
    // admin and the "Ver" button never renders, no matter how status/dataType
    // are seeded. Not called out in result.routes.js/result-worker.js/
    // ResultsPage.tsx, but load-bearing for assertion 4.
    const importJobDoc = {
      jobID,
      userID: admin.user._id,
      userName: admin.user.name,
      dataType: 'results',
      fileName,
      filePath: `/tmp/${fileName}`,
      fileSize: 128,
      fileFormat: 'CSV',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const jobInsert = await db.collection('importJobs').insertOne(importJobDoc);
    createdImportJobIds.push(jobInsert.insertedId);

    // --- seed: two results tagged with importJobID, mirroring
    // result-worker.js's processResultRow-built document shape ---
    const buildResultDoc = (specimenId: string, tagJobID?: string) => {
      const doc: Record<string, unknown> = {
        specimenId,
        testName: 'E2E 889 Test',
        testCode: 'E2E889',
        resultValue: '1.0',
        testDate: new Date(),
        filePath: null,
        fileType: 'CSV',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // #861: an absent jobID must not write a junk importJobID field --
      // mirrored here for the control doc by simply not calling this with one.
      if (tagJobID) {
        doc.importJobID = tagJobID;
      }
      return doc;
    };

    const taggedInsert = await db.collection('results').insertMany([
      buildResultDoc(specimenIdA, jobID),
      buildResultDoc(specimenIdB, jobID),
    ]);
    createdResultIds.push(...Object.values(taggedInsert.insertedIds));

    // Control row: no importJobID at all -- proves the unfiltered listing
    // isn't just coincidentally small.
    const controlInsert = await db.collection('results').insertOne(buildResultDoc(specimenIdControl));
    createdResultIds.push(controlInsert.insertedId);

    const authHeaders = { Authorization: `Bearer ${admin.token}` };

    // --- Assertion 1: filtered by the seeded jobID returns exactly the two tagged rows ---
    const filtered = await request.get(`${apiBaseURL}/api/results?importJobID=${encodeURIComponent(jobID)}`, {
      headers: authHeaders,
    });
    expect(filtered.status()).toBe(200);
    const filteredBody = await filtered.json();
    expect(filteredBody.success).toBe(true);
    const filteredSpecimenIds = filteredBody.data.map((r: any) => r.specimenId);
    expect(filteredSpecimenIds.sort()).toEqual([specimenIdA, specimenIdB].sort());
    for (const row of filteredBody.data) {
      expect(row.importJobID).toBe(jobID);
    }

    // --- Assertion 2: unfiltered listing also returns the control row ---
    // (proves the filter above narrows, rather than the collection merely
    // being small enough that any query returns everything).
    const unfiltered = await request.get(`${apiBaseURL}/api/results`, { headers: authHeaders });
    expect(unfiltered.status()).toBe(200);
    const unfilteredBody = await unfiltered.json();
    const unfilteredSpecimenIds = unfilteredBody.data.map((r: any) => r.specimenId);
    expect(unfilteredSpecimenIds).toContain(specimenIdControl);
    expect(unfilteredSpecimenIds).toContain(specimenIdA);
    expect(unfilteredSpecimenIds).toContain(specimenIdB);

    // --- Assertion 3: a different, never-used jobID is a real negative, not the default ---
    const emptyFiltered = await request.get(
      `${apiBaseURL}/api/results?importJobID=${encodeURIComponent(unusedJobID)}`,
      { headers: authHeaders }
    );
    expect(emptyFiltered.status()).toBe(200);
    const emptyFilteredBody = await emptyFiltered.json();
    expect(emptyFilteredBody.data).toEqual([]);

    // --- Assertion 4: the UI's "Ver" button binds job.jobID into the query string ---
    await page.goto('/results');

    const jobItem = page.locator('.job-item', { hasText: fileName });
    await expect(jobItem).toBeVisible();
    await jobItem.getByRole('button', { name: /ver/i }).click();

    await expect(page).toHaveURL(new RegExp(`importJobID=${jobID}`));

    const tableRows = page.locator('.results-table-card table tbody tr');
    await expect(tableRows).toHaveCount(2);
    await expect(page.getByText(specimenIdA, { exact: false })).toBeVisible();
    await expect(page.getByText(specimenIdB, { exact: false })).toBeVisible();
    await expect(page.getByText(specimenIdControl, { exact: false })).not.toBeVisible();
  });
});
