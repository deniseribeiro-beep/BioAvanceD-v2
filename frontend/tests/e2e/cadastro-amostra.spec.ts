// MOVED FILE
import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';




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
  // Mocks removidos após execução dos testes
  await page.goto('/samples');
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
