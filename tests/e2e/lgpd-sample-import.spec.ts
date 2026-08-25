import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { createRealParticipant, closeSeedDb } from './helpers/seedParticipant';

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
    // Deliberately not `?patientID=<id>`: that filter is accepted by the
    // route and silently never applied by listSamples (#785), so relying
    // on it would make this assertion pass for a sample belonging to
    // anyone. Fetch a page and match here instead — do not "simplify"
    // this back to a server-side filter until #785 is fixed.
    const list = await request.get(`${apiBaseURL}/api/samples?limit=200`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });

    expect(list.status()).toBe(200);
    const listBody = await list.json();
    const samples = (listBody?.data?.samples ?? listBody?.data ?? []) as Array<Record<string, unknown>>;

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

    // #786: `total` counts rows that reached the *end* of the loop body, so
    // a rejected row — which gets there by `continue` — is never counted.
    // One row in, `total: 0` out. This asserts the current (wrong) value so
    // the spec does not go red when #786 lands; it is not an endorsement.
    // The correct value is 1, matching importPatients in the same file.
    expect(body.data).toMatchObject({ total: 0, success: 0, errors: 1 });
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

    // #786 again, and this is the shape that shows why it matters: the
    // response reports total 1 for a two-row file, so total < success +
    // errors. The same numbers reach auditLogger.logImport. Asserted as-is
    // for now; the correct total is 2.
    expect(body.data).toMatchObject({ total: 1, success: 1, errors: 1 });
    expect(body.data.success + body.data.errors).toBe(2); // rows actually accounted for
    expect(body.data.errorsDetails).toHaveLength(1);
    expect(body.data.errorsDetails[0].participantId).toBe(String(bad.participantId));
  });
});
