import { test, expect } from '@playwright/test';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import {
  createRealParticipant,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  seedStudy,
  seedProtocol,
  seedActiveConsent,
  seedDuoConcept,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import { deleteOrganizations } from './helpers/listOrganizations';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  assignGovernedCustody,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';

// RF024 (#1350): the access-request screens against the real backend. The
// operator registers a request through the form (AC1), evaluates it (AC2/AC3:
// each item's ConsentAuthorizationDecision and the AccessPolicy effect),
// records the committee's approval with its validity (AC3/AC4), distributes
// (AC5) and revokes (AC6) -- every step through /access-requests, none through
// the API. scientific-data-access.spec.ts proves the same rules API-side.
// The study, protocol and DUO concept are seeded: none has a UI that creates it.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

const seededBoxes: SeededStorageBox[] = [];
const organizationIds: string[] = [];

function isoDay(offsetDays: number): string {
  const day = new Date(Date.now() + offsetDays * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

test.describe('RF024 access-request screens -- real backend', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set -- run via npm run test:e2e:docker');

  // #1497 (RF004 AC2): the specimen enters a governed collection.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`rf024-ui-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async ({ request }) => {
    await Promise.all(seededBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
    await cleanupGovernedCollection(governed);
    await closeGovernedCollectionDb();
    await closeSeedDb();
  });

  test('an operator registers, evaluates, approves, distributes and revokes a request through the UI (AC1-AC6)', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);
    const headers = { Authorization: `Bearer ${session.token}` };
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const studyId = `rf024-ui-study-${stamp}`;
    const protocolId = `rf024-ui-protocol-${stamp}`;
    const duoCode = `DUO:rf024-ui-${stamp}`;
    await seedStudy(studyId);
    await seedProtocol(protocolId, { protocolVersion: '2.0' });
    await seedDuoConcept(duoCode);

    const org = await request.post(`${apiBaseURL}/api/organizations`, {
      headers,
      data: { officialName: `0 RF024 UI ${stamp}`, countryCode: 'BR' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const organizationId = (await org.json()).data.organizationId as string;
    organizationIds.push(organizationId);

    // A real specimen of a real participant, the item the request names.
    const participant = await createRealParticipant(request, apiBaseURL!, session.token);
    const box = await seedStorageBoxLocation();
    seededBoxes.push(box);
    const sample = await request.post(`${apiBaseURL}/api/samples`, {
      headers,
      data: {
        participantId: participant.participantId,
        sampleType: 'PLASMA',
        sampleOrigin: 'VENOUS_BLOOD',
        extractionProtocol: 'TUBE_EDTA',
        quantity: 5,
        quality: 'GOOD',
        linkedProject: 'RF024 UI e2e',
        registeredAt: new Date().toISOString(),
        boxId: box.boxId,
        positionCode: box.positionCode,
        collectionId: governed!.collectionId,
      },
    });
    expect([201, 202]).toContain(sample.status());
    const specimenId = (await sample.json()).data.specimenId as string;
    expect(specimenId).toBeTruthy();
    // RF021 AC6: a specimen in a collection is compatible only under a custody in force.
    await assignGovernedCustody(request, apiBaseURL!, headers, governed!, specimenId, organizationId);

    // AC1: the request registered through the form.
    await page.goto('/access-requests');
    await page.getByTestId('access-request-requester-input').fill(`pesquisador-${stamp}`);
    await page.getByTestId('access-request-organization-select').selectOption(organizationId);
    await page.getByTestId('access-request-study-input').fill(studyId);
    await page.getByTestId('access-request-protocol-input').fill(protocolId);
    await page.getByTestId('access-request-purpose-input').fill('Pesquisa em biomarcadores (RF024 UI e2e)');
    await page.getByTestId('access-request-duo-select').selectOption(duoCode);
    await page.getByTestId('access-request-item-id-1').fill(specimenId);
    const created = page.waitForResponse((r) => r.url().endsWith('/api/access-requests') && r.request().method() === 'POST');
    await page.getByTestId('access-request-submit').click();
    const createdResponse = await created;
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const accessRequestId = (await createdResponse.json()).data.accessRequestId as string;

    const detail = page.getByTestId('access-request-detail');
    await expect(detail).toContainText(accessRequestId);
    await expect(page.getByTestId('access-request-duo')).toHaveText(duoCode);
    // The protocol's version in force, read by the backend from the Protocol.
    await expect(detail).toContainText('(v2.0)');
    await expect(page.getByTestId('access-request-access-check')).toContainText('Bloqueado: Aguardando decisão do comitê');

    // AC2: no active consent yet, so the item is incompatible, and an approval is refused.
    await page.getByTestId('access-request-evaluate').click();
    await expect(page.getByTestId('access-request-overall')).toHaveText(/: incompatível$/);
    await expect(page.getByTestId('access-request-policy-effect')).toHaveText('deny');
    await page.getByTestId('access-decision-justification-input').fill('Tentativa sem consentimento ativo');
    await page.getByTestId('access-decision-submit').click();
    await expect(page.getByTestId('access-request-detail-error')).toContainText('incompatível');
    await expect(page.getByTestId('access-request-decision-status')).toContainText('pending');

    // With the participant's consent active, the item's consent permits this use.
    await seedActiveConsent(participant.participantId);
    await page.getByTestId('access-request-evaluate').click();
    await expect(page.getByTestId(`access-request-item-result-${specimenId}`)).toHaveText('permit');
    await expect(page.getByTestId('access-request-overall')).toHaveText(/: compatível$/);
    // AC3: no AccessPolicy covers this organization, so the committee decides.
    await expect(page.getByTestId('access-request-policy-effect')).toHaveText('review_required');

    // AC3/AC4: the committee approves, with a validity in force.
    await page.getByTestId('access-decision-status-select').selectOption('approved');
    await page.getByTestId('access-decision-justification-input').fill('Compatibilidade confirmada pelo comitê');
    await page.getByTestId('access-decision-start-input').fill(isoDay(-1));
    await page.getByTestId('access-decision-end-input').fill(isoDay(365));
    await page.getByTestId('access-decision-submit').click();
    await expect(page.getByTestId('access-request-decision-status')).toContainText('approved');
    await expect(page.getByTestId('access-request-decision-status')).toContainText('Compatibilidade confirmada pelo comitê');
    await expect(page.getByTestId('access-request-access-check')).toContainText('Liberado: Aprovado');

    // AC5: distributed, naming the decision that authorized it.
    await page.getByTestId('access-request-distribute').click();
    await expect(page.getByTestId('access-request-distribution-status')).toContainText('Disponibilizada em');

    const stored = await request.get(`${apiBaseURL}/api/access-requests/${accessRequestId}`, { headers });
    const storedBody = (await stored.json()).data;
    expect(storedBody).toMatchObject({
      requestedItems: [{ itemType: 'specimen', itemId: specimenId }],
      duoCode,
      distributionStatus: 'released',
      committeeDecision: { status: 'approved' },
    });
    expect(storedBody.distributionDecisionId).toBe(storedBody.committeeDecision.decisionId);
    expect(storedBody.approvalPeriod.start).toBeTruthy();
    await expect(page.getByTestId('access-request-distribution-status')).toContainText(storedBody.distributionDecisionId);

    // AC6: revoked, access blocks.
    await page.getByTestId('access-revoke-justification-input').fill('Finalidade encerrada');
    await page.getByTestId('access-request-revoke').click();
    await expect(page.getByTestId('access-request-decision-status')).toContainText('revoked');
    await expect(page.getByTestId('access-request-access-check')).toContainText('Bloqueado: Acesso revogado');
  });
});
