import { test, expect } from '@playwright/test';

test.describe('Internationalization with real backend session', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/next/intake', { waitUntil: 'networkidle' });
  });

  test('switches languages without losing entered data', async ({ page }) => {
    const title = page.getByTestId('wizard-title');
    const fullName = page.getByTestId('wizard-full-name');
    await expect(title).toBeVisible();
    await fullName.fill('Paciente Sintetico i18n');
    await page.getByTestId('language-selector').selectOption('en-US');
    await expect(title).toContainText(/Integrated Intake|Intake/i);
    await expect(fullName).toHaveValue('Paciente Sintetico i18n');
    await page.getByTestId('language-selector').selectOption('es-ES');
    await expect(page.getByTestId('wizard-next-button')).toBeVisible();
  });
});
