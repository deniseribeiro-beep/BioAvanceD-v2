import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers/mockAuth';

test.describe('TCLE builder (/admin/tcle/new)', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);
  });

  test('renders the builder form and accepts template metadata', async ({ page }) => {
    await page.goto('/admin/tcle/new');

    const nameInput = page.getByLabel('Nome do Modelo');
    const caaeInput = page.getByLabel('CAAE');

    await expect(nameInput).toBeVisible();
    await nameInput.fill('TCLE E2E Teste');
    await caaeInput.fill('12345678.9.0000.0000');

    await expect(nameInput).toHaveValue('TCLE E2E Teste');
    await expect(caaeInput).toHaveValue('12345678.9.0000.0000');
  });

  test('creating a template posts the filled-in metadata', async ({ page }) => {
    let createdPayload: Record<string, unknown> | null = null;
    await page.route('**/api/e-consent/consent-templates', async (route) => {
      if (route.request().method() !== 'POST') {
        return route.continue();
      }
      createdPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { _id: 'tcle-e2e-1', ...createdPayload } }),
      });
    });

    await page.goto('/admin/tcle/new');
    await page.getByLabel('Nome do Modelo').fill('TCLE E2E Teste');
    await page.getByLabel('CAAE').fill('12345678.9.0000.0000');
    await page.getByLabel('Data de Início da Vigência').fill('2026-01-01');
    await page.getByLabel('Data Final de Vigência').fill('2027-01-01');

    // Submit stays disabled until the rich-text body and at least one
    // granular consent item are filled in too (see disabled= condition on
    // the submit Button in TcleBuilderPage.tsx) — drive both.
    await page.getByRole('textbox', { name: 'Editor do corpo do TCLE' }).fill('Corpo do termo de consentimento para o teste e2e.');
    // A default consent item already exists on a fresh template — just fill it in.
    await page.getByPlaceholder('Ex.: Aceito ceder minhas amostras para estudos genéticos').first().fill('Aceito participar do estudo e2e');

    await page.getByRole('button', { name: 'Criar versão do TCLE' }).click();

    await expect.poll(() => createdPayload?.title ?? (createdPayload as any)?.name).toBeTruthy();
  });
});
