import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import {
  createRealParticipant,
  seedActiveConsent,
  seedOperationalLocation,
  seedStudy,
  seedProtocol,
  seedCollectionEntity,
  closeSeedDb,
} from './helpers/seedParticipant';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';

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

test.describe('Specimen registration (RF004 AC#3) — study/protocol/collection linkage (#295)', () => {
  // studyId/protocolId/collectionId are optional ("quando aplicável"), but
  // once supplied each must resolve to a real, already-cadastrado document
  // — not arbitrary client-supplied text. No CRUD API exists yet for any of
  // the three, so the referent is seeded directly against Mongo (same
  // pattern as seedOperationalLocation).
  test.afterAll(async () => {
    await closeSeedDb();
  });

  test('rejects a create when studyId does not resolve to a real Study', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const locationID = await seedOperationalLocation();

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        locationID,
        studyId: 'does-not-exist',
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.message).toMatch(/studyId/);
  });

  test('rejects a create when protocolId does not resolve to a real Protocol', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const locationID = await seedOperationalLocation();

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        locationID,
        protocolId: 'does-not-exist',
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.message).toMatch(/protocolId/);
  });

  test('rejects a create when collectionId does not resolve to a real Collection', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const locationID = await seedOperationalLocation();

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        locationID,
        collectionId: 'does-not-exist',
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.message).toMatch(/collectionId/);
  });

  test('accepts and persists a create whose study/protocol/collection references all resolve', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const locationID = await seedOperationalLocation();

    const studyId = `study-${Date.now()}`;
    const protocolId = `protocol-${Date.now()}`;
    const collectionId = `collection-${Date.now()}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId);
    await seedCollectionEntity(collectionId);

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        locationID,
        studyId,
        protocolId,
        collectionId,
      },
    });

    expect([201, 202]).toContain(create.status());
    const sampleID = (await create.json()).data.sampleID;

    const get = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const persisted = (await get.json()).data;

    expect(persisted.studyId).toBe(studyId);
    expect(persisted.protocolId).toBe(protocolId);
    expect(persisted.collectionId).toBe(collectionId);
  });
});

test.describe('Chain of custody (RF006) — real backend', () => {
  // No spec, mocked or real, covered this RF before (#288) — see
  // E2E_TRACEABILITY_PLAN.md. Building this exposed that the "blocked
  // status" guard in sample.service.js's withdrawSample checked a field
  // (`currentStatus`) and vocabulary that don't exist on Sample.js's real
  // schema (`lifecycleStatus`, enum incl. UNAVAILABLE/DESTROYED/DISPOSED/
  // QUARANTINED) — the check was dead code. Fixed alongside this slice
  // since it directly blocked proving AC#4, same "prove, then build"
  // discipline as #294. Also fixed the same specimenId/ObjectId mismatch
  // bug #294 found elsewhere in updateSample (PUT /api/samples/:id never
  // matched any sample), needed here to seed a blocked lifecycle status
  // through the real API rather than writing to Mongo directly.
  test.afterAll(async () => {
    await closeSeedDb();
  });

  async function seedWithdrawableSample(request: import('@playwright/test').APIRequestContext, admin: { token: string }) {
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const locationID = await seedOperationalLocation();

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        quantity: 10,
        locationID,
      },
    });
    expect([201, 202]).toContain(create.status());
    const sampleID = (await create.json()).data.sampleID;
    return { sampleID };
  }

  test('records origin/destination/responsible/purpose/quantity for a withdrawal, and appends to the audit trail (criteria 1, 6)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const { sampleID } = await seedWithdrawableSample(request, admin);

    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const withdraw = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Parcial',
        withdrawalQuantity: 4,
        withdrawalResponsible: 'Custody Test Responsible',
        sampleDestination: 'RF006 e2e destination lab',
        purpose: 'RF006 e2e traceability proof',
        linkedProject: 'RF006 e2e fixture project',
      },
    });
    expect(withdraw.status()).toBe(200);

    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);

    const movementsGet = await request.get(`${apiBaseURL}/api/samples/${sampleID}/movements`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(movementsGet.status()).toBe(200);
    const movements = (await movementsGet.json()).data;
    const movement = movements.find((m: any) => m.type === 'withdraw');

    expect(movement).toBeTruthy();
    expect(movement.destination).toBe('RF006 e2e destination lab');
    expect(movement.responsible).toBe('Custody Test Responsible');
    expect(movement.purpose).toBe('RF006 e2e traceability proof');
    expect(movement.quantity).toBe(4);
    expect(movement.createdAt).toBeTruthy();
  });

  test('transitions to PARTIAL after a partial withdrawal, then DEPLETED once fully withdrawn (criteria 2, 3)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const { sampleID } = await seedWithdrawableSample(request, admin);

    const partial = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Parcial',
        withdrawalQuantity: 4,
        withdrawalResponsible: 'Custody Test Responsible',
        linkedProject: 'RF006 e2e fixture project',
      },
    });
    expect(partial.status()).toBe(200);
    expect((await partial.json()).data.newStatus).toBe('PARTIAL');

    const afterPartial = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await afterPartial.json()).data.lifecycleStatus).toBe('PARTIAL');

    const total = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Custody Test Responsible',
        linkedProject: 'RF006 e2e fixture project',
      },
    });
    expect(total.status()).toBe(200);
    expect((await total.json()).data.newStatus).toBe('DEPLETED');

    const afterTotal = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await afterTotal.json()).data.lifecycleStatus).toBe('DEPLETED');
  });

  test('blocks a withdrawal against a specimen in a blocked lifecycle status (criterion 4)', async ({ request }) => {
    const admin = await realLogin(request);
    const { sampleID } = await seedWithdrawableSample(request, admin);

    const block = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { lifecycleStatus: 'DESTROYED' },
    });
    expect(block.status()).toBe(200);
    expect((await block.json()).data.lifecycleStatus).toBe('DESTROYED');

    const withdraw = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Custody Test Responsible',
        linkedProject: 'RF006 e2e fixture project',
      },
    });
    expect(withdraw.status()).toBe(400);
    const body = await withdraw.json();
    expect(body.message).toMatch(/não está disponível para retirada/);
    expect(body.message).toMatch(/DESTROYED/);
  });

  test('custody events cannot be altered or deleted — no route accepts a mutation (criterion 5)', async ({ request }) => {
    const admin = await realLogin(request);
    const { sampleID } = await seedWithdrawableSample(request, admin);

    const withdraw = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Parcial',
        withdrawalQuantity: 3,
        withdrawalResponsible: 'Custody Test Responsible',
        linkedProject: 'RF006 e2e fixture project',
      },
    });
    expect(withdraw.status()).toBe(200);
    const movementID = (await withdraw.json()).data.movementID;

    const before = await request.get(`${apiBaseURL}/api/samples/${sampleID}/movements`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const movementsBefore = (await before.json()).data;

    const put = await request.put(`${apiBaseURL}/api/samples/${sampleID}/movements/${movementID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { quantity: 999 },
    });
    expect(put.status()).toBe(404);

    const del = await request.delete(`${apiBaseURL}/api/samples/${sampleID}/movements/${movementID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(del.status()).toBe(404);

    const after = await request.get(`${apiBaseURL}/api/samples/${sampleID}/movements`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const movementsAfter = (await after.json()).data;
    expect(movementsAfter).toEqual(movementsBefore);
  });
});

test.describe('Specimen quarantine (RF019) — real backend', () => {
  // PUT /api/samples/:id (sample.routes.js) drives quarantine: a
  // lifecycleStatus: 'QUARANTINED' update (any originating event —
  // consent revocation, environmental excursion, RCS governance
  // failure, critical non-conformity, criteria 1-4) blocks withdrawal
  // via the same blockedLifecycleStatuses guard proven for RF006/#288
  // (criterion 5), and a quarantineStatus: 'RELEASED' update logs a
  // sample_release audit entry (criteria 7, 8). No dedicated
  // quarantine route exists — release, like RF006's blocked-status
  // seeding, goes through the generic update route.
  test.afterAll(async () => {
    await closeSeedDb();
  });

  async function seedQuarantinableSample(request: import('@playwright/test').APIRequestContext, admin: { token: string }) {
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const locationID = await seedOperationalLocation();

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        quantity: 10,
        locationID,
      },
    });
    expect([201, 202]).toContain(create.status());
    const sampleID = (await create.json()).data.sampleID;
    return { sampleID };
  }

  test('places a specimen into quarantine with cause and originating event recorded, and blocks withdrawal while quarantined (criteria 1, 5, 6)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const { sampleID } = await seedQuarantinableSample(request, admin);

    const quarantine = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        lifecycleStatus: 'QUARANTINED',
        quarantineStatus: 'QUARANTINED',
        quarantineReason: 'RF019 e2e: consent revocation',
      },
    });
    expect(quarantine.status()).toBe(200);
    const quarantined = (await quarantine.json()).data;
    expect(quarantined.lifecycleStatus).toBe('QUARANTINED');
    expect(quarantined.quarantineReason).toBe('RF019 e2e: consent revocation');

    const withdraw = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Quarantine Test Responsible',
        linkedProject: 'RF019 e2e fixture project',
      },
    });
    expect(withdraw.status()).toBe(400);
    const body = await withdraw.json();
    expect(body.message).toMatch(/não está disponível para retirada/);
    expect(body.message).toMatch(/QUARANTINED/);
  });

  test('release requires an authorized actor and is audited with an evidence trail (criteria 7, 8)', async ({ request }) => {
    const admin = await realLogin(request);
    const { sampleID } = await seedQuarantinableSample(request, admin);

    const quarantine = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        lifecycleStatus: 'QUARANTINED',
        quarantineStatus: 'QUARANTINED',
        quarantineReason: 'RF019 e2e: environmental excursion',
      },
    });
    expect(quarantine.status()).toBe(200);

    // No token — release is not open to unauthenticated callers.
    const unauthorized = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      data: { quarantineStatus: 'RELEASED', quarantineReason: 'unauthorized attempt' },
    });
    expect(unauthorized.status()).toBe(401);

    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const release = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        quarantineStatus: 'RELEASED',
        quarantineReason: 'RF019 e2e: cleared after evidence review',
      },
    });
    expect(release.status()).toBe(200);
    expect((await release.json()).data.quarantineStatus).toBe('RELEASED');

    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);
  });
});

test.describe('Specimen quality (RF018) — real backend, SPREC/RCS scoring (#290)', () => {
  // POST /api/quality/preview (quality.routes.js) calls
  // qualityDomain.evaluateQuality -> rcsCertificationService.certify
  // directly against req.body — no sample/participant fixture needed,
  // it's a pure scoring endpoint. Codes below are the same seeded fluid
  // catalog used by rcs-certification.service.test.js's fluidSprec().
  function fluidSprec(overrides: Record<string, unknown> = {}) {
    return {
      matrixType: 'fluid',
      sampleType: 'BLD',
      primaryContainer: 'SST',
      preCentrifugation: 'A',
      centrifugation: 'A',
      secondCentrifugation: 'A',
      postCentrifugationDelay: 'A',
      longTermStorage: 'C',
      ...overrides,
    };
  }

  test('scores a well-formed SPREC payload and returns a non-compensable-free grade', async ({ request }) => {
    const admin = await realLogin(request);
    const sprec = fluidSprec();

    const response = await request.post(`${apiBaseURL}/api/quality/preview`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { matrixType: sprec.matrixType, sprec },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.governance_status).toBe(1);
    expect(body.data.final_grade).toBe('A');
    expect(body.data.rcs_score).toBe(100);
    expect(body.data.axis_penalties.length).toBe(5);
  });

  test('rejects an unknown SPREC code with a non-compensable Grade E governance failure', async ({ request }) => {
    const admin = await realLogin(request);
    const sprec = fluidSprec({ preCentrifugation: 'X' });

    const response = await request.post(`${apiBaseURL}/api/quality/preview`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { matrixType: sprec.matrixType, sprec },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.governance_status).toBe(0);
    expect(body.data.final_grade).toBe('E');
    expect(body.data.rcs_score).toBeNull();
    expect(body.data.grade_route).toBe('Governance failure');
    expect(body.data.governance_failure_reasons).toContain('Unknown SPREC code');
  });

  test('the backend enforces auth independently of the frontend — no token is rejected on its own merits', async ({ request }) => {
    const sprec = fluidSprec();

    const response = await request.post(`${apiBaseURL}/api/quality/preview`, {
      data: { matrixType: sprec.matrixType, sprec },
    });

    expect(response.status()).toBe(401);
  });
});
