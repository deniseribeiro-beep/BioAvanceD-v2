import { test, expect } from '@playwright/test';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import {
  createRealParticipant,
  seedActiveConsent,
  seedStorageBoxLocation,
  retireStorageBox,
  setStorageContainerStatus,
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

// A well-formed sample payload minus participantId/boxId/positionCode —
// reused so each test only varies the one field it's proving, per
// validateCreateSamplePayload (sample.routes.js) / specimen.constants.js's
// MIABIS-controlled vocab. boxId/positionCode (#462) are seeded separately
// per test via seedStorageBoxLocation(), not baked in here, since they're
// real ObjectId-backed documents rather than a static literal.
function validSampleFields() {
  return {
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    quality: 'GOOD',
    linkedProject: 'RF004 e2e fixture project',
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
    // validateCreateSamplePayload (#462) batch-validates every required
    // field together, boxId/positionCode included — without a valid pair
    // here the route rejects on that before ever reaching the participantId
    // lookup this criterion is proving, masking the intended 404 with 422.
    const { boxId, positionCode } = await seedStorageBoxLocation();

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: '99999999', // well-formed (8 digits), never seeded
        ...validSampleFields(),
        boxId,
        positionCode,
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

    // Each call seeds its own box/position — the two creates would otherwise
    // collide on the same occupancyGrid slot (#474) and the second legitimately
    // 409s, which isn't what this criterion (specimenId uniqueness) is testing.
    const create = async () => {
      const { boxId, positionCode } = await seedStorageBoxLocation();
      return request.post(`${apiBaseURL}/api/samples`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: {
          participantId: participant.participantId,
          ...validSampleFields(),
          boxId,
          positionCode,
        },
      });
    };

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
    const { boxId, positionCode } = await seedStorageBoxLocation();

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
        boxId,
        positionCode,
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
    const { boxId, positionCode } = await seedStorageBoxLocation();
    // Deliberately not calling seedActiveConsent — a freshly-created
    // participant has none, per patient.service.js (consent is a separate
    // `consents` collection, not set at patient creation).

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId,
        positionCode,
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
  // pattern as seedStorageBoxLocation).
  test.afterAll(async () => {
    await closeSeedDb();
  });

  test('rejects a create when studyId does not resolve to a real Study', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const { boxId, positionCode } = await seedStorageBoxLocation();

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId,
        positionCode,
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
    const { boxId, positionCode } = await seedStorageBoxLocation();

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId,
        positionCode,
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
    const { boxId, positionCode } = await seedStorageBoxLocation();

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId,
        positionCode,
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
    const { boxId, positionCode } = await seedStorageBoxLocation();

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
        boxId,
        positionCode,
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

test.describe('Specimen registration (RF021 AC#5) — inactive/incompatible protocol and study rejection (#591, #592)', () => {
  // Existence alone isn't enough — sample.service.js also rejects when the
  // referenced Study/Protocol resolves but isn't active/approved (#591).
  test.afterAll(async () => {
    await closeSeedDb();
  });

  test('rejects a create when the referenced study is not active', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const { boxId, positionCode } = await seedStorageBoxLocation();
    const studyId = `study-inactive-${Date.now()}`;
    await seedStudy(studyId, { studyStatus: 'closed-to-accrual' });

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId,
        positionCode,
        studyId,
      },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.message).toMatch(/não está ativo/);
  });

  test('rejects a create when the referenced protocol is not approved', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const { boxId, positionCode } = await seedStorageBoxLocation();
    const protocolId = `protocol-draft-${Date.now()}`;
    await seedProtocol(protocolId, { approvalStatus: 'draft' });

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId,
        positionCode,
        protocolId,
      },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.message).toMatch(/não está aprovado/);
  });

  test('accepts a create when the referenced study/protocol are active/approved', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const { boxId, positionCode } = await seedStorageBoxLocation();
    const studyId = `study-active-${Date.now()}`;
    const protocolId = `protocol-approved-${Date.now()}`;
    await seedStudy(studyId, { studyStatus: 'active' });
    await seedProtocol(protocolId, { approvalStatus: 'approved' });

    const response = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId,
        positionCode,
        studyId,
        protocolId,
      },
    });

    expect([201, 202]).toContain(response.status());
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
    const { boxId, positionCode } = await seedStorageBoxLocation();

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        quantity: 10,
        boxId,
        positionCode,
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
    expect((await partial.json()).data.newStatus).toBe('partial');

    const afterPartial = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await afterPartial.json()).data.specimenStatus).toBe('partial');

    const total = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Custody Test Responsible',
        linkedProject: 'RF006 e2e fixture project',
      },
    });
    expect(total.status()).toBe(200);
    expect((await total.json()).data.newStatus).toBe('depleted');

    const afterTotal = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await afterTotal.json()).data.specimenStatus).toBe('depleted');
  });

  test('blocks a withdrawal against a specimen in a blocked lifecycle status (criterion 4)', async ({ request }) => {
    const admin = await realLogin(request);
    const { sampleID } = await seedWithdrawableSample(request, admin);

    const block = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { specimenStatus: 'destroyed' },
    });
    expect(block.status()).toBe(200);
    const blockBody = (await block.json()).data;
    expect(blockBody.specimenStatus).toBe('destroyed');

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
    // specimenStatus (#408/#540) is lowercase-canonical ('destroyed'), not
    // the uppercase legacy enum this assertion was written against.
    expect(body.message).toMatch(/destroyed/);
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
  // specimenStatus: 'quarantined' update (any originating event —
  // consent revocation, environmental excursion, RCS governance
  // failure, critical non-conformity, criteria 1-4) blocks withdrawal
  // via the BLOCKED_SPECIMEN_STATUSES guard proven for RF006/#288
  // (criterion 5), and a specimenStatus: 'available' update logs a
  // sample_release audit entry (criteria 7, 8). specimenStatus is what
  // updateSample's derivation and the withdraw guard actually key off
  // since #409; quarantineReason has no specimenStatus equivalent and
  // stays legacy-sourced (#407/#408) — lifecycleStatus/quarantineStatus
  // were the dual-write bridge (#405), removed in #408. No dedicated
  // quarantine route exists — release, like RF006's blocked-status
  // seeding, goes through the generic update route.
  test.afterAll(async () => {
    await closeSeedDb();
  });

  async function seedQuarantinableSample(request: import('@playwright/test').APIRequestContext, admin: { token: string }) {
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const { boxId, positionCode } = await seedStorageBoxLocation();

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        quantity: 10,
        boxId,
        positionCode,
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
        specimenStatus: 'quarantined',
        quarantineReason: 'RF019 e2e: consent revocation',
      },
    });
    expect(quarantine.status()).toBe(200);
    const quarantined = (await quarantine.json()).data;
    expect(quarantined.specimenStatus).toBe('quarantined');
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
    // specimenStatus (#408/#540) is lowercase-canonical ('quarantined'), not
    // the uppercase legacy enum this assertion was written against.
    expect(body.message).toMatch(/quarantined/);
  });

  test('release requires an authorized actor and is audited with an evidence trail (criteria 7, 8)', async ({ request }) => {
    const admin = await realLogin(request);
    const { sampleID } = await seedQuarantinableSample(request, admin);

    const quarantine = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        specimenStatus: 'quarantined',
        quarantineReason: 'RF019 e2e: environmental excursion',
      },
    });
    expect(quarantine.status()).toBe(200);

    // No token — release is not open to unauthenticated callers.
    const unauthorized = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      data: { specimenStatus: 'available', quarantineReason: 'unauthorized attempt' },
    });
    expect(unauthorized.status()).toBe(401);

    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const release = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        specimenStatus: 'available',
        quarantineReason: 'RF019 e2e: cleared after evidence review',
      },
    });
    expect(release.status()).toBe(200);
    const releaseBody = (await release.json()).data;
    expect(releaseBody.specimenStatus).toBe('available');

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

// Wave 3 kickoff (#646). RF016's 6 acceptance criteria (requisitos-index.md)
// -- AC#3 (printer-layout validation) has no implementation anywhere in the
// codebase and needs a design call before it can be scoped; filed as #652
// rather than built here. AC#1/#2/#5 (unique specimenId+barcode, Code128/
// DataMatrix/QR) and AC#4/#6 (batch generation, audit + reprint tracking)
// are all proven below against the real backend.
test.describe('Sample labeling (RF016) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  async function createRealSample(request: any, token: string): Promise<{ sampleID: string; barcode: string }> {
    const participant = await createRealParticipant(request, apiBaseURL!, token);
    const { boxId, positionCode } = await seedStorageBoxLocation();

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { participantId: participant.participantId, ...validSampleFields(), boxId, positionCode },
    });
    expect([201, 202]).toContain(create.status());
    const body = (await create.json()).data;

    const get = await request.get(`${apiBaseURL}/api/samples/${body.sampleID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sample = (await get.json()).data;
    return { sampleID: body.sampleID, barcode: sample.barcode };
  }

  test('generates Code128, DataMatrix and QR symbology assets tied to the specimen\'s own unique barcode (criteria 1, 2)', async ({ request }) => {
    const admin = await realLogin(request);
    const sample = await createRealSample(request, admin.token);
    expect(sample.barcode).toBeTruthy();

    const res = await request.get(
      `${apiBaseURL}/api/samples/by-barcode/${encodeURIComponent(sample.barcode)}/symbology-assets`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect(res.ok(), await res.text()).toBeTruthy();
    const assets = (await res.json()).data;

    expect(assets.barcode).toBe(sample.barcode);
    expect(assets.code128.payload).toBe(sample.barcode);
    expect(assets.code128.scannerPrefix).toBe(']C1');
    expect(assets.dataMatrix.payload).toBe(sample.barcode);
    expect(assets.dataMatrix.scannerPrefix).toBe(']d2');
    expect(assets.qr.payload).toBe(sample.barcode);
    expect(assets.qr.scannerPrefix).toBe(']Q3');
  });

  test('never reuses a barcode across two distinct specimens (criterion 5)', async ({ request }) => {
    const admin = await realLogin(request);
    const sampleA = await createRealSample(request, admin.token);
    const sampleB = await createRealSample(request, admin.token);

    expect(sampleA.barcode).toBeTruthy();
    expect(sampleB.barcode).toBeTruthy();
    expect(sampleA.barcode).not.toBe(sampleB.barcode);
  });

  test('audits label generation and distinguishes a reprint from the first generation (criterion 6)', async ({ request }) => {
    const admin = await realLogin(request);
    const sample = await createRealSample(request, admin.token);
    const url = `${apiBaseURL}/api/samples/by-barcode/${encodeURIComponent(sample.barcode)}/symbology-assets`;

    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    const first = await request.get(url, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(first.ok()).toBeTruthy();
    expect((await first.json()).data.reprint).toBe(false);
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);

    const watch2 = await watchAuditTrail(request, apiBaseURL!, admin.token);
    const second = await request.get(url, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(second.ok()).toBeTruthy();
    expect((await second.json()).data.reprint).toBe(true);
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch2);
  });

  test('generates a batch of labels for multiple newly-registered specimens in one call (criterion 4)', async ({ request }) => {
    const admin = await realLogin(request);
    const sampleA = await createRealSample(request, admin.token);
    const sampleB = await createRealSample(request, admin.token);

    const res = await request.post(`${apiBaseURL}/api/samples/labels/batch`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { specimenIds: [sampleA.sampleID, sampleB.sampleID, 'does-not-exist'] },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()).data;

    expect(body.total).toBe(3);
    expect(body.generated).toBe(2);
    expect(body.failed).toBe(1);

    const resultA = body.results.find((r: any) => r.specimenId === sampleA.sampleID);
    expect(resultA).toMatchObject({ success: true, barcode: sampleA.barcode });
    expect(resultA.qr.payload).toBe(sampleA.barcode);

    const missing = body.results.find((r: any) => r.specimenId === 'does-not-exist');
    expect(missing).toMatchObject({ success: false });
  });
});

// #655: RF016's real-backend proof above was against sample.routes.js
// directly -- the page a real user actually lands on (SampleLabelPage.tsx,
// mounted at samples/:id/label in App.tsx) called a separate, simpler
// system (label.routes.js, retired by this fix) with no real symbology.
// This proves the redirect: the real page now renders the real bwip-js
// Code128/DataMatrix/QR images and drives the ported ZPL print-job route.
test.describe('Sample labeling (RF016) — through the real UI (#655)', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  async function login(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
    const session = await realLogin(request);
    await seedRealAuth(page, session);
    return session;
  }

  test('renders real symbology images and downloads a ZPL print job via the real page', async ({ page, request }) => {
    const admin = await login(page, request);

    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const { boxId, positionCode } = await seedStorageBoxLocation();

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { participantId: participant.participantId, ...validSampleFields(), boxId, positionCode },
    });
    expect([201, 202]).toContain(create.status());
    const sampleID = (await create.json()).data.sampleID;

    await page.goto(`/samples/${sampleID}/label`);

    await expect(page.getByTestId('sample-label-page')).toBeVisible();
    await expect(page.getByTestId('sample-label-code128-image')).toBeVisible();
    await expect(page.getByTestId('sample-label-data-matrix-image')).toBeVisible();
    await expect(page.getByTestId('sample-label-qr-image')).toBeVisible();
    await expect(page.getByTestId('sample-label-barcode')).not.toHaveText('');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('sample-label-print-job-button').click(),
    ]);
    expect(download.suggestedFilename()).toBe(`label-${sampleID}-print-job.json`);
  });

  test('renders the error state for a sample that does not exist', async ({ page, request }) => {
    await login(page, request);

    await page.goto('/samples/000000000000000000000000/label');

    await expect(page.getByTestId('sample-label-error')).toBeVisible();
  });
});

// Wave 3 (#646). RF017's 7 acceptance criteria (requisitos-index.md) --
// AC#1 (Freezer>Shelf>Rack>Box>Position hierarchy), AC#2 (no duplicate
// position occupancy), AC#3 (StorageAssignment linked to specimen), AC#5
// (install/move/withdraw recorded) and AC#6 (location history preserved)
// were already covered by pre-existing storage/chain-of-custody code --
// not RED-flagged in dict-07/dict-08, and not re-proven here. AC#4 (link
// sensor/device to equipment) is a pre-existing capability
// (equipment/sensors collections, seedStorageBoxLocation itself seeds
// both) not exercised by this block.
//
// AC#7 ("Bloquear local indisponível, interditado ou fora de condição")
// was genuinely unenforced before this session: StorageBox.status and
// StorageContainer.status both already existed but nothing checked them
// at any allocation/move entry point. MongoStorageRepository's new
// checkLocationBlocked now guards all four write/check paths
// (validatePositionAvailability, allocateSamplePosition,
// autoAssignSamplePosition, moveSamplePosition's destination box) --
// proven below via two of them (the read-only pre-flight check and the
// move write path); the other two share the identical helper and are
// covered at the unit level (MongoStorageRepository.test.js).
//
// Scope note (updated by #655): checkLocationBlocked also blocks via a
// RETIRED/MAINTENANCE *ancestor* container (rack/shelf/freezer). This was
// filed as #654 -- storagePaths (what the ancestor check originally read)
// is never written anywhere in api/backend/src, so the branch could only
// be unit-tested, not proven here. #654's fix added a live
// storageContainers.parent_id-walk fallback instead of depending on
// storagePaths at all -- proven below for the first time, against the
// exact hierarchy seedStorageBoxLocation (mirroring the real createSample
// path) actually writes.
test.describe('Storage location availability (RF017 AC#7) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  test('rejects position validation against a RETIRED storage box (criterion 7)', async ({ request }) => {
    const admin = await realLogin(request);
    const { boxId } = await seedStorageBoxLocation();
    await retireStorageBox(boxId);

    const res = await request.get(`${apiBaseURL}/api/storage/validate/${boxId}/A1`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.error).toBe('BOX_UNAVAILABLE');
    expect(body.message).toContain('RETIRED');
  });

  test('blocks moving a specimen into a RETIRED storage box (criterion 7)', async ({ request }) => {
    const admin = await realLogin(request);

    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const origin = await seedStorageBoxLocation();
    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId: origin.boxId,
        positionCode: origin.positionCode,
      },
    });
    expect([201, 202]).toContain(create.status());
    const sampleId = (await create.json()).data.sampleID;

    const destination = await seedStorageBoxLocation();
    await retireStorageBox(destination.boxId);

    const res = await request.post(`${apiBaseURL}/api/storage/move`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { sampleId, targetBoxId: destination.boxId, targetPosition: 'A1' },
    });
    expect(res.status(), await res.text()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('retirada de uso');
  });

  // #655: proven for the first time -- see the updated scope note above.
  test('rejects position validation when the box\'s rack is under MAINTENANCE (ancestor-level, criterion 7)', async ({ request }) => {
    const admin = await realLogin(request);
    const { boxId, rackId } = await seedStorageBoxLocation();
    await setStorageContainerStatus(rackId, 'MAINTENANCE');

    const res = await request.get(`${apiBaseURL}/api/storage/validate/${boxId}/A1`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.error).toBe('LOCATION_UNAVAILABLE');
    expect(body.message).toContain('MAINTENANCE');
  });

  // #655 regression coverage: seedStorageBoxLocation's own SHELF/RACK
  // containers have no status field at all (only the FREEZER gets one) --
  // this is exactly the shape that incorrectly blocked every allocation
  // before the $exists fix (MongoStorageRepository.js#checkLocationBlocked).
  test('stays available when the box\'s ancestor containers have no status field set (criterion 7, negative case)', async ({ request }) => {
    const admin = await realLogin(request);
    const { boxId } = await seedStorageBoxLocation();

    const res = await request.get(`${apiBaseURL}/api/storage/validate/${boxId}/A1`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
  });
});
