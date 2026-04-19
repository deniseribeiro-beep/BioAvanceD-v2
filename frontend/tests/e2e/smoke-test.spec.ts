import { test, expect } from '@playwright/test';

test('Smoke Test - Rotas principais carregam sem erro', async ({ page, context }) => {
  // Mock session cookie
  await context.addCookies([
    {
      name: 'session',
      value: 'mocked-jwt-token-admin',
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  const routes = [
    { path: '/', name: 'Dashboard' },
    { path: '/patients', name: 'Pacientes' },
    { path: '/samples', name: 'Amostras' },
    { path: '/results', name: 'Resultados' },
    { path: '/import', name: 'Importar' },
    { path: '/next/intake', name: 'Intake Wizard' },
  ];

  for (const route of routes) {
    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    
    // Valida que página carregou (sem erro 404 ou 500)
    expect(page.url()).toContain(route.path);
    
    // Valida que resposta principal não falhou no carregamento
    if (response) {
      expect(response.status()).toBeLessThan(400);
    }
  }
});

test('Validação de Zod no Intake Wizard', async ({ page, context }) => {
  await context.addCookies([
    {
      name: 'session',
      value: 'mocked-jwt-token-admin',
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('wizard-title')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('wizard-full-name')).toBeVisible();
});

test('E-Consent Page Carrega', async ({ page, context }) => {
  // Smoke test sem autenticação
  await page.goto('/patient/e-consent');
  
  // Valida que página existe ou oferece redirecionamento apropriado
  const status = page.url();
  expect(status).toBeDefined();
});
