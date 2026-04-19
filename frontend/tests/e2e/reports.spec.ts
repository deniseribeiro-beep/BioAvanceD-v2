import { test, expect } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken, mockAuthVerifyKeepalive } from './support/auth';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Reports - Critical flow', () => {
  test('carrega a central de relatórios e navega para a consulta', async ({ page }) => {
    const auth = createAdminAuthContext();
    await injectSessionToken(page, auth.token);
    await mockAuthVerifyKeepalive(page, auth.user);

    await page.route('**/api/reports**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (method === 'GET' && /\/api\/reports\/[^/]+\/filters$/.test(url)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            filters: [
              { name: 'startDate', label: 'Data Inicial', type: 'date' },
              { name: 'endDate', label: 'Data Final', type: 'date' },
            ],
          }),
        });
        return;
      }

      if (method === 'GET' && /\/api\/reports(\?.*)?$/.test(url)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { _id: '507f1f77bcf86cd799439001', reportID: 1, reportType: 'patients', generatedAt: '2026-04-01T10:00:00.000Z' },
          ]),
        });
        return;
      }

      if (method === 'POST' && /\/api\/reports\/generate$/.test(url)) {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ reportID: 2, reportType: 'audit' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/reports');
    await expect(page.getByText('Central de Relatórios')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Fluxo com filtros dinâmicos')).toBeVisible();
    await expect(page.locator('.report-card').first()).toBeVisible();

    await page.locator('.report-button').first().click();
    await expect(page).toHaveURL(/\/reports\/query\//);
  });
});
