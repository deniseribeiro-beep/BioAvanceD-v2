/// <reference types="node" />
import { expect, test } from '@playwright/test';

const FRONTEND_URL = process.env.E2E_FRONTEND_URL || 'http://34.60.170.17:5173';
const API_URL = process.env.E2E_API_URL || 'http://34.60.170.17:3000';
const CORS_ORIGIN = 'http://34.60.170.17:5173';

test.describe('VM deploy smoke', () => {
  test('frontend publico carrega', async ({ page }) => {
    const response = await page.goto(FRONTEND_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toBeVisible();
  });

  test('backend publico responde health', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health`);

    expect(response.status()).toBe(200);
  });

  test('backend publico retorna CORS para frontend publico', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health`, {
      headers: {
        Origin: CORS_ORIGIN,
      },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['access-control-allow-origin']).toBe(CORS_ORIGIN);
  });
});
