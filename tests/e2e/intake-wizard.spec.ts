import { test, expect } from '@playwright/test';
import { mockLogin } from './helpers/mockAuth';

test.describe('Intake wizard (/next/intake)', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page);

    // useIntakeDictionaryData loads this once on mount; an empty-but-valid
    // response is enough for the demographic step to render.
    await page.route('**/api/terminologies**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    });
  });

  test('renders the demographic step and accepts patient data entry', async ({ page }) => {
    await page.goto('/next/intake');

    await expect(page.getByTestId('intake-wizard-root')).toBeVisible();
    await expect(page.getByTestId('wizard-title')).toBeVisible();

    await page.getByTestId('wizard-full-name').fill('Paciente Teste E2E');
    await page.getByTestId('wizard-birth-date').fill('01/01/1990');
    await page.getByTestId('wizard-gender').selectOption('F');

    await expect(page.getByTestId('wizard-full-name')).toHaveValue('Paciente Teste E2E');
    await expect(page.getByTestId('wizard-gender')).toHaveValue('F');
  });

  test('advancing past the demographic step requires the required fields', async ({ page }) => {
    await page.goto('/next/intake');
    await expect(page.getByTestId('wizard-next-button')).toBeVisible();

    // No fields filled in — clicking next must not silently advance past
    // required-field validation on the demographic step.
    await page.getByTestId('wizard-next-button').click();
    await expect(page.getByTestId('wizard-full-name')).toBeVisible();
  });
});
