import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  seedActiveConsent,
  seedOperationalLocation,
  closeSeedDb,
} from './helpers/seedParticipant';

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

test.describe('Specimen registration (RF004) — real backend, happy path (#294)', () => {
  // Real participant + consent template + operational location/sensor,
  // seeded directly against the test stack's Mongo (see
  // helpers/seedParticipant.ts — no API seed path exists for any of these).
  test.afterAll(async () => {
    await closeSeedDb();
  });

  test('generates a unique specimenId on each successful create (criterion 2)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const locationID = await seedOperationalLocation();

    const create = () =>
      request.post(`${apiBaseURL}/api/samples`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: {
          participantId: participant.participantId,
          ...validSampleFields(),
          locationID,
        },
      });

    // 201 or 202 (topology sync fell back to quarantine) are both a
    // successful create — only the topology sync's own success is
    // conditional, not the specimen registration this criterion covers.
    const first = await create();
    expect([201, 202]).toContain(first.status());
    const firstSampleID = (await first.json()).data.sampleID;

    const second = await create();
    expect([201, 202]).toContain(second.status());
    const secondSampleID = (await second.json()).data.sampleID;

    const [firstGet, secondGet] = await Promise.all([
      request.get(`${apiBaseURL}/api/samples/${firstSampleID}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      }),
      request.get(`${apiBaseURL}/api/samples/${secondSampleID}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      }),
    ]);

    const firstSpecimenId = (await firstGet.json()).data.specimenId;
    const secondSpecimenId = (await secondGet.json()).data.specimenId;

    expect(firstSpecimenId).toBeTruthy();
    expect(secondSpecimenId).toBeTruthy();
    expect(firstSpecimenId).not.toBe(secondSpecimenId);
  });

  test('records SPREC variables on a successful create (criterion 5)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const locationID = await seedOperationalLocation();

    const sprec = {
      preCentrifugation: 'A',
      centrifugation: 'B',
      postCentrifugation: 'A',
      secondCentrifugation: 'X',
      postSecondCentrifugation: 'A',
      longTermStorage: 'A',
    };

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        locationID,
        sprec,
      },
    });

    expect([201, 202]).toContain(create.status());
    const sampleID = (await create.json()).data.sampleID;

    const get = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const persistedSprec = (await get.json()).data.sprec;

    expect(persistedSprec).toMatchObject(sprec);
  });

  test('blocks operations against a specimen whose participant has no active consent (criterion 6)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const locationID = await seedOperationalLocation();
    // Deliberately not calling seedActiveConsent — a freshly-created
    // participant has none, per patient.service.js (consent is a separate
    // `consents` collection, not set at patient creation).

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        locationID,
      },
    });
    expect([201, 202]).toContain(create.status());
    const sampleID = (await create.json()).data.sampleID;

    const withdraw = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Test Responsible',
        linkedProject: 'RF004 e2e fixture project',
      },
    });

    expect(withdraw.status()).toBe(400);
    const body = await withdraw.json();
    expect(body.message).toMatch(/[Cc]onsentimento inexistente ou revogado/);

    // Prove the unblock side of the same criterion: once an ACTIVE consent
    // exists for the participant, the identical withdraw request succeeds.
    await seedActiveConsent(participant.participantId);

    const withdrawAfterConsent = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Test Responsible',
        linkedProject: 'RF004 e2e fixture project',
      },
    });

    expect(withdrawAfterConsent.status()).toBe(200);
  });
});
