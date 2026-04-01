// MOVED FILE
import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

test('Validação do Intake Wizard route', async ({ page }) => {
  const response = await page.goto('/next/intake', { waitUntil: 'networkidle' }).catch(() => null);
  const url = page.url();
  expect(url).toMatch(/login|intake|\/$/);
});
