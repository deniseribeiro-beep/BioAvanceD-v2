import { test, expect, type Page, type Route } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken } from './support/auth';

test.use({ storageState: { cookies: [], origins: [] } });

async function setupSamplesPage(page: Page) {
  const auth = createAdminAuthContext();
  await injectSessionToken(page, auth.token);

  await page.route('http://localhost:3000/api/**', async (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/api/auth/verify') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: auth.user, valid: true } }),
      });
      return;
    }

    if (url.includes('/api/auth/login') && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { token: auth.token, user: auth.user } }),
      });
      return;
    }

    if (url.includes('/api/auth/keepalive') && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { valid: true } }) });
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
              sampleType: 'Sangue',
              sampleOrigin: 'Hospital A',
              status: 'AVAILABLE',
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

    if (/\/api\/samples\/sample-001(?:\?.*)?$/.test(url) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            _id: 'sample-001',
            sampleID: 'SAMPLE-001',
            barcode: 'BC001',
            sampleType: 'Sangue',
            sampleOrigin: 'Hospital A',
            status: 'AVAILABLE',
            quantity: 10,
            volumeInitial: 10,
            volumeCurrent: 8,
            patientID: '12345678',
            canUse: true,
            consentValid: true,
          },
        }),
      });
      return;
    }

    if (/\/api\/results(?:\?.*)?$/.test(url) && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
      return;
    }

    if (/\/api\/equipment(?:\?.*)?$/.test(url) && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
      return;
    }

    if (/\/api\/locations(?:\?.*)?$/.test(url) && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
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

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
  });

  await page.goto('/samples');

  if (page.url().includes('/login')) {
    await page.getByTestId('login-username-input').fill('admin');
    await page.getByTestId('login-password-input').fill('Admin@123');
    await page.getByTestId('login-submit-button').click();
    await page.goto('/samples');
  }

  await expect(page.getByTestId('samples-page-title')).toBeVisible({ timeout: 10000 });
}

test.describe('Samples - Core', () => {
  test('lista renderiza elementos principais com testid', async ({ page }) => {
    await setupSamplesPage(page);

    await expect(page.getByTestId('samples-search-input')).toBeVisible();
    await expect(page.getByTestId('samples-search-button')).toBeVisible();
    await expect(page.getByTestId('samples-scan-button')).toBeVisible();
    await expect(page.getByTestId('samples-select-all-checkbox')).toBeVisible();
    await expect(page.getByTestId('samples-table')).toBeVisible();
  });

  test('linhas de amostra carregam com ids estáveis', async ({ page }) => {
    await setupSamplesPage(page);

    await expect(page.getByTestId('sample-row-sample-001')).toBeVisible();
    await expect(page.getByTestId('sample-edit-button-sample-001')).toBeVisible();
  });

  test('busca mantém resultado da lista', async ({ page }) => {
    await setupSamplesPage(page);

    await page.getByTestId('samples-search-input').fill('SAMPLE-001');
    await page.getByTestId('samples-search-button').click();

    await expect(page.getByTestId('sample-row-sample-001')).toBeVisible();
  });

  test('navega para detalhe e habilita modo edição', async ({ page }) => {
    await setupSamplesPage(page);

    await page.getByTestId('sample-edit-button-sample-001').click();
    await expect(page).toHaveURL(/\/samples\/sample-001/);
  });
});
