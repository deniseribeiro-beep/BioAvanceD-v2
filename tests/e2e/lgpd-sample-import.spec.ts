import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';
import { findLgpdQuarantineBatch, findLgpdQuarantinedRows, closeFhirImportDb } from './helpers/queryFhirImport';

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

const CSV_HEADER = 'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject';

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
      `${participant.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import`,
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
      `${participant.participantId},NOT_A_REAL_SAMPLE_TYPE,${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import`,
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
      `${good.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import`,
      `${bad.participantId},${SAMPLE_TYPE},NOT_A_REAL_ORIGIN,${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import`,
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
      `${good.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import`,
      `${bad.participantId},NOT_A_REAL_SAMPLE_TYPE,${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import`,
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

    // Not just the error text -- the original values, which is what makes a
    // quarantined row correctable and re-submittable rather than merely
    // auditable.
    expect(quarantined[0].row).toBeTruthy();
    expect(String(quarantined[0].row.participantId)).toBe(String(bad.participantId));
    expect(quarantined[0].row.sampleType).toBe('NOT_A_REAL_SAMPLE_TYPE');

    // And the row that imported cleanly is NOT quarantined -- quarantine is
    // for invalid rows, not a copy of the whole file.
    expect(
      quarantined.some((r) => String(r.row?.participantId) === String(good.participantId)),
      'a row that imported successfully must not be quarantined'
    ).toBe(false);
  });

  test('RNF011 AC#4: a clean import leaves no quarantine batch behind', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    const response = await importSamples(request, admin.token, [
      `${participant.participantId},${SAMPLE_TYPE},${SAMPLE_ORIGIN},${EXTRACTION_PROTOCOL},5,GOOD,RF-LGPD e2e import`,
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.data).toMatchObject({ total: 1, success: 1, errors: 0 });
    // Nothing was rejected, so there is nothing to review -- an empty batch
    // would be noise in whatever queue eventually consumes these.
    expect(body.data.stagingBatchId).toBeNull();
  });
});
