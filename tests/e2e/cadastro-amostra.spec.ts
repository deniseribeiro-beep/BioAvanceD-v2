import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

async function mockOntologyApis(page: Page) {
  await page.route('**/api/hpo/search**', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ id: 'HP:0000001', label: 'Marfan syndrome' }] }),
    });
  });
  await page.route('**/api/orphanet/search**', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ id: 'ORPHA:123', label: 'Marfan syndrome' }] }),
    });
  });
  await page.route('**/api/omim/search**', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ id: 'OMIM:154700', label: 'Marfan syndrome' }] }),
    });
  });
}

test('Bloqueio CLSI e cadastro válido', async ({ page }) => {
  await page.context().addCookies([
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
  await mockOntologyApis(page);
  await page.goto('http://localhost:3000/samples');
  // Inicia cadastro de amostra
  await page.getByRole('button', { name: /Nova Amostra|Cadastrar Amostra/i }).click();
  // Preenche campos obrigatórios
  await page.getByLabel('Tipo de amostra').selectOption('Sangue');
  await page.getByLabel('Aditivo').selectOption('Heparina');
  await page.getByLabel('Exame').selectOption('PCR');
  // Tenta submeter (espera bloqueio CLSI)
  await page.getByRole('button', { name: /Salvar|Cadastrar/i }).click();
  // Espera alerta de incompatibilidade
  await expect(page.locator('.alert, .clsi-error, .Toastify__toast--error')).toHaveText(/incompatibilidade|bloqueio/i);
  // Corrige para amostra válida
  await page.getByLabel('Aditivo').selectOption('EDTA');
  await page.getByRole('button', { name: /Salvar|Cadastrar/i }).click();
  // Espera toast de sucesso
  await expect(page.locator('.Toastify__toast--success')).toHaveText(/Amostra cadastrada com sucesso/i);
});
