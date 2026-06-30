import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

// Toast selector: the app uses its own Toast component (not Toastify).
// Renders as <div class="toast toast-success" role="alert">.
const TOAST_SUCCESS = '.toast.toast-success';

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

test('Cadastro clínico do paciente com validação Zod', async ({ page }) => {
  await mockOntologyApis(page);

  // Route is /next/intake (not /v2/intake — that was an old path that no longer exists)
  await page.goto('/next/intake');

  // Step 1: Demographics — use data-testid selectors from ClinicalIntakeWizard.jsx
  await expect(page.getByTestId('wizard-full-name')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('wizard-full-name').fill('Paciente E2E Playwright');
  // Birth date expects DD/MM/AAAA text format (not ISO) per the wizard Zod schema
  await page.getByTestId('wizard-birth-date').fill('01/01/1990');
  // Gender select: M / F / O
  await page.getByTestId('wizard-gender').selectOption('F');
  await page.getByTestId('wizard-email').fill('paciente.e2e@bioavanced.com');
  // Valid CPF required for living patients (Zod validates algorithmically)
  await page.getByTestId('wizard-document').fill('111.444.777-35');

  // Advance to next step
  await page.getByRole('button', { name: /Próximo|Next/i }).click();

  // No Zod validation errors should appear after step 1
  await expect(page.locator('.zod-error, .error-message, .input-error-message')).toHaveCount(0);
});
