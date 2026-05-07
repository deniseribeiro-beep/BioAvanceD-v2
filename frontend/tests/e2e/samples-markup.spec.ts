import { test, expect, type Page, type Route } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken } from './support/auth';

test.use({ storageState: { cookies: [], origins: [] } });

const requiredTestids = [
  'samples-page-title',
  'samples-search-input',
  'samples-search-button',
  'samples-table',
  'samples-select-all-checkbox',
  'samples-scan-button',
];

async function openSamples(page: Page) {
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

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
  });

  await page.goto('/samples');
  if (page.url().includes('/login')) {
    await page.getByTestId('login-username-input').fill('admin');
    await page.getByTestId('login-password-input').fill('Admin@123');
    await page.getByTestId('login-submit-button').click();
    await page.goto('/samples');
  }
}

test.describe('Samples - Markup', () => {
  for (const testid of requiredTestids) {
    test(`elemento ${testid} existe na tela`, async ({ page }) => {
      await openSamples(page);
      await expect(page.getByTestId(testid)).toBeVisible({ timeout: 10000 });
    });
  }

  test('auditoria completa de data-testid retorna zero faltantes', async ({ page }) => {
    await openSamples(page);
    await expect(page.getByTestId('samples-page-title')).toBeVisible({ timeout: 10000 });

    const missing: string[] = [];
    for (const testid of requiredTestids) {
      const count = await page.getByTestId(testid).count();
      if (count === 0) missing.push(testid);
    }

    expect(missing).toEqual([]);
  });
});
