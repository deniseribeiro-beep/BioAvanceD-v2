import { test, expect, type Page, type Route } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken } from './support/auth';

test.use({ storageState: { cookies: [], origins: [] } });

async function setupStoragePage(page: Page) {
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
        body: JSON.stringify({ success: true, data: [] }),
      });
      return;
    }

    if (/\/api\/storage\/sample\/SAMPLE-001(?:\?.*)?$/.test(url) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            sampleID: 'SAMPLE-001',
            barcode: 'BC001',
            storageLocation: {
              freezerName: 'Freezer A',
              shelfName: 'Prateleira 1',
              rackName: 'Rack 2',
              boxName: 'Caixa 3',
              boxID: 3,
              position: 'B2',
              dimension: { rows: 8, cols: 12 },
            },
          },
        }),
      });
      return;
    }

    if (/\/api\/storage\/release\/SAMPLE-001(?:\?.*)?$/.test(url) && method === 'DELETE') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
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

test.describe('E2E - Storage / Inventario Fisico', () => {
  test('deve alternar para secao de armazenagem e renderizar locator', async ({ page }) => {
    await setupStoragePage(page);

    await page.getByTestId('samples-view-storage-button').click();

    await expect(page.getByTestId('samples-storage-section')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('samples-storage-locator-panel')).toBeVisible();
    await expect(page.getByTestId('sample-locator')).toBeVisible();
  });

  test('deve localizar amostra pelo locator e exibir resultado', async ({ page }) => {
    await setupStoragePage(page);

    await page.getByTestId('samples-view-storage-button').click();
    await expect(page.getByTestId('sample-locator')).toBeVisible();

    await page.getByTestId('sample-locator-input').fill('SAMPLE-001');
    await page.getByTestId('sample-locator-search-button').click();

    await expect(page.getByTestId('sample-locator-result-box')).toBeVisible();
    await expect(page.getByTestId('sample-locator-release-button')).toBeVisible();
  });

  test('deve liberar posicao da amostra localizada', async ({ page }) => {
    await setupStoragePage(page);

    await page.getByTestId('samples-view-storage-button').click();
    await page.getByTestId('sample-locator-input').fill('SAMPLE-001');
    await page.getByTestId('sample-locator-search-button').click();

    await expect(page.getByTestId('sample-locator-result-box')).toBeVisible();
    await page.getByTestId('sample-locator-release-button').click();

    await expect(page.getByTestId('sample-locator-result-box')).toBeHidden({ timeout: 10000 });
  });
});
