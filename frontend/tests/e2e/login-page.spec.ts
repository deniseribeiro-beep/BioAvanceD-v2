import { expect, test } from '@playwright/test';

test('login page renders without mocks', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByTestId('login-page')).toBeVisible();
  await expect(page.getByTestId('login-form')).toBeVisible();
  await expect(page.getByTestId('login-username-input')).toBeVisible();
  await expect(page.getByTestId('login-password-input')).toBeVisible();
  await expect(page.getByTestId('login-submit-button')).toBeVisible();
});
