import { test, expect } from '@playwright/test';
import { realLogin, seedRealAuth } from './helpers/realAuth';
import {
  createRealParticipant,
  seedStorageBoxLocation,
  cleanupStorageBoxLocation,
  closeSeedDb,
  type SeededStorageBox,
} from './helpers/seedParticipant';
import {
  seedGovernedCollection,
  cleanupGovernedCollection,
  closeGovernedCollectionDb,
  type GovernedCollection,
} from './helpers/seedGovernedCollection';

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
  // #1497 (RF004 AC2): the collection the sample enters.
  let governed: GovernedCollection | null = null;

  test.beforeAll(async () => {
    governed = await seedGovernedCollection(`ui-mongo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  });

  test.afterAll(async () => {
    await Promise.all(seededBoxes.map((box) => cleanupStorageBoxLocation(box).catch(() => {})));
    await cleanupGovernedCollection(governed).catch(() => {});
    await closeGovernedCollectionDb().catch(() => {});
    await closeSeedDb().catch(() => {});
  });

  test('samples list and detail show specimenId and type from the real API', async ({ page, request }) => {
    // Poll window is 45s; global Playwright timeout is 30s.
    test.setTimeout(60_000);

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
        collectionId: governed!.collectionId,
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
    const barcode = String(detail.barcode || '');

    await page.goto('/samples');
    await expect(page.getByTestId('sample-list-root')).toBeVisible({ timeout: 20_000 });
    const row = page.locator(`[data-testid^="sample-row-"]`).filter({ hasText: specimenId });
    // Inventory is client-filtered; wait for the list fetch to include the just-created specimen.
    await expect
      .poll(
        async () => {
          await page.getByTestId('samples-search-input').fill(specimenId);
          await page.getByTestId('samples-search-button').click();
          if (await row.first().isVisible().catch(() => false)) return true;
          await page.reload({ waitUntil: 'domcontentloaded' });
          await expect(page.getByTestId('sample-list-root')).toBeVisible({ timeout: 20_000 });
          return false;
        },
        { timeout: 45_000, intervals: [1_000, 2_000, 3_000] }
      )
      .toBe(true);
    await expect(row.first()).toBeVisible({ timeout: 5_000 });
    await expect(row.first()).toContainText(specimenId);
    if (barcode) {
      await expect(row.first()).toContainText(barcode);
    }
    await expect(row.first()).toContainText(/PLASMA|Plasma|Sangue/i);

    await page.goto(`/samples/${specimenId}`);
    await expect(page.getByTestId('sample-detail-root')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('sample-detail-page-title')).toContainText(specimenId);
    await expect(page.getByTestId('sample-detail-root')).toContainText(specimenId);
    if (barcode) {
      await expect(page.getByTestId('sample-detail-root')).toContainText(barcode);
    }
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
