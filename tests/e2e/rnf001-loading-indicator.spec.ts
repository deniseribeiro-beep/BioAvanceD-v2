import { test, expect, Page, Route } from '@playwright/test';
import { realAuthLogin } from './helpers/realAuth';

// RNF001 C2 (#1469): an operation that takes over 500 ms shows a processing
// indicator. Each case holds one real request in the browser until the test
// releases it, checks the indicator is on screen once that request has been
// pending for over 500 ms, then releases it and checks the indicator goes.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

const INDICATOR_BUDGET_MS = 500;
const LOADING_TEXT = /^(Carregando|Loading|Cargando)\b/;

interface HeldRequest {
  held: Promise<void>;
  release: () => void;
  pendingMs: () => number;
}

// Holds every request matching url and method until release() is called; the
// first one to arrive resolves held and starts the pendingMs clock.
async function holdRequests(page: Page, url: RegExp, method: string): Promise<HeldRequest> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  let heldAt = 0;
  await page.route(url, async (route: Route) => {
    if (route.request().method() !== method) {
      await route.fallback();
      return;
    }
    if (!heldAt) heldAt = Date.now();
    markHeld();
    await released;
    await route.continue();
  });
  return { held, release, pendingMs: () => (heldAt ? Date.now() - heldAt : 0) };
}

test.describe('RNF001 C2: loading indicator past 500 ms', () => {
  test('the patient list shows its loading text while its read is pending past 500 ms', async ({ page, request }) => {
    await realAuthLogin(request, page);
    const hold = await holdRequests(page, /\/api\/patients(\?|$)/, 'GET');
    const indicator = page.getByRole('main').getByText(LOADING_TEXT);
    try {
      await page.goto('/patients');
      await hold.held;
      await expect.poll(() => hold.pendingMs()).toBeGreaterThan(INDICATOR_BUDGET_MS);
      await expect(indicator).toBeVisible();
    } finally {
      hold.release();
    }
    await expect(indicator).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('h1.page-title')).toBeVisible();
  });

  test('the login button shows its loading text while the login is pending past 500 ms', async ({ page }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';
    const hold = await holdRequests(page, /\/api\/auth\/login$/, 'POST');
    const button = page.getByTestId('login-submit-button');
    try {
      await page.goto('/login');
      await expect(page.getByTestId('login-page')).toBeVisible();
      await page.getByTestId('login-username-input').fill(testUser);
      await page.getByTestId('login-password-input').fill(testPass);
      await button.click();
      await hold.held;
      await expect.poll(() => hold.pendingMs()).toBeGreaterThan(INDICATOR_BUDGET_MS);
      await expect(button).toBeDisabled();
      await expect(button).toHaveText(LOADING_TEXT);
    } finally {
      hold.release();
    }
    // Admin's post-login route, reached only once the held login completed.
    await page.waitForURL('**/system-management');
    await expect(page.getByTestId('system-management-page')).toBeVisible();
  });
});
