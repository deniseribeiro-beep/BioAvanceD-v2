import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';

// Real backend only — see backend-integration.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker` against the compose test
// stack (or a locally running backend), never the mocked suite.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

// A well-formed sample payload minus participantId — reused so each test
// only varies the one field it's proving, per validateCreateSamplePayload
// (sample.routes.js) / specimen.constants.js's MIABIS-controlled vocab.
function validSampleFields() {
  return {
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    quality: 'GOOD',
    linkedProject: 'RF004 e2e fixture project',
    locationID: 1,
    registeredAt: new Date().toISOString(),
  };
}

test.describe('Specimen registration (RF004) — real backend, negative paths', () => {
  // Full RF004 happy path (specimenId generation/uniqueness, SPREC recording,
  // consent-state blocking) needs a real participant fixture, which needs a
  // consentTemplateId with no clean API seed path today — carried forward,
  // not forced into this slice (see issue #287's follow-up).

  test('rejects specimen creation when participantId does not exist (criterion 1)', async ({ request }) => {
    const admin = await realLogin(request);

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: '99999999', // well-formed (8 digits), never seeded
        ...validSampleFields(),
      },
    });

    expect(response.status()).toBe(404);
  });

  test('rejects specimen creation when participantId is malformed (criterion 1)', async ({ request }) => {
    const admin = await realLogin(request);

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: 'not-an-id',
        ...validSampleFields(),
      },
    });

    expect(response.status()).toBe(422);
  });

  test('rejects specimen creation with no participantId at all (criterion 1)', async ({ request }) => {
    const admin = await realLogin(request);
    const fields = validSampleFields();

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: fields,
    });

    expect(response.status()).toBe(422);
  });

  test('rejects an invalid material type / origin / processing method not in the MIABIS-controlled vocab (criterion 4)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: '99999999',
        ...validSampleFields(),
        sampleType: 'NOT_A_REAL_TYPE',
        sampleOrigin: 'NOT_A_REAL_ORIGIN',
        extractionProtocol: 'NOT_A_REAL_PROTOCOL',
      },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.details.join(' ')).toMatch(/sampleType inválido/);
    expect(body.details.join(' ')).toMatch(/sampleOrigin inválido/);
    expect(body.details.join(' ')).toMatch(/extractionProtocol inválido/);
  });

  test('the backend enforces this independently of the frontend — no token is rejected on its own merits', async ({
    request,
  }) => {
    const response = await request.post(`${apiBaseURL}/api/samples`, {
      data: {
        participantId: '99999999',
        ...validSampleFields(),
      },
    });

    expect(response.status()).toBe(401);
  });
});
