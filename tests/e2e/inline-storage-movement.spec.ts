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
  specimenId: 'AMO-E2E-0488-1',
  sampleType: 'Sangue',
  participantId: 'P-488',
};

const STORED_SAMPLE = {
  _id: 'sample-488-stored',
  specimenId: 'AMO-E2E-0488-2',
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

  // #1567: since #1559 SampleDetailsPage mounts SampleCompromiseCard, whose
  // mount effect reads GET /api/samples/:id/graph-status. Unmocked, it 401s
  // against a real backend on mockLogin's unsigned token and the global
  // response interceptor force-logs-out mid-test -- the #611 mechanism, as
  // with #744's files route below. Answered with the "clear" status (not
  // projected, no compromise), and scoped to the graph-status sub-route
  // only, for the same reason the bare '**/api/samples' route above is.
  await page.route('**/api/samples/*/graph-status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          sampleId: sample._id,
          projected: false,
          status: null,
          compromisedAt: null,
          compromiseFreezerKey: null,
          compromiseBreachedSince: null,
        },
      }),
    });
  });

  // SampleDetailsPage also mounts useResults()/useEquipment(), which fire
  // real GET /results and GET /equipment on mount regardless of this test's
  // own focus — unmocked, they hit the real backend with mockLogin's
  // unsigned token, 401, and api.ts's response interceptor force-logs-out
  // the session (redirect to /login), detaching whatever the test was about
  // to click (#611).
  await page.route('**/api/results**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.route('**/api/equipment**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  // SampleDetailsPage also always mounts AnalysisUploadModal (visibility is
  // an `isOpen` prop, not conditional rendering — the component, and its
  // useAnalysisTypes() hook, mount regardless of whether the modal is
  // shown), firing a real GET /analysis-types on mount too (#611).
  await page.route('**/api/analysis-types**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  // #744: SampleDetailsPage mounts SampleFilesSection (#647, added after
  // #611's mock list above), whose mount effect fires
  // GET /api/samples/:id/files (api.ts sampleService.listFiles). Unmocked,
  // it 401s against a real backend on mockLogin's unsigned token and the
  // global response interceptor force-logs-out mid-test -- the same
  // mechanism #611 documented, one endpoint later. Scoped to the files
  // sub-route only, for the same reason the bare '**/api/samples' route
  // above is scoped: a broader pattern would also swallow sibling
  // sub-routes and fulfill them with the wrong envelope.
  await page.route('**/api/samples/*/files**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  // InlineStorageMovementPanel also resolves current location via
  // GET /storage/sample/:sampleId on mount (#495) — unmocked for whichever
  // sample id the caller didn't set up its own route for, this 401s the
  // same way /results and /equipment did above (#611). Default to "not
  // stored" here; a caller-registered route for a specific sample id (e.g.
  // the already-stored test below) is registered before this one runs and
  // takes priority via route.fallback().
  await page.route('**/api/storage/sample/*', async (route) => {
    if (route.request().url().endsWith(`/api/storage/sample/${sample._id}`) && sample === STORED_SAMPLE) {
      return route.fallback();
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false }) });
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
    // #495 migrated the panel to resolve current location via
    // GET /storage/sample/:sampleId instead of reading sample.storageLocation
    // directly — isAlreadyStored only resolves true once this route is mocked.
    await page.route(`**/api/storage/sample/${STORED_SAMPLE._id}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            specimenId: STORED_SAMPLE.specimenId,
            box: { boxId: 'box-488-0', boxName: 'Caixa 0', position: 'A1' },
            path: 'Freezer 488/Prateleira 1/Rack 1/Caixa 0',
            fullHierarchy: { freezerId: FREEZER._id, shelfId: 'shelf-0', rackId: 'rack-0', boxId: 'box-488-0' },
          },
        }),
      });
    });

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
