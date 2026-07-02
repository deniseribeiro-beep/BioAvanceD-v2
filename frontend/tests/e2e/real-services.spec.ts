import { expect, test } from '@playwright/test';

test.describe('real-services smoke path', () => {
  test('uses a server-issued authenticated session', async ({ page }) => {
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login(?:$|\?)/);
  });

  test('opens the intake flow backed by deterministic seed data', async ({ page }) => {
    await page.goto('/next/intake');
    await expect(page.getByTestId('wizard-title')).toBeVisible();
  });
});
