/// <reference types="node" />
import { test, expect } from '@playwright/test';

const FRONTEND_URL = process.env.E2E_FRONTEND_URL || 'http://34.60.170.17:5173';
const API_URL = process.env.E2E_API_URL || 'http://34.60.170.17:3000';

test.describe('BioAvanceD VM Smoke Test', () => {
  test('frontend público carrega', async ({ page }) => {
    const response = await page.goto(FRONTEND_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('body')).toBeVisible();
  });

  test('backend público responde health', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health`);
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('status');
  });

  test('backend aceita CORS do frontend público', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/health`, {
      headers: {
        Origin: FRONTEND_URL,
      },
    });

    expect(response.ok()).toBeTruthy();

    const allowOrigin = response.headers()['access-control-allow-origin'];
    expect(allowOrigin).toBe(FRONTEND_URL);
  });
});