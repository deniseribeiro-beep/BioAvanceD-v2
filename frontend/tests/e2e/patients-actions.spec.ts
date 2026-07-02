import { test, expect } from '@playwright/test';

test('paciente sintético pode abrir o fluxo real de edição', async ({ page }) => {
  await page.goto('/patients', { waitUntil: 'networkidle' });
  const row = page.getByTestId('patient-row-TEST-PATIENT-001');
  await expect(row).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('edit-patient-button-TEST-PATIENT-001').click();
  await expect(page).toHaveURL(/\/next\/intake/);
});
