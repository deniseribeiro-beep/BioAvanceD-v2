import { expect, type Page } from '@playwright/test';

/**
 * #1222: wait for the wizard's own ready signal before the first demographic
 * fill. Filling while the mount-time terminologies / consent-templates
 * responses are still in flight races a Chromium renderer stall under
 * Playwright (body size -1 after a 200). This is the page precondition, not
 * a fixed sleep.
 */
export async function waitForIntakeWizardReady(page: Page) {
  await expect(page.getByTestId('intake-wizard-root')).toBeVisible();
  await expect(page.getByTestId('wizard-step1-ready')).toBeAttached({ timeout: 30_000 });
}
