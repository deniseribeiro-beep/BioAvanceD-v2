import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';

// Real backend + real frontend only — see backend-integration.spec.ts for the
// same skip rationale. Run via `npm run test:e2e:docker` against the compose
// test stack (or a locally running backend+frontend), never the mocked suite.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('Auth & access security (RF001) — real backend', () => {
  test('admin logs in through the real login form, reaches the system-management dashboard, and the login is audited', async ({
    page,
    request,
  }) => {
    const testUser = process.env.TEST_USER || 'admin';
    const testPass = process.env.TEST_PASS || 'Admin@123';

    // Bootstrap a token purely to read the audit trail before the UI login.
    // The action under test is the UI-driven login below, not this call.
    const bootstrap = await realLogin(request);
    const watch = await watchAuditTrail(request, apiBaseURL!, bootstrap.token);

    await page.goto('/login');
    await expect(page.getByTestId('login-page')).toBeVisible();

    await page.getByTestId('login-username-input').fill(testUser);
    await page.getByTestId('login-password-input').fill(testPass);
    await page.getByTestId('login-submit-button').click();

    // Admin's post-login route (see rolePermissions.getPostLoginRoute) —
    // only reached if the real /api/auth/login round trip succeeded and
    // ProtectedRoute accepted the resulting session.
    await page.waitForURL('**/system-management');
    await expect(page.getByTestId('system-management-page')).toBeVisible();

    await assertAuditEventRecorded(request, apiBaseURL!, bootstrap.token, watch);
  });

  test('login rejects an incorrect password', async ({ page }) => {
    const testUser = process.env.TEST_USER || 'admin';

    await page.goto('/login');
    await page.getByTestId('login-username-input').fill(testUser);
    await page.getByTestId('login-password-input').fill('definitely-wrong-password');
    await page.getByTestId('login-submit-button').click();

    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
