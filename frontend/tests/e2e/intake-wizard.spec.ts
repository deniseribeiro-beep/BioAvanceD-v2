import { test, expect, type Page } from '@playwright/test';

async function openWizard(page: Page) {
  await page.goto('/next/intake');
  await expect(page.getByTestId('wizard-title')).toBeVisible({ timeout: 10_000 });
}

test('Documento aplica máscara de CPF e preserva passaporte alfanumérico', async ({ page }) => {
  await openWizard(page);
  const input = page.getByTestId('wizard-document');
  await input.fill('13360378652');
  await expect(input).toHaveValue('133.603.786-52');
  await input.fill('ab123456');
  await expect(input).toHaveValue('AB123456');
  await expect(input).not.toHaveAttribute('inputmode', 'numeric');
});

test('Documento rejeita CPF inválido e impede avanço', async ({ page }) => {
  await openWizard(page);
  await page.getByTestId('wizard-full-name').fill('Paciente Sintetico');
  await page.getByTestId('wizard-birth-date').fill('10/10/1990');
  await page.getByTestId('wizard-gender').selectOption('F');
  await page.getByTestId('wizard-email').fill('patient.synthetic@example.test');
  await page.getByTestId('wizard-document').fill('12345678900');
  await page.getByTestId('wizard-next-button').click();
  await expect(page.getByText(/documento válido|valid document/i)).toBeVisible();
});

test('Fabry ORPHA:324 é carregado pelas APIs reais', async ({ request }) => {
  const terminology = await request.get('http://backend-test:3000/api/dictionary/search', {
    params: { query: 'ORPHA:324' },
  });
  expect(terminology.ok()).toBe(true);
  const payload = await terminology.json();
  expect(payload.results).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'ORPHA:324' }),
  ]));
});
