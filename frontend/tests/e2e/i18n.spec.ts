import { test, expect, type Page } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken, mockAuthVerifyKeepalive } from './support/auth';
import { mockWizardDomainApis } from './support/api-mocks';

async function mockAuth(page: Page) {
  const auth = createAdminAuthContext({
    id: '1',
    userID: '1',
    username: 'qa-admin',
    name: 'QA Admin',
    accessType: 4,
    roleName: 'Administrador',
    email: 'qa-admin@bioavanced.test',
  });
  await injectSessionToken(page, auth.token);
  await mockAuthVerifyKeepalive(page, auth.user);
}

test.describe('Internationalization (i18n) - Language Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('app_language', 'pt-BR');
    });
    await mockAuth(page);
    await mockWizardDomainApis(page, { withActiveTcle: true });
  });

  test('deve renderizar o wizard e seletor de idioma com seletores estáveis', async ({ page }) => {
    await page.goto('/next/intake', { waitUntil: 'networkidle' });

    await expect(page.getByTestId('wizard-title')).toBeVisible();
    await expect(page.getByTestId('language-selector')).toBeVisible();
    await expect(page.getByTestId('wizard-full-name')).toBeVisible();
  });

  test('deve alternar para inglês e atualizar título', async ({ page }) => {
    await page.goto('/next/intake', { waitUntil: 'networkidle' });

    const title = page.getByTestId('wizard-title');
    await expect(title).toBeVisible();

    await page.getByTestId('language-selector').selectOption('en-US');
    await expect(title).toContainText(/Integrated Intake|Intake/i);
  });

  test('deve alternar para espanhol e manter UI funcional', async ({ page }) => {
    await page.goto('/next/intake', { waitUntil: 'networkidle' });

    await page.getByTestId('language-selector').selectOption('es-ES');
    await expect(page.getByTestId('wizard-title')).toContainText(/Cadastro Integrado|Integrated Intake/i);
    await expect(page.getByTestId('wizard-next-button')).toBeVisible();
  });

  test('deve preservar valor de campo ao trocar idioma', async ({ page }) => {
    await page.goto('/next/intake', { waitUntil: 'networkidle' });

    const fullName = page.getByTestId('wizard-full-name');
    await fullName.fill('Teste Paciente i18n');
    await expect(fullName).toHaveValue('Teste Paciente i18n');

    await page.getByTestId('language-selector').selectOption('en-US');
    await expect(fullName).toHaveValue('Teste Paciente i18n');
  });
});
