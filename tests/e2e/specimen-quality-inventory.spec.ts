import { test, expect, type APIRequestContext } from '@playwright/test';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import {
  createRealParticipant,
  seedActiveConsent,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  retireStorageBox,
  setStorageContainerStatus,
  seedStudy,
  seedProtocol,
  seedCollectionEntity,
  clearCollectionRegime,
  seedQuarantineAction,
  cleanupQuarantineActions,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';
import { deleteOrganizations } from './helpers/listOrganizations';
import { sampleMongoId, sampleOutboxEvents, quarantineActionOutboxEvents, closeOutboxDb } from './helpers/queryOutbox';
import {
  seedTelemetrySummary,
  seedApprovalDocument,
  cleanupGovernanceEvidence,
  closeGovernanceEvidenceDb,
} from './helpers/seedGovernanceEvidence';

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
  const seededStorageBoxes: SeededStorageBox[] = [];

  test.afterAll(async () => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await closeSeedDb();
  });

  test('rejects specimen creation when participantId does not exist (criterion 1)', async ({ request }) => {
    const admin = await realLogin(request);
    // validateCreateSamplePayload (#462) batch-validates every required
    // field together, boxId/positionCode included — without a valid pair
    // here the route rejects on that before ever reaching the participantId
    // lookup this criterion is proving, masking the intended 404 with 422.
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

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
  const seededStorageBoxes: SeededStorageBox[] = [];

  test.afterAll(async () => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await closeSeedDb();
  });

  test('generates a unique specimenId on each successful create (criterion 2)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);

    // Each call seeds its own box/position — the two creates would otherwise
    // collide on the same occupancyGrid slot (#474) and the second legitimately
    // 409s, which isn't what this criterion (specimenId uniqueness) is testing.
    const create = async () => {
      const seededStorageBox = await seedStorageBoxLocation();
      seededStorageBoxes.push(seededStorageBox);
      const { boxId, positionCode } = seededStorageBox;
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
    const firstSampleID = (await first.json()).data.specimenId;

    const second = await create();
    expect([201, 202]).toContain(second.status());
    const secondSampleID = (await second.json()).data.specimenId;

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
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

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
    const sampleID = (await create.json()).data.specimenId;

    const get = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const persistedSprec = (await get.json()).data.sprec;

    expect(persistedSprec).toMatchObject(sprec);
  });

  test('registers a specimen whose participant has no active consent, and blocks operations against it (criterion 6)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;
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
    // RF004 AC7 (#1492), the ruling recorded: on the default (permissive)
    // mount, registering a specimen with no consent in force is allowed. The
    // block falls on the specimen's consent-bound operations (the withdraw
    // below; the access-request evaluation, RF024 AC2) and on ingestion,
    // whose consent gate fails closed.
    const created = (await create.json()).data;
    expect(created.operationMode).toBe('PERMISSIVE');
    expect(created.specimenId).toBeTruthy();
    const sampleID = created.specimenId;

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
  const seededStorageBoxes: SeededStorageBox[] = [];
  const organizationIds: string[] = [];

  test.afterAll(async ({ request }) => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
    await closeSeedDb();
  });

  // An organization and an ethics approval in force for the collection, the
  // two references a governance context names.
  async function prepareGovernance(
    request: APIRequestContext,
    token: string,
    collectionId: string
  ): Promise<{ organizationId: string; approvalId: string }> {
    const headers = { Authorization: `Bearer ${token}` };
    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: `RF004 ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);

    const approval = await request.post(`${apiBaseURL}/api/collections/${collectionId}/governance/approvals`, {
      headers,
      data: {
        authority: 'CEP sintético',
        caae: '00000000.0.0000.0000',
        documentUri: 'https://docs.example.org/parecer.pdf',
        documentChecksum: `sha256:${'a'.repeat(64)}`,
        effectivePeriod: { start: '2026-01-01', end: '2030-12-31' },
        status: 'active',
        responsibleOrganizationId: organizationId,
      },
    });
    expect(approval.status(), await approval.text()).toBe(201);
    const approvalId = (await approval.json()).data.approvalId as string;
    return { organizationId, approvalId };
  }

  // RF004 AC3/AC4, RF021 AC3: a complete biorepository context over those
  // references.
  function biorepositoryContext(
    ids: { studyId: string; protocolId: string },
    organizationId: string,
    approvalId: string
  ): Record<string, unknown> {
    return {
      studyId: ids.studyId,
      protocolId: ids.protocolId,
      protocolVersion: '1.0',
      caae: '00000000.0.0000.0000',
      responsibleOrganizationId: organizationId,
      responsibleInvestigatorId: 'investigator-e2e',
      ethicsApprovalId: approvalId,
      validityPeriod: { start: '2026-01-01', end: '2030-12-31' },
      plannedEndDate: '2030-12-31',
    };
  }

  // RF004 AC3/AC4, RF021 AC2/AC3: give a biorepository collection its
  // governance through the real API -- an organization, an ethics approval in
  // force, then the `created` event carrying the context.
  async function governBiorepository(
    request: APIRequestContext,
    token: string,
    ids: { collectionId: string; studyId: string; protocolId: string }
  ): Promise<{ organizationId: string; approvalId: string }> {
    const headers = { Authorization: `Bearer ${token}` };
    const { organizationId, approvalId } = await prepareGovernance(request, token, ids.collectionId);

    const event = await request.post(`${apiBaseURL}/api/collections/${ids.collectionId}/governance/events`, {
      headers,
      data: {
        justification: 'Contexto inicial do biorrepositório',
        governanceContext: biorepositoryContext(ids, organizationId, approvalId),
      },
    });
    expect(event.status(), await event.text()).toBe(201);
    expect((await event.json()).data.event).toMatchObject({ decisionType: 'created', newRegime: 'biorepository', approvalIds: [approvalId] });
    return { organizationId, approvalId };
  }

  // RF004 AC5: a biobank's access policy, scoped to the test's own organization.
  async function createAccessPolicy(
    request: APIRequestContext,
    headers: Record<string, string>,
    organizationId: string,
    stamp: string
  ): Promise<string> {
    const policy = await request.post(`${apiBaseURL}/api/access-policies`, {
      headers,
      data: {
        policyName: `RF020 e2e ${stamp}`,
        policyVersion: '1.0.0',
        applicableEntityTypes: ['AccessRequest'],
        decisionEffect: 'review_required',
        ruleExpression: 'all-conditions',
        effectivePeriod: { start: new Date(Date.now() - 60_000).toISOString() },
        roleCodes: ['researcher'],
        organizationScopeIds: [organizationId],
        resourceScopes: ['Specimen'],
        conditions: [{ consent: 'compatible' }],
        decisionReasonsRequired: true,
      },
    });
    expect(policy.status(), await policy.text()).toBe(201);
    return (await policy.json()).data.accessPolicyId as string;
  }

  test('rejects a create when studyId does not resolve to a real Study', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

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
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

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
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

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
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

    const studyId = `study-${Date.now()}`;
    const protocolId = `protocol-${Date.now()}`;
    const collectionId = `collection-${Date.now()}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId, { protocolVersion: '1.0' });
    await seedCollectionEntity(collectionId);
    await governBiorepository(request, admin.token, { collectionId, studyId, protocolId });

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
    const sampleID = (await create.json()).data.specimenId;

    const get = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const persisted = (await get.json()).data;

    expect(persisted.studyId).toBe(studyId);
    expect(persisted.protocolId).toBe(protocolId);
    expect(persisted.collectionId).toBe(collectionId);
  });

  // RF004 AC2/AC7: a collection with no governance regime takes no specimen.
  test('rejects a create into a collection that carries no governance regime', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

    const collectionId = `collection-ungoverned-${Date.now()}`;
    await seedCollectionEntity(collectionId);
    await clearCollectionRegime(collectionId);

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId,
        positionCode,
        collectionId,
      },
    });

    expect(create.status(), await create.text()).toBe(422);
    expect(JSON.stringify(await create.json())).toMatch(/sem regime de governança/);
  });

  // RF004 AC3 (RULE-001): a regime alone is not enough; the collection needs
  // the one context the regime names.
  test('rejects a create into a collection with a regime but no governance context', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

    const collectionId = `collection-no-context-${Date.now()}`;
    await seedCollectionEntity(collectionId);

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { participantId: participant.participantId, ...validSampleFields(), boxId, positionCode, collectionId },
    });

    expect(create.status(), await create.text()).toBe(422);
    expect(JSON.stringify(await create.json())).toMatch(/sem contexto de governança/);
  });

  // RF004 AC7, RF021 AC6: an approval withdrawn stops registration.
  test('rejects a create once the collection\'s ethics approval is suspended', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ids = { collectionId: `collection-suspended-${stamp}`, studyId: `study-${stamp}`, protocolId: `protocol-${stamp}` };
    await seedStudy(ids.studyId);
    await seedProtocol(ids.protocolId, { protocolVersion: '1.0' });
    await seedCollectionEntity(ids.collectionId);
    const { approvalId } = await governBiorepository(request, admin.token, ids);

    const suspend = await request.post(
      `${apiBaseURL}/api/collections/${ids.collectionId}/governance/approvals/${approvalId}/status`,
      { headers: { Authorization: `Bearer ${admin.token}` }, data: { status: 'suspended', reason: 'Parecer em reanálise' } }
    );
    expect(suspend.status(), await suspend.text()).toBe(200);

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { participantId: participant.participantId, ...validSampleFields(), boxId, positionCode, collectionId: ids.collectionId },
    });

    expect(create.status(), await create.text()).toBe(422);
    expect(JSON.stringify(await create.json())).toMatch(/sem aprovação de governança vigente/);
  });

  // RF020 AC4: no silent conversion. An edit is refused; a governance event
  // with a justification, an approval in force and the new regime's context
  // converts the collection and stays on record.
  test('converts a collection\'s regime only through a governance event', async ({ request }) => {
    const admin = await realLogin(request);
    const headers = { Authorization: `Bearer ${admin.token}` };
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ids = { collectionId: `collection-convert-${stamp}`, studyId: `study-${stamp}`, protocolId: `protocol-${stamp}` };
    await seedStudy(ids.studyId);
    await seedProtocol(ids.protocolId, { protocolVersion: '1.0' });
    await seedCollectionEntity(ids.collectionId);
    const { organizationId, approvalId } = await governBiorepository(request, admin.token, ids);

    const edit = await request.put(`${apiBaseURL}/api/collections/${ids.collectionId}`, {
      headers,
      data: { governanceRegime: 'biobank' },
    });
    expect(edit.status(), await edit.text()).toBe(422);

    // The biobank's policy, scoped to this test's own organization.
    const accessPolicyId = await createAccessPolicy(request, headers, organizationId, stamp);

    const biobankContext = {
      broadPurpose: { code: 'health-research' },
      governancePolicyId: accessPolicyId,
      accessCommitteeId: 'committee-e2e',
      institutionalCustodianId: organizationId,
      futureUseConditions: ['compatible_consent'],
      applicableConsentModel: ['broad'],
      newEthicsReviewRule: 'when_required_by_policy',
    };
    const unjustified = await request.post(`${apiBaseURL}/api/collections/${ids.collectionId}/governance/events`, {
      headers,
      data: { newRegime: 'biobank', approvalIds: [approvalId], governanceContext: biobankContext },
    });
    expect(unjustified.status(), await unjustified.text()).toBe(422);

    const converted = await request.post(`${apiBaseURL}/api/collections/${ids.collectionId}/governance/events`, {
      headers,
      data: { newRegime: 'biobank', approvalIds: [approvalId], governanceContext: biobankContext, justification: 'Ampliação para uso futuro' },
    });
    expect(converted.status(), await converted.text()).toBe(201);

    const governance = (await (await request.get(`${apiBaseURL}/api/collections/${ids.collectionId}/governance`, { headers })).json()).data;
    expect(governance.governanceRegime).toBe('biobank');
    expect(governance.governanceContext).toMatchObject({ governancePolicyId: accessPolicyId, institutionalCustodianId: organizationId });
    expect(governance.governanceContext.biorepositoryContextId).toBeUndefined();
    expect(governance.events.map((e: any) => [e.decisionType, e.previousRegime, e.newRegime])).toEqual([
      ['created', null, 'biorepository'],
      ['regime_change', 'biorepository', 'biobank'],
    ]);
  });

  // RF004 AC4, RF021 AC3: each required biorepository field is checked on its
  // own, and a context needs a planned end date or a closure condition.
  test('refuses a biorepository context missing studyId, protocolVersion or responsibleInvestigatorId, or both plannedEndDate and closureCondition', async ({ request }) => {
    const admin = await realLogin(request);
    const headers = { Authorization: `Bearer ${admin.token}` };
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ids = { collectionId: `collection-incomplete-${stamp}`, studyId: `study-${stamp}`, protocolId: `protocol-${stamp}` };
    await seedStudy(ids.studyId);
    await seedProtocol(ids.protocolId, { protocolVersion: '1.0' });
    await seedCollectionEntity(ids.collectionId);
    const { organizationId, approvalId } = await prepareGovernance(request, admin.token, ids.collectionId);
    const full = biorepositoryContext(ids, organizationId, approvalId);
    const postContext = (governanceContext: Record<string, unknown>) =>
      request.post(`${apiBaseURL}/api/collections/${ids.collectionId}/governance/events`, {
        headers,
        data: { justification: 'Contexto inicial do biorrepositório', governanceContext },
      });

    for (const field of ['studyId', 'protocolVersion', 'responsibleInvestigatorId']) {
      const { [field]: _dropped, ...withoutField } = full;
      const res = await postContext(withoutField);
      expect(res.status(), await res.text()).toBe(422);
      expect((await res.json()).details).toEqual([`${field} é obrigatório para biorrepositório`]);
    }

    const { plannedEndDate: _plannedEndDate, ...withoutEnd } = full;
    const noEnd = await postContext(withoutEnd);
    expect(noEnd.status(), await noEnd.text()).toBe(422);
    expect((await noEnd.json()).details).toEqual(['biorrepositório exige plannedEndDate ou closureCondition (RF021 AC3)']);

    // A refused event wrote no context, so the full one is still a `created`.
    const res = await postContext(full);
    expect(res.status(), await res.text()).toBe(201);
    expect((await res.json()).data.event.decisionType).toBe('created');
  });

  // RF004 AC4: a biorepository specimen belongs to its context's study and
  // protocol.
  test('refuses a specimen naming another study or protocol than its biorepository collection\'s', async ({ request }) => {
    const admin = await realLogin(request);
    const headers = { Authorization: `Bearer ${admin.token}` };
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ids = { collectionId: `collection-linkage-${stamp}`, studyId: `study-a-${stamp}`, protocolId: `protocol-a-${stamp}` };
    const otherStudyId = `study-b-${stamp}`;
    const otherProtocolId = `protocol-b-${stamp}`;
    await seedStudy(ids.studyId);
    await seedProtocol(ids.protocolId, { protocolVersion: '1.0' });
    await seedCollectionEntity(ids.collectionId);
    await governBiorepository(request, admin.token, ids);
    await seedStudy(otherStudyId);
    await seedProtocol(otherProtocolId);

    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const createSample = async (studyId: string, protocolId: string) => {
      const seededStorageBox = await seedStorageBoxLocation();
      seededStorageBoxes.push(seededStorageBox);
      const { boxId, positionCode } = seededStorageBox;
      return request.post(`${apiBaseURL}/api/samples`, {
        headers,
        data: {
          participantId: participant.participantId,
          ...validSampleFields(),
          boxId,
          positionCode,
          studyId,
          protocolId,
          collectionId: ids.collectionId,
        },
      });
    };

    const otherStudy = await createSample(otherStudyId, ids.protocolId);
    expect(otherStudy.status(), await otherStudy.text()).toBe(422);
    expect((await otherStudy.json()).message).toBe(
      `studyId ${otherStudyId} difere do studyId do biorrepositório da coleção (${ids.studyId})`
    );

    const otherProtocol = await createSample(ids.studyId, otherProtocolId);
    expect(otherProtocol.status(), await otherProtocol.text()).toBe(422);
    expect((await otherProtocol.json()).message).toBe(
      `protocolId ${otherProtocolId} difere do protocolId do biorrepositório da coleção (${ids.protocolId})`
    );

    const own = await createSample(ids.studyId, ids.protocolId);
    expect([201, 202], await own.text()).toContain(own.status());
  });

  // RF004 AC5: a biobank collection with an approval in force takes a
  // specimen, and its context keeps every field it was given.
  test('admits a specimen into a biobank collection with an approval and reads back every biobank context field', async ({ request }) => {
    const admin = await realLogin(request);
    const headers = { Authorization: `Bearer ${admin.token}` };
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const collectionId = `collection-biobank-${stamp}`;
    await seedCollectionEntity(collectionId);
    await clearCollectionRegime(collectionId);
    const { organizationId, approvalId } = await prepareGovernance(request, admin.token, collectionId);
    const accessPolicyId = await createAccessPolicy(request, headers, organizationId, stamp);

    const context = {
      broadPurpose: { code: 'health-research' },
      governancePolicyId: accessPolicyId,
      accessCommitteeId: 'committee-e2e',
      institutionalCustodianId: organizationId,
      futureUseConditions: ['compatible_consent'],
      applicableConsentModel: ['broad'],
      newEthicsReviewRule: 'when_required_by_policy',
    };
    const event = await request.post(`${apiBaseURL}/api/collections/${collectionId}/governance/events`, {
      headers,
      data: { newRegime: 'biobank', approvalIds: [approvalId], justification: 'Biobanco para uso futuro', governanceContext: context },
    });
    expect(event.status(), await event.text()).toBe(201);
    expect((await event.json()).data.event).toMatchObject({
      decisionType: 'created',
      previousRegime: null,
      newRegime: 'biobank',
      approvalIds: [approvalId],
    });

    const governance = (await (await request.get(`${apiBaseURL}/api/collections/${collectionId}/governance`, { headers })).json()).data;
    expect(governance.governanceRegime).toBe('biobank');
    expect(governance.governanceContext).toMatchObject({ ...context, collectionId });
    expect(typeof governance.governanceContext.biobankGovernanceContextId).toBe('string');
    expect(governance.governanceContext.studyId).toBeUndefined();

    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;
    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers,
      data: { participantId: participant.participantId, ...validSampleFields(), boxId, positionCode, collectionId },
    });
    expect([201, 202], await create.text()).toContain(create.status());
    const specimenId = (await create.json()).data.specimenId;

    const get = await request.get(`${apiBaseURL}/api/samples/${specimenId}`, { headers });
    expect((await get.json()).data.collectionId).toBe(collectionId);
  });
});

test.describe('Specimen registration (RF021 AC#5) — inactive/incompatible protocol and study rejection (#591, #592)', () => {
  // Existence alone isn't enough — sample.service.js also rejects when the
  // referenced Study/Protocol resolves but isn't active/approved (#591).
  const seededStorageBoxes: SeededStorageBox[] = [];

  test.afterAll(async () => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await closeSeedDb();
  });

  test('rejects a create when the referenced study is not active', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;
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
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;
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
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;
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
  // No spec, mocked or real, covered this RF before (#288). Building
  // this exposed that the "blocked
  // status" guard in sample.service.js's withdrawSample checked a field
  // (`currentStatus`) and vocabulary that don't exist on Sample.js's real
  // schema (`lifecycleStatus`, enum incl. UNAVAILABLE/DESTROYED/DISPOSED/
  // QUARANTINED) — the check was dead code. Fixed alongside this slice
  // since it directly blocked proving AC#4, same "prove, then build"
  // discipline as #294. Also fixed the same specimenId/ObjectId mismatch
  // bug #294 found elsewhere in updateSample (PUT /api/samples/:id never
  // matched any sample), needed here to seed a blocked lifecycle status
  // through the real API rather than writing to Mongo directly.
  const seededStorageBoxes: SeededStorageBox[] = [];

  test.afterAll(async () => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await closeSeedDb();
  });

  async function seedWithdrawableSample(request: import('@playwright/test').APIRequestContext, admin: { token: string }) {
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

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
    const sampleID = (await create.json()).data.specimenId;
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

  // RF006 AC2/AC3: a withdrawal moves the derived quantityStatus, never
  // specimenStatus; RF026 AC7: a depleted specimen is then closed through
  // POST /close, the one status change in this flow, recorded as a decision.
  test('moves quantityStatus to partial then depleted while specimenStatus stays available, then closes on validated consumption (criteria 2, 3)', async ({
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
    const partialBody = (await partial.json()).data;
    expect(partialBody.newStatus).toBe('available');
    expect(partialBody.quantityStatus).toBe('partial');
    // RF006 AC4 (#1512): each withdrawal raises the quantity ledger version by one.
    expect(partialBody.quantityLedgerVersion).toBe(1);

    const afterPartial = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const afterPartialBody = (await afterPartial.json()).data;
    expect(afterPartialBody.specimenStatus).toBe('available');
    expect(afterPartialBody.quantityStatus).toBe('partial');
    expect(afterPartialBody.quantityLedgerVersion).toBe(1);

    // A specimen still holding material is not closed.
    const earlyClose = await request.post(`${apiBaseURL}/api/samples/${sampleID}/close`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {},
    });
    expect(earlyClose.status()).toBe(409);
    expect((await earlyClose.json()).error).toBe('SPECIMEN_CLOSE_REFUSED');

    const total = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Custody Test Responsible',
        linkedProject: 'RF006 e2e fixture project',
      },
    });
    expect(total.status()).toBe(200);
    const totalBody = (await total.json()).data;
    expect(totalBody.newStatus).toBe('available');
    expect(totalBody.quantityStatus).toBe('depleted');
    expect(totalBody.quantityLedgerVersion).toBe(2);

    const afterTotal = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const afterTotalBody = (await afterTotal.json()).data;
    expect(afterTotalBody.specimenStatus).toBe('available');
    expect(afterTotalBody.quantityStatus).toBe('depleted');
    expect(afterTotalBody.quantityLedgerVersion).toBe(2);

    // RF006 AC4 (#1512): the balance reconciles with the ledger head, the movement stamped with the specimen's version.
    const ledger = await request.get(`${apiBaseURL}/api/samples/${sampleID}/movements`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(ledger.status()).toBe(200);
    const movements = (await ledger.json()).data;
    const ledgered = movements
      .filter((m: any) => m.type === 'withdraw')
      .map((m: any) => m.quantityLedgerVersion)
      .sort();
    expect(ledgered).toEqual([1, 2]);
    const head = movements.find((m: any) => m.quantityLedgerVersion === 2);
    expect(head.newQuantity).toBe(afterTotalBody.currentQuantity);
    expect(afterTotalBody.currentQuantity).toBe(0);

    // RF006 AC4 (#1531): an edit cannot move a ledgered quantity; the balance and version stay as the ledger left them.
    for (const data of [{ currentQuantity: 5 }, { totalWithdrawn: 0 }, { totalReturned: 1 }, { initialQuantity: 50 }]) {
      const edit = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data,
      });
      expect(edit.status(), JSON.stringify(data)).toBe(422);
      const editBody = await edit.json();
      expect(editBody.error).toBe('QUANTITY_LEDGER_WRITE_REFUSED');
      expect(editBody.fields).toEqual(Object.keys(data));
    }
    const afterEdits = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const afterEditsBody = (await afterEdits.json()).data;
    expect(afterEditsBody.currentQuantity).toBe(0);
    expect(afterEditsBody.quantityLedgerVersion).toBe(2);

    // RF006 AC7 (#1315): withdrawals change no status, so they record no decision.
    const beforeClose = await request.get(`${apiBaseURL}/api/samples/${sampleID}/state-decisions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(beforeClose.status()).toBe(200);
    expect((await beforeClose.json()).data).toEqual([]);

    const close = await request.post(`${apiBaseURL}/api/samples/${sampleID}/close`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {},
    });
    expect(close.status()).toBe(200);
    const closeBody = (await close.json()).data;
    expect(closeBody).toEqual(expect.objectContaining({
      previousStatus: 'available',
      specimenStatus: 'closed',
      quantityStatus: 'depleted',
    }));
    expect(closeBody.operationalStateDecisionId).toBeTruthy();
    expect(closeBody.triggerEventId).toBeTruthy();

    const afterClose = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await afterClose.json()).data.specimenStatus).toBe('closed');

    // The close is the one status change, append-only, naming RF026 AC7's rule.
    const decisions = await request.get(`${apiBaseURL}/api/samples/${sampleID}/state-decisions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(decisions.status()).toBe(200);
    const rows = (await decisions.json()).data;
    expect(rows).toEqual([
      expect.objectContaining({
        previousStatus: 'available',
        newStatus: 'closed',
        rulesApplied: ['rf026_ac7_validated_consumption'],
        triggerEventId: closeBody.triggerEventId,
      }),
    ]);

    // closed is final: a second close is refused, and so is a withdrawal.
    const again = await request.post(`${apiBaseURL}/api/samples/${sampleID}/close`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {},
    });
    expect(again.status()).toBe(409);
    expect((await again.json()).error).toBe('SPECIMEN_CLOSE_REFUSED');

    const withdrawClosed = await request.post(`${apiBaseURL}/api/samples/${sampleID}/withdraw`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        withdrawalType: 'Total',
        withdrawalResponsible: 'Custody Test Responsible',
        linkedProject: 'RF006 e2e fixture project',
      },
    });
    expect(withdrawClosed.status()).toBe(400);
    expect((await withdrawClosed.json()).message).toMatch(/closed/);
  });

  test('blocks a withdrawal against a specimen in a blocked lifecycle status, and refuses a v1.3.0 status write (criterion 4)', async ({ request }) => {
    const admin = await realLogin(request);
    const { sampleID } = await seedWithdrawableSample(request, admin);

    // RF006 AC2: destroyed is a v1.3.0 value no write accepts.
    const legacy = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { specimenStatus: 'destroyed' },
    });
    expect(legacy.status()).toBe(422);
    const legacyBody = await legacy.json();
    expect(legacyBody.error).toBe('SPECIMEN_STATUS_WRITE_REFUSED');
    expect(legacyBody.details).toEqual(expect.any(Array));

    const afterLegacy = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await afterLegacy.json()).data.specimenStatus).toBe('available');

    const block = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { specimenStatus: 'unavailable' },
    });
    expect(block.status()).toBe(200);
    expect((await block.json()).data.specimenStatus).toBe('unavailable');

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
    // specimenStatus (#408/#540) is lowercase-canonical.
    expect(body.message).toMatch(/unavailable/);

    // RF006 AC7 (#1315): the accepted edit's status change is recorded; the
    // refused write and the refused withdrawal record none.
    const decisions = await request.get(`${apiBaseURL}/api/samples/${sampleID}/state-decisions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(decisions.status()).toBe(200);
    expect((await decisions.json()).data).toEqual([
      expect.objectContaining({ previousStatus: 'available', newStatus: 'unavailable', rulesApplied: ['manual_status_update'] }),
    ]);
  });

  test('refuses a manual write to quantityStatus and to the RCS result, on edit and on create (RNF018 AC4, #1489, #1526)', async ({ request }) => {
    const admin = await realLogin(request);
    const { sampleID } = await seedWithdrawableSample(request, admin);

    const quantityWrite = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { quantityStatus: 'depleted' },
    });
    expect(quantityWrite.status()).toBe(422);
    const quantityBody = await quantityWrite.json();
    expect(quantityBody.error).toBe('SPECIMEN_STATUS_WRITE_REFUSED');
    expect(quantityBody.message).toMatch(/quantityStatus é derivado/);

    const rcsWrite = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { rcsScore: 99, finalGrade: 'A', gradeRoute: 'Score-based certification', biologicalPenalty: 0, axisPenalties: [] },
    });
    expect(rcsWrite.status()).toBe(422);
    const rcsBody = await rcsWrite.json();
    expect(rcsBody.error).toBe('RCS_DERIVED_WRITE_REFUSED');
    expect(rcsBody.fields).toEqual(['biologicalPenalty', 'rcsScore', 'finalGrade', 'gradeRoute', 'axisPenalties']);

    const governanceWrite = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        modelVersion: 'RCS-GOV-forged',
        matrixType: 'solid',
        governanceStatus: 1,
        governanceFailureReasons: [],
        governanceRuleCodes: [],
        sealedRcsAssessmentId: 'forged-assessment',
      },
    });
    expect(governanceWrite.status()).toBe(422);
    const governanceBody = await governanceWrite.json();
    expect(governanceBody.error).toBe('RCS_DERIVED_WRITE_REFUSED');
    expect(governanceBody.fields).toEqual(['modelVersion', 'matrixType', 'governanceStatus', 'governanceFailureReasons', 'governanceRuleCodes', 'sealedRcsAssessmentId']);

    const after = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const afterData = (await after.json()).data;
    expect(afterData.quantityStatus).toBe('full');
    expect(afterData.rcsScore ?? null).toBeNull();
    expect(afterData.governanceStatus ?? null).toBeNull();
    expect(afterData.sealedRcsAssessmentId ?? null).toBeNull();

    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        quantity: 10,
        boxId: seededStorageBox.boxId,
        positionCode: seededStorageBox.positionCode,
        rcsScore: 99,
        governanceStatus: 1,
      },
    });
    expect(create.status()).toBe(422);
    const createBody = await create.json();
    expect(createBody.error).toBe('RCS_DERIVED_WRITE_REFUSED');
    expect(createBody.fields).toEqual(['rcsScore', 'governanceStatus']);
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
  // (criterion 5). Release is POST /:id/quarantine/release, with evidence,
  // and a PUT to 'available' is refused (#1315, RF019 AC5); the release
  // logs a sample_release audit entry (AC6). specimenStatus is what
  // updateSample's derivation and the withdraw guard actually key off
  // since #409; quarantineReason has no specimenStatus equivalent and
  // stays legacy-sourced (#407/#408) — lifecycleStatus/quarantineStatus
  // were the dual-write bridge (#405), removed in #408. Entering
  // quarantine, like RF006's blocked-status seeding, still goes through
  // the generic update route.
  const seededStorageBoxes: SeededStorageBox[] = [];
  const seededQuarantineActionIds: string[] = [];

  test.afterAll(async () => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await cleanupQuarantineActions(seededQuarantineActionIds).catch(() => {});
    await closeSeedDb();
    await closeOutboxDb();
  });

  async function seedQuarantinableSample(request: import('@playwright/test').APIRequestContext, admin: { token: string }) {
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

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
    const sampleID = (await create.json()).data.specimenId;
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
    // RF019 AC2: quarantine and its release move specimenStatus only; the
    // quantity reading is the same before, during and after.
    const readQuantityStatus = async () => {
      const res = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, { headers: { Authorization: `Bearer ${admin.token}` } });
      expect(res.status()).toBe(200);
      return (await res.json()).data.quantityStatus;
    };
    expect(await readQuantityStatus()).toBe('full');

    const quarantine = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        specimenStatus: 'quarantined',
        quarantineReason: 'RF019 e2e: environmental excursion',
      },
    });
    expect(quarantine.status()).toBe(200);
    expect(await readQuantityStatus()).toBe('full');

    // No token — release is not open to unauthenticated callers.
    const unauthorized = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      data: { specimenStatus: 'available', quarantineReason: 'unauthorized attempt' },
    });
    expect(unauthorized.status()).toBe(401);

    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    // RF019 AC5 (#1315): leaving quarantine is not an edit of the status...
    const edit = await request.put(`${apiBaseURL}/api/samples/${sampleID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { specimenStatus: 'available' },
    });
    expect(edit.status(), await edit.text()).toBe(409);
    expect((await edit.json()).error).toBe('QUARANTINE_RELEASE_REQUIRED');

    // ...nor a release without evidence...
    const releaseUrl = `${apiBaseURL}/api/samples/${sampleID}/quarantine/release`;
    const noEvidence = await request.post(releaseUrl, { headers: { Authorization: `Bearer ${admin.token}` }, data: { evidenceIds: [] } });
    expect(noEvidence.status(), await noEvidence.text()).toBe(422);

    // ...but an authorized release with its evidence, audited.
    const release = await request.post(releaseUrl, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { evidenceIds: ['file-rf019-review'], reason: 'RF019 e2e: cleared after evidence review' },
    });
    expect(release.status(), await release.text()).toBe(200);
    expect((await release.json()).data.specimenStatus).toBe('available');
    const specimen = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect((await specimen.json()).data.specimenStatus).toBe('available');
    const decisions = await request.get(`${apiBaseURL}/api/samples/${sampleID}/state-decisions`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect((await decisions.json()).data.at(-1)).toMatchObject({ newStatus: 'available', rulesApplied: ['quarantine_release'] });
    expect(await readQuantityStatus()).toBe('full');

    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);
  });

  // RF019 AC2, AC4: the record of a quarantine is spread over reads. The
  // QuarantineAction carries the dictionary's seven fields (cause and
  // instant); the rule and the originating event are on the state decision,
  // the event is the ledger movement, and the correlation to the
  // nonconformance is on the sample.
  test('a nonconformance quarantine records its action, rule, originating event and correlation, keeps quantityStatus, and its evidenced release closes the action (RF019 AC2, AC4)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const { sampleID } = await seedQuarantinableSample(request, admin);

    const opened = await request.post(`${apiBaseURL}/api/nonconformances`, {
      headers: auth,
      data: {
        nonconformanceType: 'deviation',
        detectedAt: new Date().toISOString(),
        description: 'RF019 e2e: tubo com rótulo ilegível',
        affectedEntityIds: [sampleID],
      },
    });
    expect(opened.status(), await opened.text()).toBe(201);
    const openedBody = (await opened.json()).data;
    expect(openedBody.quarantinedSpecimenCount).toBe(1);
    const nonconformanceId = String(openedBody.nonconformanceId);
    expect(nonconformanceId).toBeTruthy();

    const actionsRes = await request.get(`${apiBaseURL}/api/samples/${sampleID}/quarantine-actions`, { headers: auth });
    expect(actionsRes.status()).toBe(200);
    const actions = (await actionsRes.json()).data;
    expect(actions).toHaveLength(1);
    const [action] = actions;
    expect(action.specimenIds).toEqual([sampleID]);
    expect(action.reasonCodes).toEqual(['nonconformance']);
    expect(action.actionStatus).toBe('active');
    expect(action.startedAt).toBeTruthy();
    expect(action.releasedAt).toBeNull();

    const sampleRes = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, { headers: auth });
    expect(sampleRes.status()).toBe(200);
    const quarantined = (await sampleRes.json()).data;
    expect(quarantined.specimenStatus).toBe('quarantined');
    expect(quarantined.quantityStatus).toBe('full');
    expect(quarantined.quarantineSource).toBe('nonconformance');
    expect(quarantined.quarantineSourceId).toBe(nonconformanceId);

    const movementsRes = await request.get(`${apiBaseURL}/api/samples/${sampleID}/movements`, { headers: auth });
    expect(movementsRes.status()).toBe(200);
    const quarantineMovements = ((await movementsRes.json()).data as Array<Record<string, unknown>>)
      .filter((movement) => movement.type === 'adjust' && movement.destination === 'Quarentena');
    expect(quarantineMovements).toHaveLength(1);
    const [movement] = quarantineMovements;
    expect(movement.purpose).toBe('nonconformance_quarantine');

    const decisionsRes = await request.get(`${apiBaseURL}/api/samples/${sampleID}/state-decisions`, { headers: auth });
    expect(decisionsRes.status()).toBe(200);
    expect((await decisionsRes.json()).data.at(-1)).toMatchObject({
      previousStatus: 'available',
      newStatus: 'quarantined',
      rulesApplied: ['nonconformance_quarantine'],
      reasonCodes: ['nonconformance'],
      // SampleMovement stores its id as movementId; the decision keeps it as a string.
      triggerEventId: String(movement.movementId),
    });

    const release = await request.post(`${apiBaseURL}/api/samples/${sampleID}/quarantine/release`, {
      headers: auth,
      data: { evidenceIds: ['file-rf019-nc-review'], reason: 'RF019 e2e: nonconformance reviewed and cleared' },
    });
    expect(release.status(), await release.text()).toBe(200);
    const released = (await release.json()).data;
    expect(released.releasedActions[0].quarantineActionId).toBe(action.quarantineActionId);
    expect(released.evidenceIds).toEqual(['file-rf019-nc-review']);

    const afterRes = await request.get(`${apiBaseURL}/api/samples/${sampleID}/quarantine-actions`, { headers: auth });
    expect(afterRes.status()).toBe(200);
    const closed = ((await afterRes.json()).data as Array<Record<string, unknown>>)
      .find((candidate) => candidate.quarantineActionId === action.quarantineActionId);
    expect(closed).toBeDefined();
    expect(closed!.actionStatus).toBe('released');
    expect(closed!.releasedAt).toBeTruthy();
    expect(closed!.authorizedBy).toBe(String(admin.user._id));

    // #1510 (RF019 AC6): the release appended one QUARANTINE_RELEASED outbox
    // event. No status is asserted: the projector has no handler for it yet.
    const releaseEvents = (await quarantineActionOutboxEvents(String(action.quarantineActionId)))
      .filter((event) => event.eventType === 'QUARANTINE_RELEASED');
    expect(releaseEvents).toHaveLength(1);
    expect(releaseEvents[0].sourceService).toBe('quarantine-release');
    expect(releaseEvents[0].payload).toMatchObject({
      quarantineActionId: action.quarantineActionId,
      specimenIds: [sampleID],
      reasonCodes: ['nonconformance'],
      actionStatus: 'released',
      authorizedBy: String(admin.user._id),
      evidenceIds: ['file-rf019-nc-review'],
    });
    expect(releaseEvents[0].payload.releasedAt).toBeTruthy();

    const afterRelease = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, { headers: auth });
    expect((await afterRelease.json()).data.quantityStatus).toBe('full');
  });

  // RF019 AC1, AC4 (#1510): an intake whose quality governance fails stores
  // the specimen quarantined, and the intake route records the action.
  test('a quality governance failure at intake quarantines the specimen with a route-created QuarantineAction, keeps quantityStatus, and its evidenced release closes it (RF019 AC1, AC2, AC4)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    // The intake's automatic placement needs a usable box.
    seededStorageBoxes.push(await seedStorageBoxLocation());

    const intake = await request.post(`${apiBaseURL}/api/intake-wizard`, {
      headers: auth,
      // No SPREC: the missing critical metadata is the governance failure
      // (governance_status 0, final grade E).
      data: {
        participant: { participantId: participant.participantId },
        consent: { consentTemplateId: participant.consentTemplateId },
        specimen: {
          specimenId: 'placeholder',
          participantId: participant.participantId,
          sampleType: 'PLASMA',
          sampleOrigin: 'VENOUS_BLOOD',
          extractionProtocol: 'TUBE_EDTA',
          quantity: 5,
          linkedProject: 'RF019 e2e governance failure',
        },
        clinical: {},
        biomarkers: [],
      },
    });
    expect(intake.status(), await intake.text()).toBe(200);
    const body = await intake.json();
    expect(body.consent.active).toBe(true);
    expect(body.qualityAssessment.governance_status).toBe(0);
    expect(body.qualityAssessment.final_grade).toBe('E');
    expect(body.sample.specimenStatus).toBe('quarantined');
    expect(body.sample.quarantineReason).toBe('QUALITY_GOVERNANCE_FAILURE');
    const sampleID = String(body.sample.specimenId);

    const actionsRes = await request.get(`${apiBaseURL}/api/samples/${sampleID}/quarantine-actions`, { headers: auth });
    expect(actionsRes.status()).toBe(200);
    const actions = (await actionsRes.json()).data;
    expect(actions).toHaveLength(1);
    const [action] = actions;
    expect(action.specimenIds).toEqual([sampleID]);
    expect(action.reasonCodes).toEqual(['QUALITY_GOVERNANCE_FAILURE']);
    expect(action.actionStatus).toBe('active');
    expect(action.startedAt).toBeTruthy();
    expect(action.releasedAt).toBeNull();

    const sampleRes = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, { headers: auth });
    expect(sampleRes.status()).toBe(200);
    const quarantined = (await sampleRes.json()).data;
    expect(quarantined.specimenStatus).toBe('quarantined');
    expect(quarantined.quantityStatus).toBe('full');

    const release = await request.post(`${apiBaseURL}/api/samples/${sampleID}/quarantine/release`, {
      headers: auth,
      data: { evidenceIds: ['file-rf019-governance-review'], reason: 'RF019 e2e: governance failure reviewed' },
    });
    expect(release.status(), await release.text()).toBe(200);
    expect((await release.json()).data.releasedActions[0].quarantineActionId).toBe(action.quarantineActionId);

    const afterRes = await request.get(`${apiBaseURL}/api/samples/${sampleID}/quarantine-actions`, { headers: auth });
    expect(afterRes.status()).toBe(200);
    const closed = ((await afterRes.json()).data as Array<Record<string, unknown>>)
      .find((candidate) => candidate.quarantineActionId === action.quarantineActionId);
    expect(closed).toBeDefined();
    expect(closed!.actionStatus).toBe('released');
    expect(closed!.authorizedBy).toBe(String(admin.user._id));

    const afterRelease = await request.get(`${apiBaseURL}/api/samples/${sampleID}`, { headers: auth });
    expect((await afterRelease.json()).data.quantityStatus).toBe('full');
  });
  // #1219: every QuarantineAction writer recorded the sample's Mongo _id, and
  // this read queried the canonical specimenId, so it could not return a
  // single real action. New actions carry the specimenId. The read matches
  // both, because every row written before #1219 carries the _id.
  test('#1219: GET /:id/quarantine-actions returns an action recorded under the sample _id and one under its specimenId', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const { sampleID: specimenId } = await seedQuarantinableSample(request, admin);
    const auth = { Authorization: `Bearer ${admin.token}` };

    const sampleDoc = await request.get(`${apiBaseURL}/api/samples/${specimenId}`, { headers: auth });
    expect(sampleDoc.status()).toBe(200);
    const mongoId = String((await sampleDoc.json()).data._id);
    expect(mongoId).not.toBe(specimenId);

    const legacyId = await seedQuarantineAction([mongoId], 'E2E_1219_LEGACY');
    const canonicalId = await seedQuarantineAction([specimenId], 'E2E_1219_CANONICAL');
    seededQuarantineActionIds.push(legacyId, canonicalId);

    const res = await request.get(`${apiBaseURL}/api/samples/${specimenId}/quarantine-actions`, { headers: auth });
    expect(res.status()).toBe(200);
    const ids = ((await res.json()).data as Array<{ quarantineActionId: string }>).map((a) => a.quarantineActionId);
    expect(ids).toEqual(expect.arrayContaining([legacyId, canonicalId]));
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

  // #1524: the governance evidence test creates a real sample in a seeded
  // box and seeds the records its references resolve against.
  const seededStorageBoxes: SeededStorageBox[] = [];

  test.afterAll(async () => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await cleanupGovernanceEvidence().catch(() => {});
    await closeSeedDb();
    await closeOutboxDb();
    await closeGovernanceEvidenceDb();
  });

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

  test('refuses certification when an axis is missing or its code is incompatible with the matrix (RNF018 AC5, #1489)', async ({ request }) => {
    const admin = await realLogin(request);
    const { longTermStorage: _omitted, ...missingAxis } = fluidSprec();
    const cases = [
      { sprec: missingAxis, reason: 'Missing critical metadata', ruleCode: 'MISSING_CRITICAL_METADATA' },
      { sprec: fluidSprec({ preCentrifugation: 'Q' }), reason: 'SPREC code incompatible with matrix or axis', ruleCode: 'MATRIX_INCOMPATIBLE_CODE' },
    ];

    for (const { sprec, reason, ruleCode } of cases) {
      const response = await request.post(`${apiBaseURL}/api/quality/preview`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { matrixType: sprec.matrixType, sprec },
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.governance_status).toBe(0);
      expect(body.data.final_grade).toBe('E');
      expect(body.data.grade_route).toBe('Governance failure');
      expect(body.data.rcs_score).toBeNull();
      expect(body.data.governance_failure_reasons).toContain(reason);
      expect(body.data.governance_rule_codes).toContain(ruleCode);
    }
  });

  test('refuses certification for each governance evidence with a missing hash or an unresolvable URI, and reads all three when they resolve (RNF018 AC5, #1524)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    // A real sample, created as the RF006 describe's seedWithdrawableSample does.
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;
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
    const specimenId: string = (await create.json()).data.specimenId;

    // Its custody event, a telemetry summary of it and an approval document.
    const events = await sampleOutboxEvents(await sampleMongoId(specimenId));
    const custody = events.find((event) => event.eventType === 'CUSTODY_EVENT_RECORDED');
    expect(custody).toBeTruthy();
    const summary = await seedTelemetrySummary(specimenId);
    const approval = await seedApprovalDocument();

    type Ref = { uri: string; hash?: string };
    const valid = (): Record<'traceability' | 'monitoring' | 'documentation', Ref[]> => ({
      traceability: [{ uri: `urn:bioavanced:custody-event:${custody!.eventId}`, hash: `sha256:${custody!.payloadHash}` }],
      monitoring: [{ uri: `urn:bioavanced:telemetry-exposure-summary:${summary.telemetryExposureSummaryId}`, hash: summary.sourceReadingSetHash }],
      documentation: [{ uri: `urn:bioavanced:collection-governance-approval:${approval.approvalId}`, hash: approval.documentChecksum }],
    });
    const preview = async (extra: Record<string, unknown>) => {
      const response = await request.post(`${apiBaseURL}/api/quality/preview`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { matrixType: 'fluid', sprec: fluidSprec(), specimenId, ...extra },
      });
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    };

    const passed = await preview({ governanceEvidence: valid() });
    expect(passed.governance_status).toBe(1);
    expect(passed.grade_route).toBe('Score-based certification');
    expect(passed.final_grade).toBe('A');
    expect(passed.governance_evidence.traceabilityOk).toBe(true);
    expect(passed.governance_evidence.monitoringOk).toBe(true);
    expect(passed.governance_evidence.documentationOk).toBe(true);
    expect(passed.governance_evidence.semanticCompatible).toBe(true);
    expect(passed.governance_evidence.gateResult).toBe('pass');

    const categories = [
      { category: 'traceability', reason: 'Insufficient traceability', ruleCode: 'INSUFFICIENT_TRACEABILITY', flag: 'traceabilityOk' },
      { category: 'monitoring', reason: 'Missing required monitoring', ruleCode: 'MISSING_REQUIRED_MONITORING', flag: 'monitoringOk' },
      { category: 'documentation', reason: 'Insufficient documentation', ruleCode: 'INSUFFICIENT_DOCUMENTATION', flag: 'documentationOk' },
    ] as const;
    for (const { category, reason, ruleCode, flag } of categories) {
      const missingHash = valid();
      delete missingHash[category][0].hash;
      const unresolvable = valid();
      unresolvable[category][0].uri = unresolvable[category][0].uri.replace(/:[^:]+$/, ':no-such-record-1524');

      for (const governanceEvidence of [missingHash, unresolvable]) {
        const refused = await preview({ governanceEvidence });
        expect(refused.governance_status).toBe(0);
        expect(refused.final_grade).toBe('E');
        expect(refused.grade_route).toBe('Governance failure');
        expect(refused.governance_failure_reasons).toContain(reason);
        expect(refused.governance_rule_codes).toContain(ruleCode);
        expect(refused.governance_evidence[flag]).toBe(false);
      }
    }

    // A resolution the client sends is never read: no criterion passes from it.
    const resolved = (refs: Ref[]) => refs.map((ref) => ({ ...ref, status: 'resolved' }));
    const references = valid();
    const forged = await preview({
      governanceEvidenceResolution: {
        traceability: resolved(references.traceability),
        monitoring: resolved(references.monitoring),
        documentation: resolved(references.documentation),
      },
    });
    expect(forged.governance_status).toBe(1);
    expect(forged.governance_evidence.traceabilityOk).toBeNull();
    expect(forged.governance_evidence.monitoringOk).toBeNull();
    expect(forged.governance_evidence.documentationOk).toBeNull();
  });

  test('a sample registration resolves its governance evidence references, and refuses certification for a missing hash or an unresolvable URI (RNF018 AC5, #1524)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const approval = await seedApprovalDocument();
    const approvalUri = `urn:bioavanced:collection-governance-approval:${approval.approvalId}`;

    type Ref = { uri: string; hash?: string };
    // Registers a sample through POST /api/samples with the documentation
    // references given, and returns the RcsAssessment its create recorded.
    const register = async (documentation: Ref[]) => {
      const seededStorageBox = await seedStorageBoxLocation();
      seededStorageBoxes.push(seededStorageBox);
      const { boxId, positionCode } = seededStorageBox;
      const create = await request.post(`${apiBaseURL}/api/samples`, {
        headers: auth,
        data: {
          participantId: participant.participantId,
          ...validSampleFields(),
          quantity: 10,
          boxId,
          positionCode,
          sprec: fluidSprec(),
          governanceEvidence: { documentation },
        },
      });
      expect([201, 202]).toContain(create.status());
      const specimenId: string = (await create.json()).data.specimenId;
      const assessments = await request.get(`${apiBaseURL}/api/samples/${specimenId}/rcs-assessments`, { headers: auth });
      expect(assessments.status()).toBe(200);
      const rows = (await assessments.json()).data;
      expect(rows).toHaveLength(1);
      return rows[0];
    };

    const accepted = await register([{ uri: approvalUri, hash: approval.documentChecksum }]);
    expect(accepted.governanceStatus).toBe(1);
    expect(accepted.finalGrade).toBe('A');

    const missingHash: Ref[] = [{ uri: approvalUri }];
    const unresolvable: Ref[] = [{ uri: 'urn:bioavanced:collection-governance-approval:no-such-record-1524', hash: approval.documentChecksum }];
    for (const documentation of [missingHash, unresolvable]) {
      const refused = await register(documentation);
      expect(refused.governanceStatus).toBe(0);
      expect(refused.finalGrade).toBe('E');
      expect(refused.governanceRuleCodes).toContain('INSUFFICIENT_DOCUMENTATION');
    }
  });

  test('an intake resolves its governance evidence references, and refuses certification and quarantines the specimen for a missing hash or an unresolvable URI (RNF018 AC5, #1524)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    await seedActiveConsent(participant.participantId);
    const approval = await seedApprovalDocument();
    const approvalUri = `urn:bioavanced:collection-governance-approval:${approval.approvalId}`;

    type Ref = { uri: string; hash?: string };
    // Registers a specimen through POST /api/intake-wizard with the
    // documentation references given; returns the intake's body and the
    // RcsAssessments its create and the intake recorded.
    const intake = async (documentation: Ref[]) => {
      // The intake's automatic placement needs a usable box.
      seededStorageBoxes.push(await seedStorageBoxLocation());
      const response = await request.post(`${apiBaseURL}/api/intake-wizard`, {
        headers: auth,
        data: {
          participant: { participantId: participant.participantId },
          consent: { consentTemplateId: participant.consentTemplateId },
          specimen: {
            specimenId: 'placeholder',
            participantId: participant.participantId,
            sampleType: 'PLASMA',
            sampleOrigin: 'VENOUS_BLOOD',
            extractionProtocol: 'TUBE_EDTA',
            quantity: 5,
            linkedProject: 'RNF018 e2e intake governance evidence',
            sprec: { code: 'BLD-SST-A-A-A-A-C', version: '1.0', ...fluidSprec() },
          },
          clinical: {},
          biomarkers: [],
          governanceEvidence: { documentation },
        },
      });
      expect(response.status(), await response.text()).toBe(200);
      const body = await response.json();
      const specimenId = String(body.sample.specimenId);
      const assessments = await request.get(`${apiBaseURL}/api/samples/${specimenId}/rcs-assessments`, { headers: auth });
      expect(assessments.status()).toBe(200);
      const rows: Array<Record<string, unknown>> = (await assessments.json()).data;
      expect(rows.length).toBeGreaterThan(0);
      return { body, rows };
    };

    const accepted = await intake([{ uri: approvalUri, hash: approval.documentChecksum }]);
    expect(accepted.body.qualityAssessment.governance_status).toBe(1);
    expect(accepted.body.qualityAssessment.final_grade).toBe('A');
    for (const row of accepted.rows) expect(row.governanceStatus).toBe(1);

    const missingHash: Ref[] = [{ uri: approvalUri }];
    const unresolvable: Ref[] = [{ uri: 'urn:bioavanced:collection-governance-approval:no-such-record-1524', hash: approval.documentChecksum }];
    for (const documentation of [missingHash, unresolvable]) {
      const refused = await intake(documentation);
      expect(refused.body.qualityAssessment.governance_status).toBe(0);
      expect(refused.body.qualityAssessment.final_grade).toBe('E');
      expect(refused.body.qualityAssessment.governance_rule_codes).toContain('INSUFFICIENT_DOCUMENTATION');
      expect(refused.body.sample.specimenStatus).toBe('quarantined');
      expect(refused.body.sample.quarantineReason).toBe('QUALITY_GOVERNANCE_FAILURE');
      for (const row of refused.rows) {
        expect(row.governanceStatus).toBe(0);
        expect(row.governanceRuleCodes).toContain('INSUFFICIENT_DOCUMENTATION');
      }
    }
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
  const seededStorageBoxes: SeededStorageBox[] = [];

  test.afterAll(async () => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await closeSeedDb();
  });

  async function createRealSample(request: any, token: string): Promise<{ specimenId: string; barcode: string }> {
    const participant = await createRealParticipant(request, apiBaseURL!, token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { participantId: participant.participantId, ...validSampleFields(), boxId, positionCode },
    });
    expect([201, 202]).toContain(create.status());
    const body = (await create.json()).data;

    const get = await request.get(`${apiBaseURL}/api/samples/${body.specimenId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sample = (await get.json()).data;
    return { specimenId: body.specimenId, barcode: sample.barcode };
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
      data: { specimenIds: [sampleA.specimenId, sampleB.specimenId, 'does-not-exist'] },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()).data;

    expect(body.total).toBe(3);
    expect(body.generated).toBe(2);
    expect(body.failed).toBe(1);

    const resultA = body.results.find((r: any) => r.specimenId === sampleA.specimenId);
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
  const seededStorageBoxes: SeededStorageBox[] = [];

  test.afterAll(async () => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
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
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { participantId: participant.participantId, ...validSampleFields(), boxId, positionCode },
    });
    expect([201, 202]).toContain(create.status());
    const sampleID = (await create.json()).data.specimenId;

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
  const seededStorageBoxes: SeededStorageBox[] = [];

  test.afterAll(async () => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    await closeSeedDb();
  });

  test('rejects position validation against a RETIRED storage box (criterion 7)', async ({ request }) => {
    const admin = await realLogin(request);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId } = seededStorageBox;
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
    seededStorageBoxes.push(origin);
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
    const sampleId = (await create.json()).data.specimenId;

    const destination = await seedStorageBoxLocation();
    seededStorageBoxes.push(destination);
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
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, rackId } = seededStorageBox;
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
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId } = seededStorageBox;

    const res = await request.get(`${apiBaseURL}/api/storage/validate/${boxId}/A1`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
  });
});

// Wave 3 (#646). RF025's 6 acceptance criteria (requisitos-index.md) --
// AC#1 (link specimen/protocol/operator/laboratory) already existed from
// #641's Assay slice 1 (format-only validation, no e2e proof until now).
// AC#2 (reagent lots)/AC#3 (equipment)/AC#4 (structured controls) are new
// fields this slice added to Assay.js -- dict-02 types `controls` only as
// an untyped BackboneElement[], so `controlType`/`result`/`reagentLotId`/
// `notes` are a local design decision (see Assay.js's own header comment).
// AC#5 (open nonconformance + corrective action)/AC#6 (preserve cause,
// action, responsible, effectiveness verification) are the new
// Nonconformance entity -- dict-02's own `capaId` reference points at a
// `CAPA` entity the dictionary never defines, so the corrective action is
// embedded rather than a separate collection (Nonconformance.js's own
// header comment).
test.describe('Assay quality — reagents, equipment, controls, non-conformance (RF025) — real backend', () => {
  const seededStorageBoxes: SeededStorageBox[] = [];
  // #730: the equipment created here is a direct POST /api/equipment, not
  // through seedStorageBoxLocation() -- cleaned up via the API (like
  // human-showcase.spec.ts's own equipment fixture), not cleanupStorageBoxLocation.
  const equipmentIdsToDelete: string[] = [];
  // #1282: the laboratories these tests create, deleted last.
  const organizationIdsToDelete: string[] = [];

  test.afterAll(async ({ request }) => {
    await Promise.all(
      seededStorageBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {}))
    );
    if (equipmentIdsToDelete.length > 0) {
      const admin = await realLogin(request).catch(() => null);
      if (admin) {
        await Promise.all(
          equipmentIdsToDelete.map((id) =>
            request.delete(`${apiBaseURL}/api/equipment/${id}`, {
              headers: { Authorization: `Bearer ${admin.token}` },
            }).catch(() => {})
          )
        );
      }
    }
    await deleteOrganizations(request, apiBaseURL!, organizationIdsToDelete);
    await closeSeedDb();
  });

  test('registers an assay linking specimen, protocol, operator, laboratory, reagent lots, equipment, and controls (criteria 1-4)', async ({ request }) => {
    const admin = await realLogin(request);
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const studyId = `rf025-study-${suffix}`;
    const protocolId = `rf025-protocol-${suffix}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId);

    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;
    const sampleRes = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { participantId: participant.participantId, ...validSampleFields(), boxId, positionCode },
    });
    expect(sampleRes.status(), await sampleRes.text()).toBe(201);
    // #1216/#1219: an assay references the specimen by the canonical
    // specimenId the create response names, and stores it as given.
    const specimenId = String((await sampleRes.json()).data.specimenId);

    const reagentRes = await request.post(`${apiBaseURL}/api/reagent-lots`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { reagentName: 'Primer Mix A', lotNumber: `LOT-${suffix}` },
    });
    expect(reagentRes.status(), await reagentRes.text()).toBe(201);
    const reagentId = (await reagentRes.json()).data.reagentId;

    const equipmentRes = await request.post(`${apiBaseURL}/api/equipment`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { equipmentDescription: `RF025 thermocycler ${suffix}`, name: `Thermocycler ${suffix}`, type: 'Analytical', status: 'Active' },
    });
    expect(equipmentRes.status(), await equipmentRes.text()).toBe(201);
    const equipmentCreated = (await equipmentRes.json()).data;
    const equipmentID = equipmentCreated.equipmentID;
    // Delete by Mongo _id, not equipmentID -- generateUniqueEquipmentID
    // (equipmentIDGenerator.js) can hand back a non-numeric equipmentID
    // when the collection holds string-typed equipmentID debris (see
    // seedStorageBoxLocation's own equipment fixture), which the DELETE
    // route's ObjectId-then-numeric-equipmentID fallback can't resolve.
    equipmentIdsToDelete.push(String(equipmentCreated._id));

    // #664: laboratoryId now resolves to a real Organization.
    const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        officialName: `RF025 Lab ${suffix}`,
        acronym: 'RF025',
        organizationType: 'biobank',
        countryCode: 'BR',
      },
    });
    expect(orgRes.status(), await orgRes.text()).toBe(201);
    const organizationId = (await orgRes.json()).data.organizationId;
    organizationIdsToDelete.push(organizationId);

    const assayRes = await request.post(`${apiBaseURL}/api/assays`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        studyId,
        specimenIds: [specimenId],
        assayType: 'RNA sequencing',
        protocolId,
        operatorId: String(admin.user._id),
        laboratoryId: organizationId,
        assayDateTime: new Date().toISOString(),
        intendedUse: 'RF025 e2e proof',
        reagentLotIds: [reagentId],
        equipmentIds: [String(equipmentID)],
        controls: [{ controlType: 'positive', result: 'pass', reagentLotId: reagentId }],
      },
    });
    expect(assayRes.status(), await assayRes.text()).toBe(201);
    const assay = (await assayRes.json()).data;

    expect(assay.specimenIds).toEqual([specimenId]);
    expect(assay.protocolId).toBe(protocolId);
    expect(assay.reagentLotIds).toEqual([reagentId]);
    expect(assay.equipmentIds).toEqual([String(equipmentID)]);
    expect(assay.controls).toEqual([{ controlType: 'positive', result: 'pass', reagentLotId: reagentId, notes: null }]);
  });

  // #664: specimenIds/operatorId/laboratoryId now resolve to real records
  // (see the two "rejects ... referential" tests below) -- every test past
  // this point needs a real specimen/operator/organization fixture, not the
  // placeholder strings this file used before that referential check existed.
  async function seedRealAssayLinkage(request: any, admin: any) {
    const participant = await createRealParticipant(request, apiBaseURL!, admin.token);
    const seededStorageBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(seededStorageBox);
    const { boxId, positionCode } = seededStorageBox;
    const sampleRes = await request.post(`${apiBaseURL}/api/samples`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { participantId: participant.participantId, ...validSampleFields(), boxId, positionCode },
    });
    expect(sampleRes.status(), await sampleRes.text()).toBe(201);
    // #1216/#1219: an assay references the specimen by the canonical
    // specimenId the create response names, and stores it as given.
    const specimenId = String((await sampleRes.json()).data.specimenId);

    const orgRes = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        officialName: `RF025 Lab ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        acronym: 'RF025',
        organizationType: 'biobank',
        countryCode: 'BR',
      },
    });
    expect(orgRes.status(), await orgRes.text()).toBe(201);
    const organizationId = (await orgRes.json()).data.organizationId;
    organizationIdsToDelete.push(organizationId);

    return { specimenId, operatorId: String(admin.user._id), organizationId, participantId: participant.participantId };
  }

  // RF019 AC3: a quarantined specimen is not processed. An assay naming it
  // and a derivative naming it as its parent are both refused.
  test('a quarantined specimen is refused for processing: an assay and a derivative naming it (RF019 AC3)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const studyId = `rf025-study-${suffix}`;
    const protocolId = `rf025-protocol-${suffix}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId);
    const { specimenId, operatorId, organizationId, participantId } = await seedRealAssayLinkage(request, admin);

    const quarantine = await request.put(`${apiBaseURL}/api/samples/${specimenId}`, {
      headers: auth,
      data: { specimenStatus: 'quarantined', quarantineReason: 'RF019 e2e: processing block' },
    });
    expect(quarantine.status(), await quarantine.text()).toBe(200);

    const assayRes = await request.post(`${apiBaseURL}/api/assays`, {
      headers: auth,
      data: {
        studyId,
        specimenIds: [specimenId],
        assayType: 'RNA sequencing',
        protocolId,
        operatorId,
        laboratoryId: organizationId,
        assayDateTime: new Date().toISOString(),
        intendedUse: 'RF019 e2e quarantined specimen',
      },
    });
    expect(assayRes.status(), await assayRes.text()).toBe(409);
    expect((await assayRes.json()).message).toMatch(/em quarentena e não pode ser processado/);

    const derivativeBox = await seedStorageBoxLocation();
    seededStorageBoxes.push(derivativeBox);
    const derivativeRes = await request.post(`${apiBaseURL}/api/samples`, {
      headers: auth,
      data: {
        participantId,
        ...validSampleFields(),
        boxId: derivativeBox.boxId,
        positionCode: derivativeBox.positionCode,
        parentSpecimenIds: [specimenId],
      },
    });
    expect(derivativeRes.status(), await derivativeRes.text()).toBe(422);
    expect((await derivativeRes.json()).message).toMatch(/em quarentena/);
  });

  test('rejects a control entry with no valid controlType (criterion 4)', async ({ request }) => {
    const admin = await realLogin(request);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const studyId = `rf025-study-${suffix}`;
    const protocolId = `rf025-protocol-${suffix}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId);
    const { specimenId, operatorId, organizationId } = await seedRealAssayLinkage(request, admin);

    const assayRes = await request.post(`${apiBaseURL}/api/assays`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        studyId,
        specimenIds: [specimenId],
        assayType: 'RNA sequencing',
        protocolId,
        operatorId,
        laboratoryId: organizationId,
        assayDateTime: new Date().toISOString(),
        intendedUse: 'RF025 e2e negative case',
        controls: [{ result: 'pass' }],
      },
    });
    expect(assayRes.status()).toBe(422);
    const body = await assayRes.json();
    expect(body.details.join(' ')).toContain('controlType');
  });

  test('#664: rejects an assay create when specimenIds does not resolve to a real sample', async ({ request }) => {
    const admin = await realLogin(request);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const studyId = `rf025-study-${suffix}`;
    const protocolId = `rf025-protocol-${suffix}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId);
    const { operatorId, organizationId } = await seedRealAssayLinkage(request, admin);

    const assayRes = await request.post(`${apiBaseURL}/api/assays`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        studyId,
        specimenIds: ['specimen-does-not-exist'],
        assayType: 'RNA sequencing',
        protocolId,
        operatorId,
        laboratoryId: organizationId,
        assayDateTime: new Date().toISOString(),
        intendedUse: 'RF025 e2e referential-integrity negative case',
      },
    });
    expect(assayRes.status()).toBe(404);
    const body = await assayRes.json();
    expect(body.message).toMatch(/specimenIds/);
  });

  // #1221: PUT ran none of #664's reference checks, so an assay created
  // with verified links could be edited to name a specimen that does not
  // exist.
  test('#1221: rejects an assay update whose specimenIds do not resolve, and leaves the assay unchanged', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const studyId = `rf025-study-${suffix}`;
    const protocolId = `rf025-protocol-${suffix}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId);
    const { specimenId, operatorId, organizationId } = await seedRealAssayLinkage(request, admin);

    const created = await request.post(`${apiBaseURL}/api/assays`, {
      headers: auth,
      data: {
        studyId,
        specimenIds: [specimenId],
        assayType: 'RNA sequencing',
        protocolId,
        operatorId,
        laboratoryId: organizationId,
        assayDateTime: new Date().toISOString(),
        intendedUse: '#1221 e2e update integrity',
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const assayId = (await created.json()).data.assayId;

    const update = await request.put(`${apiBaseURL}/api/assays/${assayId}`, {
      headers: auth,
      data: { specimenIds: ['specimen-does-not-exist'] },
    });
    expect(update.status()).toBe(404);
    expect((await update.json()).message).toMatch(/specimenIds/);

    const after = await request.get(`${apiBaseURL}/api/assays/${assayId}`, { headers: auth });
    expect(after.status()).toBe(200);
    expect((await after.json()).data.specimenIds).toEqual([specimenId]);
  });

  test('#664: rejects an assay create when laboratoryId does not resolve to a real Organization', async ({ request }) => {
    const admin = await realLogin(request);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const studyId = `rf025-study-${suffix}`;
    const protocolId = `rf025-protocol-${suffix}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId);
    const { specimenId, operatorId } = await seedRealAssayLinkage(request, admin);

    const assayRes = await request.post(`${apiBaseURL}/api/assays`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        studyId,
        specimenIds: [specimenId],
        assayType: 'RNA sequencing',
        protocolId,
        operatorId,
        laboratoryId: 'org-does-not-exist',
        assayDateTime: new Date().toISOString(),
        intendedUse: 'RF025 e2e referential-integrity negative case',
      },
    });
    expect(assayRes.status()).toBe(404);
    const body = await assayRes.json();
    expect(body.message).toMatch(/laboratoryId/);
  });

  test('opens a non-conformance, records the corrective action, and verifies effectiveness (criteria 5-6)', async ({ request }) => {
    const admin = await realLogin(request);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const studyId = `rf025-study-${suffix}`;
    const protocolId = `rf025-protocol-${suffix}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId);
    const { specimenId, operatorId, organizationId } = await seedRealAssayLinkage(request, admin);

    const assayRes = await request.post(`${apiBaseURL}/api/assays`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        studyId,
        specimenIds: [specimenId],
        assayType: 'RNA sequencing',
        protocolId,
        operatorId,
        laboratoryId: organizationId,
        assayDateTime: new Date().toISOString(),
        intendedUse: 'RF025 non-conformance fixture',
      },
    });
    expect(assayRes.status(), await assayRes.text()).toBe(201);
    const assayId = (await assayRes.json()).data.assayId;

    // AC#5: abre a não conformidade.
    const openRes = await request.post(`${apiBaseURL}/api/nonconformances`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        nonconformanceType: 'deviation',
        detectedAt: new Date().toISOString(),
        description: 'Temperatura do freezer fora da faixa durante o ensaio',
        affectedEntityIds: [assayId],
        rootCause: 'Falha no sensor de temperatura do freezer',
      },
    });
    expect(openRes.status(), await openRes.text()).toBe(201);
    const nonconformance = (await openRes.json()).data;
    expect(nonconformance.status).toBe('open');
    expect(nonconformance.detectedBy).toBeTruthy();
    expect(nonconformance.rootCause).toBe('Falha no sensor de temperatura do freezer');

    // Effectiveness verification must be refused before a corrective
    // action exists (service-level ordering, proven end-to-end here).
    const earlyVerify = await request.post(`${apiBaseURL}/api/nonconformances/${nonconformance.nonconformanceId}/verify-effectiveness`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { outcome: 'effective' },
    });
    expect(earlyVerify.status()).toBe(400);

    // AC#5/#6: registra a ação corretiva e o responsável.
    const correctiveRes = await request.post(`${apiBaseURL}/api/nonconformances/${nonconformance.nonconformanceId}/corrective-action`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { description: 'Recalibrar sensor de temperatura e revisar protocolo de controle', responsible: 'user-rf025-coordenador' },
    });
    expect(correctiveRes.status(), await correctiveRes.text()).toBe(200);
    const withCorrectiveAction = (await correctiveRes.json()).data;
    expect(withCorrectiveAction.status).toBe('corrective_action_recorded');
    expect(withCorrectiveAction.correctiveAction.responsible).toBe('user-rf025-coordenador');

    // AC#6: preserva a verificação de eficácia.
    const verifyRes = await request.post(`${apiBaseURL}/api/nonconformances/${nonconformance.nonconformanceId}/verify-effectiveness`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { outcome: 'effective', notes: 'Confirmado em nova rodada de controle' },
    });
    expect(verifyRes.status(), await verifyRes.text()).toBe(200);
    const closed = (await verifyRes.json()).data;
    expect(closed.status).toBe('closed');
    expect(closed.closureDate).toBeTruthy();
    expect(closed.effectivenessVerification.outcome).toBe('effective');
    expect(closed.effectivenessVerification.verifiedBy).toBeTruthy();

    // Full record still preserves cause/action/responsible/verification together (AC#6).
    const getRes = await request.get(`${apiBaseURL}/api/nonconformances/${nonconformance.nonconformanceId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const stored = (await getRes.json()).data;
    expect(stored.rootCause).toBeTruthy();
    expect(stored.correctiveAction.responsible).toBeTruthy();
    expect(stored.effectivenessVerification.outcome).toBe('effective');

    // RF019 AC1 (#1315): a nonconformance naming the specimen quarantines it,
    // with the rule on its state decision; the assay id quarantined nothing.
    const onSpecimen = await request.post(`${apiBaseURL}/api/nonconformances`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        nonconformanceType: 'deviation',
        detectedAt: new Date().toISOString(),
        description: 'Hemólise visível no tubo após o ensaio',
        affectedEntityIds: [specimenId],
      },
    });
    expect(onSpecimen.status(), await onSpecimen.text()).toBe(201);
    expect((await onSpecimen.json()).data.quarantinedSpecimenCount).toBe(1);
    const specimen = await request.get(`${apiBaseURL}/api/samples/${specimenId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await specimen.json()).data.specimenStatus).toBe('quarantined');
    const decisions = await request.get(`${apiBaseURL}/api/samples/${specimenId}/state-decisions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await decisions.json()).data).toEqual([
      expect.objectContaining({ newStatus: 'quarantined', rulesApplied: ['nonconformance_quarantine'] }),
    ]);
  });
});

// Wave 3 (#646). RF026's 6 acceptance criteria (requisitos-index.md) --
// AC#1 (RetentionPolicy, already built by RF014/#440) is reused as-is;
// this slice's own scope is the disposition/execution side, 100%
// greenfield. dict-02's DispositionAction (ELM-0411..0415) has no field
// for "responsável"/"itens afetados" (AC#4) -- `performedBy`/
// `affectedRecordIds` are local extensions (DispositionAction.js's own
// header comment). AC#5's certificate is the persisted record itself,
// reachable at a stable sub-resource -- no real object-storage/PDF
// generation exists in this repo to build against honestly.
test.describe('Retention and disposition (RF026) — real backend', () => {
  test.afterAll(async () => {
    await closeSeedDb();
  });

  async function createRetentionPolicy(request: any, admin: { token: string }, overrides: Record<string, unknown> = {}) {
    const res = await request.post(`${apiBaseURL}/api/retention-policies`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        applicableEntityTypes: ['Log'],
        triggerEvent: 'creation',
        postRetentionAction: 'destroy',
        retentionPeriod: 'P365D',
        // RF026 AC1/AC2 (#1315): jurisdiction, basis, legal-hold rules and review are required.
        jurisdiction: 'BR',
        retentionBasis: ['RF026 e2e fixture basis'],
        legalHoldRules: [{ when: 'legalHold=true', block: 'destroy' }],
        reviewRequired: false,
        ...overrides,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()).data;
    return String(body._id);
  }

  test('records a disposition action linked to a real retention policy, with method/date/responsible/affected items preserved (criteria 1, 3, 4)', async ({ request }) => {
    const admin = await realLogin(request);
    // Review required, so executing before approval is refused below; a
    // policy with reviewRequired false lets a planned action execute (AC2).
    const retentionPolicyId = await createRetentionPolicy(request, admin, { reviewRequired: true });

    const res = await request.post(`${apiBaseURL}/api/disposition-actions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        retentionPolicyId,
        entityType: 'Log',
        affectedRecordIds: ['log-rf026-1', 'log-rf026-2'],
        dispositionAction: 'destroy',
        dispositionMethod: 'secure-wipe',
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const disposition = (await res.json()).data;

    expect(disposition.retentionPolicyId).toBe(retentionPolicyId);
    expect(disposition.affectedRecordIds).toEqual(['log-rf026-1', 'log-rf026-2']);
    expect(disposition.dispositionMethod).toBe('secure-wipe');
    expect(disposition.performedBy).toBeTruthy();
    expect(disposition.legalHold).toBe(false);

    // AC#4/#5 (#1315): recorded planned, with no certificate until it is
    // authorized and executed with its evidence.
    expect(disposition.actionStatus).toBe('planned');
    expect(disposition.dispositionDateTime).toBeNull();
    const base = `${apiBaseURL}/api/disposition-actions/${disposition.dispositionActionId}`;
    const auth = { Authorization: `Bearer ${admin.token}` };
    expect((await request.get(`${base}/certificate`, { headers: auth })).status()).toBe(409);
    expect((await request.post(`${base}/execute`, { headers: auth, data: { evidenceIds: ['file-rf026-1'] } })).status()).toBe(409);

    const approved = await request.post(`${base}/approve`, { headers: auth });
    expect(approved.status(), await approved.text()).toBe(200);
    expect((await approved.json()).data).toMatchObject({ actionStatus: 'approved', authorizationId: expect.any(String) });

    expect((await request.post(`${base}/execute`, { headers: auth, data: { evidenceIds: [] } })).status()).toBe(422);
    const executed = await request.post(`${base}/execute`, { headers: auth, data: { evidenceIds: ['file-rf026-1'] } });
    expect(executed.status(), await executed.text()).toBe(200);
    const executedBody = (await executed.json()).data;
    expect(executedBody).toMatchObject({ actionStatus: 'executed', evidenceIds: ['file-rf026-1'] });
    expect(executedBody.executedBy).toBeTruthy();
    expect(executedBody.dispositionDateTime).toBeTruthy();

    // AC#5: gera evidência/certificado.
    const certRes = await request.get(`${apiBaseURL}/api/disposition-actions/${disposition.dispositionActionId}/certificate`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(certRes.status(), await certRes.text()).toBe(200);
    const certificate = (await certRes.json()).data;
    expect(certificate.affectedRecordIds).toEqual(['log-rf026-1', 'log-rf026-2']);
    expect(certificate.dispositionMethod).toBe('secure-wipe');
  });

  test('a return and a cancellation each pass the lifecycle: return is approved, executed with evidence and certified; a cancelled action admits nothing further (RF006 AC5, RF026 AC3 AC4, RNF022 AC4; #1509)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const retentionPolicyId = await createRetentionPolicy(request, admin, { reviewRequired: true });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = async (dispositionAction: string, affectedRecordIds: string[]) => {
      const res = await request.post(`${apiBaseURL}/api/disposition-actions`, {
        headers: auth,
        data: { retentionPolicyId, entityType: 'Log', affectedRecordIds, dispositionAction },
      });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).data;
    };

    // A return is recorded planned and executes only once approved.
    const returned = await record('return', [`log-rf026-return-${suffix}`]);
    expect(returned).toMatchObject({ actionStatus: 'planned', dispositionAction: 'return' });
    const returnBase = `${apiBaseURL}/api/disposition-actions/${returned.dispositionActionId}`;
    const returnEvidence = { evidenceIds: ['file-rf026-return'] };
    expect((await request.post(`${returnBase}/execute`, { headers: auth, data: returnEvidence })).status()).toBe(409);
    const approvedReturn = await request.post(`${returnBase}/approve`, { headers: auth });
    expect(approvedReturn.status(), await approvedReturn.text()).toBe(200);
    expect((await approvedReturn.json()).data).toMatchObject({ actionStatus: 'approved', authorizationId: expect.any(String) });
    const executedReturn = await request.post(`${returnBase}/execute`, { headers: auth, data: returnEvidence });
    expect(executedReturn.status(), await executedReturn.text()).toBe(200);
    const executedReturnBody = (await executedReturn.json()).data;
    expect(executedReturnBody).toMatchObject({ actionStatus: 'executed', dispositionAction: 'return', evidenceIds: ['file-rf026-return'] });
    expect(executedReturnBody.executedBy).toBeTruthy();
    const returnCertificate = await request.get(`${returnBase}/certificate`, { headers: auth });
    expect(returnCertificate.status(), await returnCertificate.text()).toBe(200);
    expect((await returnCertificate.json()).data).toMatchObject({ dispositionAction: 'return', evidenceIds: ['file-rf026-return'] });

    // A cancellation needs its reason, and a cancelled action admits no
    // execution, approval or certificate.
    const cancelled = await record('destroy', [`log-rf026-cancel-${suffix}`]);
    const cancelBase = `${apiBaseURL}/api/disposition-actions/${cancelled.dispositionActionId}`;
    const approvedCancel = await request.post(`${cancelBase}/approve`, { headers: auth });
    expect(approvedCancel.status(), await approvedCancel.text()).toBe(200);
    expect((await request.post(`${cancelBase}/cancel`, { headers: auth, data: {} })).status()).toBe(422);
    const reason = 'Destinação desnecessária — RF026 e2e fixture';
    const cancelRes = await request.post(`${cancelBase}/cancel`, { headers: auth, data: { reason } });
    expect(cancelRes.status(), await cancelRes.text()).toBe(200);
    const cancelBody = (await cancelRes.json()).data;
    expect(cancelBody).toMatchObject({ actionStatus: 'cancelled', cancellationReason: reason });
    expect(cancelBody.cancelledBy).toBeTruthy();
    expect((await request.post(`${cancelBase}/execute`, { headers: auth, data: { evidenceIds: ['file-rf026-cancel'] } })).status()).toBe(409);
    expect((await request.post(`${cancelBase}/approve`, { headers: auth })).status()).toBe(409);
    expect((await request.get(`${cancelBase}/certificate`, { headers: auth })).status()).toBe(409);
    const stored = await request.get(cancelBase, { headers: auth });
    expect(stored.status(), await stored.text()).toBe(200);
    expect((await stored.json()).data.actionStatus).toBe('cancelled');
  });

  test('an execution a legal hold refuses is stored blocked, and re-approved after the release it executes (RF006 AC5, RF026 AC4 AC6, RNF022 AC4; #1509)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const retentionPolicyId = await createRetentionPolicy(request, admin, { reviewRequired: true });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const affectedRecordIds = [`log-rf026-blocked-${suffix}`];

    // Recorded and approved while no hold covers the record.
    const res = await request.post(`${apiBaseURL}/api/disposition-actions`, {
      headers: auth,
      data: { retentionPolicyId, entityType: 'Log', affectedRecordIds, dispositionAction: 'destroy' },
    });
    expect(res.status(), await res.text()).toBe(201);
    const action = (await res.json()).data;
    expect(action).toMatchObject({ actionStatus: 'planned', legalHold: false });
    const base = `${apiBaseURL}/api/disposition-actions/${action.dispositionActionId}`;
    const approved = await request.post(`${base}/approve`, { headers: auth });
    expect(approved.status(), await approved.text()).toBe(200);

    const holdRes = await request.post(`${apiBaseURL}/api/legal-holds`, {
      headers: auth,
      data: { targetEntityType: 'Log', targetEntityIds: affectedRecordIds, reason: 'Ordem judicial superveniente — RF026 e2e fixture' },
    });
    expect(holdRes.status(), await holdRes.text()).toBe(201);
    const hold = (await holdRes.json()).data;

    // The hold refuses the execution and the action is stored blocked.
    const evidence = { evidenceIds: ['file-rf026-blocked'] };
    const refused = await request.post(`${base}/execute`, { headers: auth, data: evidence });
    expect(refused.status(), await refused.text()).toBe(409);
    expect((await refused.json()).message).toMatch(/bloqueio legal ou ético ativo/);
    const stored = await request.get(base, { headers: auth });
    expect(stored.status(), await stored.text()).toBe(200);
    expect((await stored.json()).data).toMatchObject({ actionStatus: 'blocked', legalHold: true });
    expect((await request.get(`${base}/certificate`, { headers: auth })).status()).toBe(409);
    expect((await request.post(`${base}/execute`, { headers: auth, data: evidence })).status()).toBe(409);

    // Released, the blocked action is approved again and executes.
    const releaseRes = await request.post(`${apiBaseURL}/api/legal-holds/${hold.legalHoldId}/release`, {
      headers: auth,
      data: { releaseReason: 'Ordem revogada — RF026 e2e fixture' },
    });
    expect(releaseRes.status(), await releaseRes.text()).toBe(200);
    const reapproved = await request.post(`${base}/approve`, { headers: auth });
    expect(reapproved.status(), await reapproved.text()).toBe(200);
    expect((await reapproved.json()).data.actionStatus).toBe('approved');
    const executed = await request.post(`${base}/execute`, { headers: auth, data: evidence });
    expect(executed.status(), await executed.text()).toBe(200);
    expect((await executed.json()).data).toMatchObject({ actionStatus: 'executed', legalHold: false });
  });

  test('rejects a disposition action whose retentionPolicyId does not resolve to a real policy (criterion 1)', async ({ request }) => {
    const admin = await realLogin(request);

    const res = await request.post(`${apiBaseURL}/api/disposition-actions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        retentionPolicyId: '65f0a1b2c3d4e5f6a7b8c9d0',
        entityType: 'Log',
        affectedRecordIds: ['log-does-not-matter'],
        dispositionAction: 'destroy',
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('política de retenção existente');
  });

  test('applies a legal hold, blocks destruction while active, then allows it again once released (criteria 2, 6)', async ({ request }) => {
    const admin = await realLogin(request);
    const retentionPolicyId = await createRetentionPolicy(request, admin);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const affectedRecordIds = [`log-rf026-hold-${suffix}`];

    const holdRes = await request.post(`${apiBaseURL}/api/legal-holds`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        targetEntityType: 'Log',
        targetEntityIds: affectedRecordIds,
        reason: 'Investigação em andamento (ordem judicial) — RF026 e2e fixture',
      },
    });
    expect(holdRes.status(), await holdRes.text()).toBe(201);
    const hold = (await holdRes.json()).data;
    expect(hold.status).toBe('active');

    // AC#6: bloqueia a destruição enquanto o bloqueio estiver ativo.
    const blockedRes = await request.post(`${apiBaseURL}/api/disposition-actions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { retentionPolicyId, entityType: 'Log', affectedRecordIds, dispositionAction: 'destroy' },
    });
    expect(blockedRes.status(), await blockedRes.text()).toBe(409);

    // A non-destructive action isn't blocked by the same hold, and truthfully records legalHold: true.
    const preserveRes = await request.post(`${apiBaseURL}/api/disposition-actions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { retentionPolicyId, entityType: 'Log', affectedRecordIds, dispositionAction: 'preserve' },
    });
    expect(preserveRes.status(), await preserveRes.text()).toBe(201);
    expect((await preserveRes.json()).data.legalHold).toBe(true);

    // AC#2: libera o bloqueio.
    const releaseRes = await request.post(`${apiBaseURL}/api/legal-holds/${hold.legalHoldId}/release`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { releaseReason: 'Investigação encerrada — RF026 e2e fixture' },
    });
    expect(releaseRes.status(), await releaseRes.text()).toBe(200);
    expect((await releaseRes.json()).data.status).toBe('released');

    // Destruction is allowed again once the hold is released.
    const allowedRes = await request.post(`${apiBaseURL}/api/disposition-actions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { retentionPolicyId, entityType: 'Log', affectedRecordIds, dispositionAction: 'destroy' },
    });
    expect(allowedRes.status(), await allowedRes.text()).toBe(201);
    expect((await allowedRes.json()).data.legalHold).toBe(false);
  });

  test('stores the policy\'s jurisdiction, basis, legal-hold rules and review, refuses a policy without them, and blocks what its own rules name under a hold (criteria 1, 2; #1315)', async ({ request }) => {
    const admin = await realLogin(request);
    const missing = await request.post(`${apiBaseURL}/api/retention-policies`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { applicableEntityTypes: ['Log'], triggerEvent: 'creation', postRetentionAction: 'destroy', retentionPeriod: 'P365D' },
    });
    expect(missing.status(), await missing.text()).toBe(422);
    expect(await missing.text()).toMatch(/jurisdiction é obrigatório/);

    const retentionPolicyId = await createRetentionPolicy(request, admin, {
      legalHoldRules: [{ when: 'legalHold=true', block: 'destroy' }, { when: 'legalHold=true', block: 'transfer' }],
      reviewRequired: true,
    });
    const stored = await request.get(`${apiBaseURL}/api/retention-policies/${retentionPolicyId}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(stored.status(), await stored.text()).toBe(200);
    expect((await stored.json()).data).toMatchObject({
      jurisdiction: 'BR',
      retentionBasis: ['RF026 e2e fixture basis'],
      reviewRequired: true,
      legalHoldRules: [{ when: 'legalHold=true', block: 'destroy' }, { when: 'legalHold=true', block: 'transfer' }],
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const affectedRecordIds = [`log-rf026-rule-${suffix}`];
    const holdRes = await request.post(`${apiBaseURL}/api/legal-holds`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { targetEntityType: 'Log', targetEntityIds: affectedRecordIds, reason: 'Ordem judicial — RF026 e2e fixture' },
    });
    expect(holdRes.status(), await holdRes.text()).toBe(201);

    const transferRes = await request.post(`${apiBaseURL}/api/disposition-actions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { retentionPolicyId, entityType: 'Log', affectedRecordIds, dispositionAction: 'transfer' },
    });
    expect(transferRes.status(), await transferRes.text()).toBe(409);

    const hold = (await holdRes.json()).data;
    const releaseRes = await request.post(`${apiBaseURL}/api/legal-holds/${hold.legalHoldId}/release`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { releaseReason: 'Encerrado — RF026 e2e fixture' },
    });
    expect(releaseRes.status(), await releaseRes.text()).toBe(200);
  });

  test('refuses to release an already-released legal hold', async ({ request }) => {
    const admin = await realLogin(request);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const holdRes = await request.post(`${apiBaseURL}/api/legal-holds`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        targetEntityType: 'Log',
        targetEntityIds: [`log-rf026-double-release-${suffix}`],
        reason: 'RF026 e2e fixture',
      },
    });
    const hold = (await holdRes.json()).data;

    const firstRelease = await request.post(`${apiBaseURL}/api/legal-holds/${hold.legalHoldId}/release`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { releaseReason: 'Primeira liberação' },
    });
    expect(firstRelease.status()).toBe(200);

    const secondRelease = await request.post(`${apiBaseURL}/api/legal-holds/${hold.legalHoldId}/release`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { releaseReason: 'Segunda tentativa' },
    });
    expect(secondRelease.status()).toBe(400);
  });
});
