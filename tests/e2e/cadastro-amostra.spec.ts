import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers/mockAuth';

// #1216: the real API names a specimen by its specimenId; the legacy
// sampleID these fixtures carried is prohibited on the wire.
const MOCK_SAMPLES = [
  {
    _id: 'sample-e2e-1',
    specimenId: 'AMO-E2E-0001',
    sampleType: 'Sangue',
  },
  {
    _id: 'sample-e2e-2',
    specimenId: 'AMO-E2E-0002',
    sampleType: 'Plasma',
  },
];

test.describe('Samples list (/samples)', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);

    await page.route('**/api/samples**', async (route) => {
      if (route.request().method() !== 'GET') {
        return route.continue();
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { samples: MOCK_SAMPLES } }),
      });
    });
  });

  test('renders the samples table with seeded rows', async ({ page }) => {
    await page.goto('/samples');

    await expect(page.getByTestId('sample-list-root')).toBeVisible();
    await expect(page.getByTestId('samples-page-title')).toBeVisible();

    await expect(page.getByTestId('sample-row-sample-e2e-1')).toBeVisible();
    await expect(page.getByTestId('sample-row-sample-e2e-2')).toBeVisible();
  });

  test('search input filters the already-loaded rows client-side', async ({ page }) => {
    // The samples list fetches once on mount and filters in memory (useSamplesPage.ts) —
    // no new /api/samples request fires on search, so assert on visible rows, not the network.
    await page.goto('/samples');
    await expect(page.getByTestId('sample-list-root')).toBeVisible();
    await expect(page.getByTestId('sample-row-sample-e2e-1')).toBeVisible();
    await expect(page.getByTestId('sample-row-sample-e2e-2')).toBeVisible();

    await page.getByTestId('samples-search-input').fill('AMO-E2E-0001');
    await page.getByTestId('samples-search-button').click();

    await expect(page.getByTestId('sample-row-sample-e2e-1')).toBeVisible();
    await expect(page.getByTestId('sample-row-sample-e2e-2')).not.toBeVisible();
  });
});
