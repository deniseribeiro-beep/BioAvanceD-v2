import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import { deleteOrganizations } from './helpers/listOrganizations';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';
import { findLgpdQuarantineBatch, findLgpdQuarantinedRows, closeFhirImportDb, seedForeignImportBatch, removeForeignImportBatch } from './helpers/queryFhirImport';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';

// Real backend only — see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack (or a locally running backend), never the mocked suite.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

// #759: nothing exercised ImportLGPDService.importSamples against a live
// backend. #702 was a reference-data lookup that queried
// `{ description: <miabis id> }` against documents whose `description`
// holds the human label — so it missed for *every* valid MIABIS id and
// rejected 100% of rows, and survived because the unit tests stubbed the
// three reference collections behind a `findOne` that ignored its filter.
//
// The ids below are deliberately the real seeded ones
// (`foundation-bootstrap-test` / `seed:essential`), matched on `id`, which
// is what makes this spec able to see that class of bug at all.
const SAMPLE_TYPE = 'PLASMA';
const SAMPLE_ORIGIN = 'VENOUS_BLOOD';
const EXTRACTION_PROTOCOL = 'TUBE_EDTA';

const CSV_HEADER = 'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject,collectionId';

// #1538 (RF004 AC2, ELM-0118 Specimen.collectionId 1..1): the governed
// collection every row of both describes enters; a row naming none is
// refused like any other invalid row.
let governed: GovernedCollection | null = null;

test.beforeAll(async () => {
  governed = await seedGovernedCollection(`lgpd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
});

test.afterAll(async () => {
  await cleanupGovernedCollection(governed);
  await closeGovernedCollectionDb();
});

function csvBuffer(rows: string[]): Buffer {
  return Buffer.from([CSV_HEADER, ...rows].join('\n'), 'utf8');
}

function importSamples(request: APIRequestContext, token: string, rows: string[]) {
  return request.post(`${apiBaseURL}/api/import-lgpd/amostras`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'amostras.csv',
        mimeType: 'text/csv',
        buffer: csvBuffer(rows),
      },
    },
  });
}

test.describe('LGPD sample import against the real backend (#759)', () => {
  test.afterAll(async () => {
    await closeSeedDb();
    // #787: the quarantine assertions open a second Mongo client via
    // queryFhirImport.ts -- close it too or the run hangs on an open handle.
    await closeFhirImportDb();
  });

  test('imports a row with valid MIABIS ids, and the sample is queryable afterwards', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await importSamples(request, admin.token, [
      `${participant.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,${governed!.collectionId}`,
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();

    // #702 returned a perfectly well-formed 200 with every row sitting in
    // `errorsDetails`, so asserting the status code alone would have passed
    // straight through the bug. Assert the rejections first: on a failure
    // this prints *why* each row was refused instead of a bare count
    // mismatch.
    expect(body.data.errorsDetails).toEqual([]);
    expect(body.data).toMatchObject({ total: 1, success: 1, errors: 0 });
    expect(body.success).toBe(true);

    // A 200 with success: 1 still only proves the import *reported* a
    // success. Read it back through the API to prove it persisted.
    //
    // #785 is fixed: the route now builds the canonical participantId key,
    // so this asserts through the real server-side filter. That makes this
    // block a regression guard for #785 as well as a persistence check --
    // under the bug the filter was dropped and the response was an
    // unfiltered page, which the every-row assertion below would catch.
    const list = await request.get(
      `${apiBaseURL}/api/samples?participantId=${encodeURIComponent(participant.participantId)}&limit=200`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );

    expect(list.status()).toBe(200);
    const listBody = await list.json();
    const samples = (listBody?.data?.samples ?? listBody?.data ?? []) as Array<Record<string, unknown>>;

    // Every row must belong to the requested participant -- this is the
    // assertion the dropped filter would fail.
    expect(samples.length).toBeGreaterThan(0);
    expect(
      samples.map((sample) => String(sample.participantId)),
      'the participantId filter returned samples belonging to someone else'
    ).toEqual(samples.map(() => String(participant.participantId)));

    const imported = samples.find(
      (sample) => String(sample.participantId) === String(participant.participantId)
    );

    expect(
      imported,
      `no sample for participant ${participant.participantId} in ${samples.length} listed samples`
    ).toBeTruthy();
    expect(imported).toMatchObject({
      sampleType: SAMPLE_TYPE,
      sampleOrigin: SAMPLE_ORIGIN,
    });
  });

  test('rejects a row whose sampleType is not in the seeded reference data', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    // The negative case is what proves the validation is live rather than
    // merely permissive — without it, a lookup that accepted anything
    // would pass the test above just as happily as a correct one.
    const response = await importSamples(request, admin.token, [
      `${participant.participantId},NOT_A_REAL_SAMPLE_TYPE,${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,${governed!.collectionId}`,
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();

    // #786 is fixed: the single rejected row is now counted, so a wholly
    // rejected one-row file reports total 1 rather than 0. Under the bug
    // rejected rows left the loop by `continue` and never reached the
    // bottom-of-loop increment.
    expect(body.data).toMatchObject({ total: 1, success: 0, errors: 1 });
    expect(body.success).toBe(false);
    expect(body.data.errorsDetails[0].row).toBe(2);

    // Two layers can reject a sampleType, and this is the *first*:
    // SampleModel.validate against specimen.constants.js's MIABIS vocab,
    // which fires before the seeded-reference-data lookup at
    // import-lgpd.service.js:1011 ever runs. Its message does not echo the
    // offending value, so match the message rather than the input.
    //
    // That means this test does not reach the #702 code path — the
    // positive test above is what covers it, by pushing a valid id all the
    // way through the lookup. To exercise the lookup's own rejection you
    // would need a value present in the constants but absent from the
    // seeded collections, which is a drift state rather than bad input.
    expect(JSON.stringify(body.data.errorsDetails[0].errors)).toMatch(/sampleType/i);
  });

  test('accepts a valid row and rejects an invalid one in the same file', async ({ request }) => {
    const admin = await realLogin(request);
    const good = await createRealParticipant(request, apiBaseURL!, admin.token);
    const bad = await createRealParticipant(request, apiBaseURL!, admin.token);

    // Per-row outcomes, not a whole-file verdict: #702's failure mode was
    // uniform (every row rejected), so a mixed file is what distinguishes
    // "this row is bad" from "the lookup is broken for everything."
    const response = await importSamples(request, admin.token, [
      `${good.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,${governed!.collectionId}`,
      `${bad.participantId},${SAMPLE_TYPE},NOT_A_REAL_ORIGIN,${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,${governed!.collectionId}`,
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();

    // #786 is fixed: a two-row file now reports total 2, and the invariant
    // total === success + errors holds. This is the shape that showed why it
    // mattered -- the same three numbers reach auditLogger.logImport, so a
    // partial import used to be audit-logged with total < rows touched.
    expect(body.data).toMatchObject({ total: 2, success: 1, errors: 1 });
    expect(body.data.success + body.data.errors).toBe(2); // rows actually accounted for
    expect(body.data.errorsDetails).toHaveLength(1);
    expect(body.data.errorsDetails[0].participantId).toBe(String(bad.participantId));
  });

  // #787 (RNF011 AC#4, Crítica): "Importações inválidas são colocadas em
  // staging ou quarentena, sem correção silenciosa."
  //
  // This is the acceptance criterion the FHIR import path already satisfied
  // and this one did not. The proof deliberately does not stop at the
  // response's own stagingBatchId -- that would only show the API claims to
  // have quarantined the row. It reads the batch and the rejected row back
  // out of Mongo, because the whole point of the requirement is that the
  // row outlives the HTTP response.
  test('RNF011 AC#4: a rejected row is quarantined and survives the response', async ({ request }) => {
    const admin = await realLogin(request);
    const good = await createRealParticipant(request, apiBaseURL!, admin.token);
    const bad = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await importSamples(request, admin.token, [
      `${good.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,${governed!.collectionId}`,
      `${bad.participantId},NOT_A_REAL_SAMPLE_TYPE,${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,${governed!.collectionId}`,
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.data.errors).toBe(1);
    const batchId = body.data.stagingBatchId;
    expect(batchId, 'a partially-failed import must report where the rejected rows went').toBeTruthy();

    // The batch, read from Mongo rather than from the response.
    const batch = await findLgpdQuarantineBatch(String(batchId));
    expect(batch, `no import_batches document for ${batchId}`).toBeTruthy();
    expect(batch).toMatchObject({
      type: 'LGPD_SAMPLE_CSV',
      source: 'LGPD',
      status: 'QUARANTINED',
    });
    // Mirrors the FHIR path's own batch shape, which carries counts.
    expect(batch?.counts).toMatchObject({ total: 2, success: 1, errors: 1 });

    // The rejected row itself.
    const quarantined = await findLgpdQuarantinedRows(String(batchId));
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ status: 'ERROR', rowNumber: 3 });
    expect(JSON.stringify(quarantined[0].errors)).toMatch(/sampleType/i);

    // #807: the original values are kept, which is what makes a quarantined
    // row correctable rather than merely auditable -- but sealed at rest,
    // because a rejected LGPD row carries the same identifiers that are
    // encrypted everywhere else. At rest: no plaintext, one envelope. The
    // values themselves are asserted through the batch API in the #794 test
    // below, which is the reader that decrypts them.
    expect(quarantined[0].row ?? null).toBeNull();
    expect(quarantined[0].sealedPayload).toMatchObject({ alg: 'aes-256-gcm' });
    const atRest = JSON.stringify(quarantined[0]);
    expect(atRest).not.toContain('NOT_A_REAL_SAMPLE_TYPE');
    expect(atRest).not.toContain(String(bad.participantId));

    // And the row that imported cleanly is NOT quarantined -- quarantine is
    // for invalid rows, not a copy of the whole file. One staged row, and it
    // is the rejected one (rowNumber 3, the second data line).
    expect(quarantined.map((r) => r.rowNumber), 'a row that imported successfully must not be quarantined').toEqual([3]);
  });

  test('RNF011 AC#4: a clean import leaves no quarantine batch behind', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await importSamples(request, admin.token, [
      `${participant.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,${governed!.collectionId}`,
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.data).toMatchObject({ total: 1, success: 1, errors: 0 });
    // Nothing was rejected, so there is nothing to review -- an empty batch
    // would be noise in whatever queue eventually consumes these.
    expect(body.data.stagingBatchId).toBeNull();
  });

  // #1538 (RF004 AC2, ELM-0118): the import runs the collection gate
  // createSample runs, so a row naming no collection is refused, kept in
  // quarantine (RNF011 AC#4) and stores nothing.
  test('#1538 RF004 AC2: a row that names no collection is rejected and quarantined, and stores no sample', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await importSamples(request, admin.token, [
      `${participant.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,`,
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.data).toMatchObject({ total: 1, success: 0, errors: 1 });
    expect(JSON.stringify(body.data.errorsDetails[0].errors)).toMatch(/collectionId é obrigatório/);

    const batchId = body.data.stagingBatchId;
    expect(batchId, 'a rejected row must report where it was quarantined').toBeTruthy();
    const batch = await findLgpdQuarantineBatch(String(batchId));
    expect(batch, `no import_batches document for ${batchId}`).toBeTruthy();
    expect(batch).toMatchObject({ type: 'LGPD_SAMPLE_CSV', source: 'LGPD', status: 'QUARANTINED' });
    const quarantined = await findLgpdQuarantinedRows(String(batchId));
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ status: 'ERROR', rowNumber: 2 });
    expect(JSON.stringify(quarantined[0].errors)).toMatch(/collectionId é obrigatório/);

    const list = await request.get(
      `${apiBaseURL}/api/samples?participantId=${encodeURIComponent(participant.participantId)}&limit=200`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect(list.status()).toBe(200);
    const listBody = await list.json();
    const samples = (listBody?.data?.samples ?? listBody?.data ?? []) as Array<Record<string, unknown>>;
    expect(samples, 'a row refused by the collection gate must store no sample').toHaveLength(0);
  });

  // #997: the sync import path's blank-row count had NO test anywhere.
  // #980 shipped `data.skipped` on this response and #991 shipped the
  // notice that renders it, both uncovered; ImportLGPDPage.test.tsx asserts
  // the tile three times but against a hand-written mock, so nothing proved
  // the server actually emits the key that mock claims.
  //
  // The fixture is a COMMA-ONLY row, not an appended '' -- deliberately.
  // csvBuffer joins with '\n', so ONE appended '' is only a trailing
  // newline, which produces no parser row and is correctly not counted;
  // TWO would work today but only via newline arithmetic that any future
  // change to csvBuffer would silently break. Eight empty cells matching
  // CSV_HEADER's eight columns fail readCSV's `hasData` check directly,
  // which is the mechanism actually under test.
  //
  // Placed as its own test rather than folded into one above: errorsDetails
  // row numbers are indices into the already-filtered array, so a blank row
  // in the middle of a file shifts them relative to the physical CSV. That
  // is a real product inconsistency (#1023), and keeping it out of
  // the other tests keeps it from silently changing their expectations.
  test('#997: a blank row is reported as data.skipped, outside total/success/errors', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await importSamples(request, admin.token, [
      `${participant.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,${governed!.collectionId}`,
      ','.repeat(7),
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.data.skipped).toBe(1);
    // The load-bearing half: `skipped` is OUTSIDE total/success/errors, so
    // the one real row is still the only row that counted. This fails in
    // both directions -- if blank rows ever start counting as data, and if
    // the count stops flowing to the response.
    expect(body.data).toMatchObject({ total: 1, success: 1, errors: 0 });
    expect(body.data.errorsDetails).toEqual([]);
    // A blank row is not a rejection, so it must not open a quarantine batch.
    expect(body.data.stagingBatchId).toBeNull();
  });

  // #794 slice 1 (RNF011 AC#4, second half): "sem correção silenciosa".
  //
  // #787 made rejected rows survive; it gave nobody a way to look at them.
  // The rows were reachable only by querying Mongo directly -- which is
  // exactly what the test above does, and why that test passing was not
  // enough to call the criterion met. A quarantine nobody can open is a
  // well-organised log, not staging.
  //
  // Mirrors GET /api/import/fhir/batches/:id, the path that already
  // satisfies this for the FHIR importer. Note the mount: LGPD routes live
  // under /api/import-lgpd (app.js:350), NOT /api/import/lgpd -- the latter
  // would land inside the FHIR router.
  test('RNF011 AC#4: a quarantined batch is readable back through the API, not only via Mongo', async ({ request }) => {
    const admin = await realLogin(request);
    const good = await createRealParticipant(request, apiBaseURL!, admin.token);
    const bad = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await importSamples(request, admin.token, [
      `${good.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,${governed!.collectionId}`,
      `${bad.participantId},NOT_A_REAL_SAMPLE_TYPE,${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import,${governed!.collectionId}`,
    ]);
    expect(response.status()).toBe(200);
    const batchId = String((await response.json()).data.stagingBatchId);

    const read = await request.get(`${apiBaseURL}/api/import-lgpd/batches/${batchId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });

    expect(read.status(), 'the quarantine batch must be readable through the API').toBe(200);
    const payload = await read.json();

    expect(payload.success).toBe(true);
    expect(payload.batch).toMatchObject({
      type: 'LGPD_SAMPLE_CSV',
      source: 'LGPD',
      status: 'QUARANTINED',
    });
    expect(payload.batch.counts).toMatchObject({ total: 2, success: 1, errors: 1 });

    // The rejected rows, with enough detail to actually correct them --
    // the error AND the original values, same as the Mongo-side assertions.
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]).toMatchObject({ status: 'ERROR', rowNumber: 3 });
    expect(JSON.stringify(payload.records[0].errors)).toMatch(/sampleType/i);
    expect(String(payload.records[0].row.participantId)).toBe(String(bad.participantId));
    expect(payload.records[0].row.sampleType).toBe('NOT_A_REAL_SAMPLE_TYPE');
  });

  // #1352 (RNF011 AC#4, "sem correção silenciosa"): a quarantined row is
  // corrected and resubmitted through the import's own row path. A
  // correction that is still wrong is refused and recorded; a right one
  // imports the sample, resolves the record and, with nothing left, the
  // batch.
  test('RNF011 AC#4: a quarantined row is corrected and resubmitted, and a still-wrong correction is refused (#1352)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const bad = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await importSamples(request, admin.token, [
      `${bad.participantId},NOT_A_REAL_SAMPLE_TYPE,${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e resubmit,${governed!.collectionId}`,
    ]);
    expect(response.status()).toBe(200);
    const batchId = String((await response.json()).data.stagingBatchId);

    const read = await request.get(`${apiBaseURL}/api/import-lgpd/batches/${batchId}`, { headers: auth });
    expect(read.status()).toBe(200);
    const record = (await read.json()).records[0];
    const resubmitURL = `${apiBaseURL}/api/import-lgpd/batches/${batchId}/records/${record._id}/resubmit`;

    // Still wrong: the same import validator refuses it, and the record keeps
    // the attempt in ERROR rather than dropping it.
    const stillWrong = await request.post(resubmitURL, {
      headers: auth,
      data: { row: { ...record.row, sampleType: 'STILL_NOT_A_SAMPLE_TYPE' } },
    });
    expect(stillWrong.status()).toBe(422);
    const stillWrongBody = await stillWrong.json();
    expect(stillWrongBody.success).toBe(false);
    expect(JSON.stringify(stillWrongBody.errors)).toMatch(/sampleType/i);

    // Corrected: every column the import's header rule requires is in the
    // row (participantId, sampleType, sampleOrigin), carried from the file.
    const corrected = await request.post(resubmitURL, {
      headers: auth,
      data: {
        row: {
          ...record.row,
          participantId: String(bad.participantId),
          sampleType: SAMPLE_TYPE,
          sampleOrigin: SAMPLE_ORIGIN,
        },
      },
    });
    expect(corrected.status(), JSON.stringify(await corrected.json())).toBe(200);
    expect((await corrected.json()).data).toMatchObject({ recordStatus: 'RESUBMITTED', batchStatus: 'RESOLVED' });

    const after = await (await request.get(`${apiBaseURL}/api/import-lgpd/batches/${batchId}`, { headers: auth })).json();
    expect(after.batch).toMatchObject({ status: 'RESOLVED' });
    expect(after.batch.counts).toMatchObject({ success: 1, errors: 0, resubmitted: 1 });
    expect(after.records[0]).toMatchObject({ status: 'RESUBMITTED' });
    expect(after.records[0].resubmitAttempts).toHaveLength(2);

    // The sample exists, through the real server-side participant filter.
    const list = await request.get(
      `${apiBaseURL}/api/samples?participantId=${encodeURIComponent(bad.participantId)}&limit=200`,
      { headers: auth }
    );
    const listBody = await list.json();
    const samples = (listBody?.data?.samples ?? listBody?.data ?? []) as Array<Record<string, unknown>>;
    expect(samples.some((sample) => sample.sampleType === SAMPLE_TYPE)).toBe(true);

    // A second resubmit of a resolved record is refused, so no second sample.
    const again = await request.post(resubmitURL, { headers: auth, data: { row: record.row } });
    expect(again.status()).toBe(409);
  });

  test('an unknown batch id is a 404, and a malformed one does not 500 (#794)', async ({ request }) => {
    const admin = await realLogin(request);

    const missing = await request.get(`${apiBaseURL}/api/import-lgpd/batches/64b7f9c2e4b0a1d2c3e4f5a6`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(missing.status()).toBe(404);
    // Assert the SHAPE, not just the code: before this route existed, Express
    // 404'd unknown paths with an empty body, so a status-only assertion
    // passed vacuously and proved nothing.
    expect(await missing.json()).toMatchObject({ success: false });

    // A non-ObjectId path segment must be a client error, not an unhandled
    // BSON cast blowing up as a 500.
    const malformed = await request.get(`${apiBaseURL}/api/import-lgpd/batches/not-an-object-id`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect([400, 404]).toContain(malformed.status());
    expect(await malformed.json()).toMatchObject({ success: false });
  });

  test('the LGPD batch route refuses a FHIR batch id, mirroring #799 (#794)', async ({ request }) => {
    const admin = await realLogin(request);

    // A batch of the other type must 404 here rather than being served by
    // whichever reader happens to be asked. #799 tracks the same leak in the
    // opposite direction, which this route deliberately does not reproduce.
    const fhirBatchId = await seedForeignImportBatch();

    try {
      const read = await request.get(`${apiBaseURL}/api/import-lgpd/batches/${fhirBatchId}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });

      expect(read.status(), 'a FHIR batch must not be readable through the LGPD route').toBe(404);
      expect(await read.json()).toMatchObject({ success: false });
    } finally {
      // This fixture is not created by any import, so nothing else will clean
      // it up -- the named volumes persist across sessions.
      await removeForeignImportBatch(fhirBatchId);
    }
  });
});

// #1353: the import stamps the importer's organization as each sample's
// collectionSite, the key every scoped sample read filters on. Before it, an
// organization-scoped importer's samples landed with none, so the importer
// could not read back what they had just imported.
test.describe('LGPD sample import by an organization-scoped user (#1353)', () => {
  const organizationIds: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
    await closeSeedDb();
  });

  test('a Coordenador scoped to one organization imports a sample and reads it back, stamped with that organization', async ({ request }) => {
    const admin = await realLogin(request);
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: adminAuth,
      data: { officialName: `#1353 import ${suffix}`, countryCode: 'BR' },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const ownOrg = (await orgRes.json()).data.organizationId as string;
    organizationIds.push(ownOrg);

    const username = `coord.1353.${Date.now()}`;
    const password = 'Coordenador@123';
    const registerRes = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: adminAuth,
      data: {
        name: '#1353 Coordenador Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 3,
        roleName: 'Coordenador',
        organizationId: ownOrg,
      },
    });
    expect(registerRes.ok(), await registerRes.text()).toBeTruthy();
    const coordinator = await completeFirstLoginMfa(request, apiBaseURL!, username, password);

    // #1354: the create forms read the caller's scope here to decide whether
    // to ask for an organization; one organization means no picker.
    const mine = await request.get(`${apiBaseURL}/api/organizations/mine`, {
      headers: { Authorization: `Bearer ${coordinator.token}` },
    });
    expect(mine.status(), await mine.text()).toBe(200);
    const mineData = (await mine.json()).data;
    expect(mineData.scope).toBe('organization');
    expect(mineData.organizations.map((org: { organizationId: string }) => org.organizationId)).toEqual([ownOrg]);

    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const response = await importSamples(request, coordinator.token, [
      `${participant.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,#1353 scoped import,${governed!.collectionId}`,
    ]);
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();
    expect(body.data.errorsDetails).toEqual([]);
    expect(body.data).toMatchObject({ total: 1, success: 1, errors: 0 });

    // Read back through the coordinator's own scoped list: under the bug the
    // sample carried no collectionSite and this list came back without it.
    const list = await request.get(
      `${apiBaseURL}/api/samples?participantId=${encodeURIComponent(participant.participantId)}&limit=200`,
      { headers: { Authorization: `Bearer ${coordinator.token}` } }
    );
    expect(list.status(), await list.text()).toBe(200);
    const listBody = await list.json();
    const samples = (listBody?.data?.samples ?? listBody?.data ?? []) as Array<Record<string, unknown>>;
    expect(samples, 'the scoped importer cannot read back its own imported sample').toHaveLength(1);
    expect(samples[0]).toMatchObject({ sampleType: SAMPLE_TYPE, collectionSite: ownOrg });
  });
});
