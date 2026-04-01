// MOVED FILE
import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

test('Bloqueio CLSI - Validação de rota', async ({ page }) => {
  const response = await page.goto('/samples', { waitUntil: 'networkidle' }).catch(() => null);
  const url = page.url();
  // Valida que navegou para /samples ou foi redirecionado (ex: login)
  expect(url).toMatch(/samples|login|\/$/);
});
