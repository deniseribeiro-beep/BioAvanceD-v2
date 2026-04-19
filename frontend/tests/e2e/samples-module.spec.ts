import { test, expect, type Page, type Route } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken } from './support/auth';

test.use({ storageState: { cookies: [], origins: [] } });

async function setupAuthenticatedSamplesPage(page: Page) {
  const auth = createAdminAuthContext();
  await injectSessionToken(page, auth.token);

  await page.route('http://localhost:3000/api/**', async (route: Route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    if (url.includes('/api/auth/verify') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user: { ...auth.user },
            valid: true,
          },
        }),
      });
      return;
    }

    if (url.includes('/api/auth/login') && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            token: auth.token,
            user: { ...auth.user },
          },
        }),
      });
      return;
    }

    if (/\/api\/samples(?:\?.*)?$/.test(url) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              _id: 'sample-001',
              sampleID: 'SAMPLE-001',
              barcode: 'BC001',
              sampleType: 'Sangue Periferico',
              sampleOrigin: 'Hospital A',
              status: 'Available',
              quantity: 10,
              volumeInitial: 10,
              volumeCurrent: 8,
              patientID: '12345678',
              canUse: true,
              consentValid: true,
            },
          ],
        }),
      });
      return;
    }

    if (/\/api\/results(?:\?.*)?$/.test(url) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
      return;
    }

    if (/\/api\/equipment(?:\?.*)?$/.test(url) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
      return;
    }

    if (/\/api\/locations(?:\?.*)?$/.test(url) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
      return;
    }

    if (/\/api\/samples\/sample-001\/compliance-graph(?:\?.*)?$/.test(url) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            sampleId: 'sample-001',
            isReleasable: true,
            graphPath: {
              ethics: { valid: true },
              quality: { valid: true },
              clinical: { valid: true },
              integrity: { valid: true },
            },
            suggestedStatus: 'AVAILABLE',
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} }),
    });
  });

  await page.goto('/samples');

  if (page.url().includes('/login')) {
    await page.getByTestId('login-username-input').fill('admin');
    await page.getByTestId('login-password-input').fill('Admin@123');
    await page.getByTestId('login-submit-button').click();
    await page.goto('/samples');
  }
}

test.describe('E2E - Amostras, Movimentacao e Detalhe', () => {
  test('deve renderizar lista de amostras e busca por data-testid', async ({ page }) => {
    await setupAuthenticatedSamplesPage(page);

    await expect(page.getByTestId('samples-page-title')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('samples-table')).toBeVisible();
    await expect(page.getByTestId('sample-row-sample-001')).toBeVisible();

    await page.getByTestId('samples-search-input').fill('SAMPLE-001');
    await page.getByTestId('samples-search-button').click();

    await expect(page.getByTestId('sample-row-sample-001')).toBeVisible();
  });

  test('deve navegar para detalhe da amostra via acao de editar', async ({ page }) => {
    await setupAuthenticatedSamplesPage(page);

    await page.getByTestId('sample-edit-button-sample-001').click();

    await expect(page).toHaveURL(/\/samples\/sample-001/);
  });

  test('deve selecionar e desselecionar amostra na listagem', async ({ page }) => {
    await setupAuthenticatedSamplesPage(page);

    const sampleCheckbox = page.getByTestId('sample-checkbox-sample-001');
    const selectAll = page.getByTestId('samples-select-all-checkbox');

    await sampleCheckbox.check();
    await expect(sampleCheckbox).toBeChecked();

    await selectAll.check();
    await expect(selectAll).toBeChecked();
    await expect(sampleCheckbox).toBeChecked();

    await selectAll.uncheck();
    await expect(selectAll).not.toBeChecked();
    await expect(sampleCheckbox).not.toBeChecked();
  });
});
