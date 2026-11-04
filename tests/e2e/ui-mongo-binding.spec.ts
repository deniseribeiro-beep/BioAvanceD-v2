import { test, expect } from '@playwright/test';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import {
  createRealParticipant,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';

// Homologation Fase B: prove the SPA renders API/Mongo fields (not just
// that a page loads). Screenshots alone do not cover this contract.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

function validSampleFields() {
  return {
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 5,
    quality: 'GOOD',
    linkedProject: 'UI-mongo-binding e2e',
    registeredAt: new Date().toISOString(),
  };
}

test.describe('UI ↔ API/Mongo field binding (homologacao runtime)', () => {
  test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via e2e-gate / test:e2e:docker');

  const seededBoxes: SeededStorageBox[] = [];

  test.afterAll(async () => {
    await Promise.all(seededBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await closeSeedDb().catch(() => {});
  });

  test('samples list and detail show specimenId and type from the real API', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);
    const headers = { Authorization: `Bearer ${session.token}` };

    const participant = await createRealParticipant(request, apiBaseURL!, session.token);
    const box = await seedStorageBoxLocation();
    seededBoxes.push(box);

    const create = await request.post(`${apiBaseURL}/api/samples`, {
      headers,
      data: {
        participantId: participant.participantId,
        ...validSampleFields(),
        boxId: box.boxId,
        positionCode: box.positionCode,
      },
    });
    expect([201, 202]).toContain(create.status());
    const created = (await create.json()).data;
    const specimenId = String(created.specimenId || '');
    expect(specimenId.length).toBeGreaterThan(0);

    const detailApi = await request.get(`${apiBaseURL}/api/samples/${specimenId}`, { headers });
    expect(detailApi.ok(), await detailApi.text()).toBeTruthy();
    const detail = (await detailApi.json()).data;
    expect(String(detail.specimenId)).toBe(specimenId);

    await page.goto('/samples');
    await expect(page.getByTestId('sample-list-root')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('samples-search-input').fill(specimenId);
    await page.getByTestId('samples-search-button').click();
    const row = page.locator(`[data-testid^="sample-row-"]`).filter({ hasText: specimenId });
    await expect(row.first()).toBeVisible({ timeout: 15_000 });
    await expect(row.first()).toContainText(/PLASMA|Plasma|Sangue/i);

    await page.goto(`/samples/${specimenId}`);
    await expect(page.getByTestId('sample-detail-root')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('sample-detail-page-title')).toContainText(specimenId);
    await expect(page.getByTestId('sample-detail-root')).toContainText(specimenId);
  });

  test('patients table row reflects a participant created through the API', async ({ page, request }) => {
    const session = await realLogin(request);
    await seedRealAuth(page, session);

    const participant = await createRealParticipant(request, apiBaseURL!, session.token);
    const participantId = String(participant.participantId);

    await page.goto('/patients');
    await expect(page.getByTestId('patients-page')).toBeVisible({ timeout: 20_000 });
    const search = page.getByTestId('patients-search-input');
    if (await search.isVisible()) {
      await search.fill(participantId);
    }
    const row = page.getByTestId(`patient-row-${participantId}`).or(
      page.locator(`[data-testid^="patient-row-"]`).filter({ hasText: participantId })
    );
    await expect(row.first()).toBeVisible({ timeout: 20_000 });
  });
});
