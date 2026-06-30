import { test, expect } from '@playwright/test';

// Toast selector: the app uses its own Toast component (not Toastify).
// Renders as <div class="toast toast-success" role="alert">.
const TOAST_SUCCESS = '.toast.toast-success';

test('Preenchimento e submissão do TCLE dinâmico', async ({ page }) => {
  await page.goto('/admin/tcle/new');

  await expect(page.getByLabel('Nome do Modelo')).toBeVisible({ timeout: 10000 });
  await page.getByLabel('Nome do Modelo').fill('TCLE Teste E2E');
  await page.getByLabel('CAAE').fill('12345678.9.0000.0000');
  await page.getByLabel('Data de Início da Vigência').fill('2026-04-01');
  await page.getByLabel('Data Final de Vigência').fill('2026-12-31');

  // Rich-text editor: the aria-label on the contenteditable div
  const editor = page.getByRole('textbox', { name: /Editor do corpo do TCLE/i });
  if (await editor.isVisible()) {
    await editor.fill('Este é um TCLE de teste automatizado.');
  } else {
    // Fallback: find any contenteditable inside the builder
    const contentEditable = page.locator('[contenteditable="true"]').first();
    await contentEditable.click();
    await contentEditable.fill('Este é um TCLE de teste automatizado.');
  }

  // Add a consent item
  await page.getByRole('button', { name: /Adicionar consentimento/i }).click();
  await page.getByPlaceholder(/Aceito ceder/i).first().fill('Aceito uso de dados para pesquisa.');

  await page.getByRole('button', { name: /Criar versão do TCLE/i }).click();

  // App uses its own toast system — class is "toast toast-success", role="alert"
  await expect(page.locator(TOAST_SUCCESS)).toContainText(/TCLE criado com sucesso/i, { timeout: 10000 });
});
