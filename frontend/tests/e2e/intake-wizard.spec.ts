// MOVED FILE
import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';




test('Cadastro clínico do paciente com validação Zod', async ({ page }) => {
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
  await page.goto('/next/intake');
  // Passo 1: Dados Demográficos
  await page.getByLabel('Nome completo do paciente').fill('Paciente E2E Playwright');
  await page.getByLabel('Data de nascimento').fill('01/01/1990');
  await page.getByLabel('Sexo').selectOption('Feminino');
  await page.getByLabel('E-mail').fill('paciente.e2e@bioavanced.com');
  await page.getByLabel('Documento').fill('12345678901');
  // Avança para próxima etapa
  await page.getByRole('button', { name: /Próximo/i }).click();
  // Espera não aparecer mensagem de erro Zod
  await expect(page.locator('.zod-error, .error-message')).toHaveCount(0);
  // Passo 2: Amostra Pré-analítica (preencher campos obrigatórios mínimos)
  await page.getByLabel('Tipo de amostra').selectOption('Sangue');
  await page.getByLabel('Origem da amostra').selectOption('Veia');
  await page.getByLabel('Protocolo de extração').fill('Protocolo Teste');
  await page.getByLabel('Quantidade').fill('10');
  await page.getByLabel('Qualidade').selectOption('Boa');
  // Avança para próxima etapa
  await page.getByRole('button', { name: /Próximo/i }).click();
  // Passo 3: Biomarcadores & Clínica (opcional)
  // Finaliza cadastro
  await page.getByRole('button', { name: /Finalizar cadastro/i }).click();
  // Espera toast de sucesso
  await expect(page.locator('.Toastify__toast--success')).toHaveText(/Cadastro realizado com sucesso/i);
});
