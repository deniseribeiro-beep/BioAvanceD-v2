import { test, expect } from '@playwright/test';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import { closeSeedDb, seedCollectionEntity, seedProtocol, seedStudy } from './helpers/seedParticipant';
import { deleteOrganizations } from './helpers/listOrganizations';

// RF004 AC3/AC4, RF020 AC3/AC4, RF021 AC2/AC3 through the UI: the governance
// panel of the collections tab registers an approval, records a
// biorepository collection's first context with the `created` event, and
// suspends the approval, each read back from the real backend.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

const organizationIds: string[] = [];

test.afterAll(async ({ request }) => {
  await deleteOrganizations(request, apiBaseURL!, organizationIds);
  await closeSeedDb();
});

test('registers an approval, records the biorepository context and suspends the approval from the collections tab', async ({ page, request }) => {
  const session = await realLogin(request);
  await seedRealAuth(page, session);
  const headers = { Authorization: `Bearer ${session.token}` };

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ids = { collectionId: `collection-governance-ui-${stamp}`, studyId: `study-${stamp}`, protocolId: `protocol-${stamp}` };
  await seedStudy(ids.studyId);
  await seedProtocol(ids.protocolId, { protocolVersion: '1.0' });
  await seedCollectionEntity(ids.collectionId);

  // The organization pickers read the first page of organizations sorted by
  // name, so the name sorts first on a kept test volume.
  const org = await request.post(`${apiBaseURL}/api/organizations`, {
    headers,
    data: { officialName: `0 Governança UI ${stamp}`, countryCode: 'BR' },
  });
  expect(org.ok(), await org.text()).toBeTruthy();
  const organizationId = (await org.json()).data.organizationId as string;
  organizationIds.push(organizationId);

  const governance = async () => {
    const response = await request.get(`${apiBaseURL}/api/collections/${ids.collectionId}/governance`, { headers });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).data;
  };

  try {
    await page.goto('/system-management?tab=collections');
    await page.getByTestId(`governance-collection-button-${ids.collectionId}`).click();
    await expect(page).toHaveURL(new RegExp(`/collections/${ids.collectionId}/governance`));
    await expect(page.getByTestId('collection-governance-page')).toBeVisible();
    const panel = page.getByTestId('collection-governance-panel');
    await expect(panel).toBeVisible();

    // An approval in force: every field POST .../approvals validates.
    await page.getByTestId('governance-approval-authority-input').fill('CEP sintético UI');
    await page.getByTestId('governance-approval-caae-input').fill('00000000.0.0000.0000');
    await page.getByTestId('governance-approval-document-uri-input').fill('https://docs.example.org/parecer-ui.pdf');
    await page.getByTestId('governance-approval-checksum-input').fill(`sha256:${'c'.repeat(64)}`);
    await page.getByTestId('governance-approval-start-input').fill('2026-01-01');
    await page.getByTestId('governance-approval-end-input').fill('2030-12-31');
    await page.getByTestId('governance-approval-organization-select').selectOption(organizationId);
    await page.getByTestId('governance-approval-status-select').selectOption('active');
    await page.getByTestId('governance-approval-submit').click();

    await expect.poll(async () => (await governance()).approvals.length).toBe(1);
    const approvalId = (await governance()).approvals[0].approvalId as string;
    await expect(page.getByTestId(`governance-approval-row-${approvalId}`)).toBeVisible();

    // The first context: a `created` event resting on that approval.
    await expect(page.getByTestId('governance-event-regime-select')).toHaveValue('biorepository');
    await page.getByTestId('governance-context-study-input').fill(ids.studyId);
    await page.getByTestId('governance-context-protocol-input').fill(ids.protocolId);
    await page.getByTestId('governance-context-protocol-version-input').fill('1.0');
    await page.getByTestId('governance-context-caae-input').fill('00000000.0.0000.0000');
    await page.getByTestId('governance-context-organization-select').selectOption(organizationId);
    await page.getByTestId('governance-context-investigator-input').fill('investigator-ui');
    await page.getByTestId('governance-context-ethics-approval-select').selectOption(approvalId);
    await page.getByTestId('governance-context-validity-start-input').fill('2026-01-01');
    await page.getByTestId('governance-context-planned-end-input').fill('2030-12-31');
    await page.getByTestId(`governance-event-approval-${approvalId}`).check();
    await page.getByTestId('governance-event-justification-input').fill('Contexto inicial registrado pela UI');
    await page.getByTestId('governance-event-submit').click();

    await expect(page.getByTestId('collection-governance-context')).toContainText(ids.studyId);
    await expect(page.getByTestId('collection-governance-events')).toContainText('Contexto inicial registrado pela UI');
    const recorded = await governance();
    expect(recorded.governanceContext).toMatchObject({
      studyId: ids.studyId,
      protocolId: ids.protocolId,
      ethicsApprovalId: approvalId,
      plannedEndDate: '2030-12-31',
    });
    expect(recorded.events).toHaveLength(1);
    expect(recorded.events[0]).toMatchObject({ decisionType: 'created', newRegime: 'biorepository', approvalIds: [approvalId] });

    await page.getByTestId(`governance-approval-suspended-${approvalId}`).click();
    await expect(page.getByTestId(`governance-approval-active-${approvalId}`)).toBeVisible();
    expect((await governance()).approvals[0].status).toBe('suspended');
  } finally {
    await request.delete(`${apiBaseURL}/api/collections/${ids.collectionId}`, { headers }).catch(() => {});
  }
});
