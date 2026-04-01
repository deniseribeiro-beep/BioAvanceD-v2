import { test, expect } from '@playwright/test';

test('sanity check', async ({ page }) => {
  await page.goto('about:blank');
  expect(true).toBeTruthy();
});
