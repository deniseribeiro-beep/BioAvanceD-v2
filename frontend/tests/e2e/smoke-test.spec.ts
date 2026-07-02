import { test, expect } from '@playwright/test';

test('rotas principais carregam com sessão emitida pelo backend', async ({ page }) => {
  for (const route of ['/', '/patients', '/samples', '/results', '/import', '/next/intake']) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(page.url()).toContain(route);
    if (response) expect(response.status()).toBeLessThan(400);
  }
});

test('e-consent público responde sem infraestrutura simulada', async ({ page }) => {
  const response = await page.goto('/patient/e-consent');
  if (response) expect(response.status()).toBeLessThan(500);
});
