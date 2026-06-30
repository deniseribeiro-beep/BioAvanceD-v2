import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

async function mockOntologyApis(page: Page) {
  await page.route('**/api/hpo/search**', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 'HP:0000001', label: 'Marfan syndrome' }],
      }),
    });
  });
  await page.route('**/api/orphanet/search**', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 'ORPHA:123', label: 'Marfan syndrome' }],
      }),
    });
  });
  await page.route('**/api/omim/search**', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ id: 'OMIM:154700', label: 'Marfan syndrome' }],
      }),
    });
  });
}

test('Preenchimento e submissão do TCLE dinâmico', async ({ page }) => {
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
  await page.goto('/admin/tcle/new');
  await expect(page.getByLabel('Nome do Modelo')).toBeVisible();
  await page.getByLabel('Nome do Modelo').fill('TCLE Teste E2E');
  await page.getByLabel('CAAE').fill('12345678.9.0000.0000');
  await page.getByLabel('Data de Início da Vigência').fill('2026-04-01');
  await page.getByLabel('Data Final de Vigência').fill('2026-12-31');
  // Corpo do termo (editor rich text)
  await page.getByRole('textbox', { name: 'Editor do corpo do TCLE' }).fill('Este é um TCLE de teste automatizado.');
  // Adiciona um consentimento granular
  await page.getByRole('button', { name: /Adicionar consentimento/i }).click();
  await page.getByPlaceholder('Ex.: Aceito ceder minhas amostras para estudos genéticos').first().fill('Aceito uso de dados para pesquisa.');
  // Marca como obrigatório
  await page.locator('label:has-text("Checkbox obrigatório") input[type="checkbox"]').first().check();
  // Submete
  await page.getByRole('button', { name: /Criar versão do TCLE/i }).click();
  // Espera toast de sucesso
  await expect(page.locator('.Toastify__toast--success')).toHaveText(/TCLE criado com sucesso/i);
});
