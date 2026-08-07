import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers/mockAuth';

// InlineStorageMovementPanel.tsx has zero data-testid coverage (#488) — every
// locator below is a real <label htmlFor> (getByLabel) or an accessible name
// (getByRole), same convention as tcle-dinamico.spec.ts.

const FREEZER = { _id: 'freezer-488-1', freezerName: 'Freezer 488' };

const FREEZER_TREE = {
  freezerName: 'Freezer 488',
  shelves: [
    {
      shelfName: 'Prateleira 1',
      racks: [
        {
          rackName: 'Rack 1',
          boxes: [
            { boxId: 'box-488-1', boxName: 'Caixa 1', stats: { totalCapacity: 10, totalOccupied: 0, occupancyPercent: 0 } },
          ],
        },
      ],
    },
  ],
};

const UNSTORED_SAMPLE = {
  _id: 'sample-488-unstored',
  sampleID: 'AMO-E2E-0488-1',
  sampleType: 'Sangue',
  participantId: 'P-488',
};

const STORED_SAMPLE = {
  _id: 'sample-488-stored',
  sampleID: 'AMO-E2E-0488-2',
  sampleType: 'Plasma',
  participantId: 'P-489',
  storageLocation: { boxId: 'box-488-0', position: 'A1' },
};

async function mockStorageTree(page: import('@playwright/test').Page) {
  await page.route('**/api/storage/freezers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [FREEZER] }),
    });
  });

  await page.route(`**/api/storage/freezer/${FREEZER._id}/tree`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: FREEZER_TREE }),
    });
  });
}

async function openPanelForSample(page: import('@playwright/test').Page, sample: typeof UNSTORED_SAMPLE | typeof STORED_SAMPLE) {
  // Scoped to the bare list endpoint only — a broader `**/api/samples**` also
  // catches `/api/samples/:id/compliance-graph` (and other sub-routes) fired
  // by the same page, wrongly fulfilling them with the list envelope and
  // crashing SampleDetailsPage's compliance-graph rendering (`.graphPath` of
  // an object with no such key).
  await page.route('**/api/samples', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { samples: [sample] } }),
    });
  });

  await page.route('**/api/samples/*/compliance-graph', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false }) });
  });

  await mockStorageTree(page);

  await page.goto(`/samples/${sample._id}`);
  await page.getByRole('button', { name: 'Gerenciar Armazenagem' }).click();

  await page.getByLabel('Freezer').selectOption(FREEZER._id);
  await page.getByLabel('Prateleira').selectOption('0');
  await page.getByLabel('Rack').selectOption('0');
  await page.getByLabel('Caixa').selectOption('box-488-1');
}

test.describe('Inline storage movement panel (#488)', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
  });

  test('auto-assign path calls storageApi.autoAssignSampleToBox and closes the panel on success', async ({ page }) => {
    await openPanelForSample(page, UNSTORED_SAMPLE);

    let autoAssignRequestBody: unknown;
    await page.route('**/api/storage/allocate/auto', async (route) => {
      autoAssignRequestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { position: 'B2' } }),
      });
    });

    await page.getByRole('button', { name: 'Confirmar Movimentação' }).click();

    await expect(page.getByRole('button', { name: 'Gerenciar Armazenagem' })).toBeVisible();
    expect(autoAssignRequestBody).toMatchObject({ sampleId: UNSTORED_SAMPLE._id, boxId: 'box-488-1' });
  });

  test('explicit-position path calls storageApi.allocateSample for an unplaced sample', async ({ page }) => {
    await openPanelForSample(page, UNSTORED_SAMPLE);

    await page.getByLabel('Especificar posição exata').check();
    await page.getByLabel('Posição de destino').fill('a1');

    let allocateRequestBody: unknown;
    await page.route('**/api/storage/allocate', async (route) => {
      allocateRequestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { position: 'A1' } }),
      });
    });

    await page.getByRole('button', { name: 'Confirmar Movimentação' }).click();

    await expect(page.getByRole('button', { name: 'Gerenciar Armazenagem' })).toBeVisible();
    expect(allocateRequestBody).toMatchObject({ sampleId: UNSTORED_SAMPLE._id, boxId: 'box-488-1', position: 'A1' });
  });

  test('explicit-position path calls storageApi.moveSample for an already-stored sample', async ({ page }) => {
    await openPanelForSample(page, STORED_SAMPLE);

    await page.getByLabel('Especificar posição exata').check();
    await page.getByLabel('Posição de destino').fill('c3');

    let moveRequestBody: unknown;
    await page.route('**/api/storage/move', async (route) => {
      moveRequestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { position: 'C3' } }),
      });
    });

    await page.getByRole('button', { name: 'Confirmar Movimentação' }).click();

    await expect(page.getByRole('button', { name: 'Gerenciar Armazenagem' })).toBeVisible();
    expect(moveRequestBody).toMatchObject({ sampleId: STORED_SAMPLE._id, targetBoxId: 'box-488-1', targetPosition: 'C3' });
  });

  test('invalid position format shows a client-side validation error and disables confirm', async ({ page }) => {
    await openPanelForSample(page, UNSTORED_SAMPLE);

    await page.getByLabel('Especificar posição exata').check();
    await page.getByLabel('Posição de destino').fill('11');

    await expect(page.getByText('Posição inválida. Use o formato Letra+Número (ex: A1).')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar Movimentação' })).toBeDisabled();
  });
});
