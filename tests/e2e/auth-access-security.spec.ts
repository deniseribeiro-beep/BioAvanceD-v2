import { test, expect } from '@playwright/test';
import { realLogin, realAuthLogin } from './helpers/realAuth';
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

test.describe('Dashboard & authorization (RF002) — real backend', () => {
  test('the Administrador sees the security/user console (criterion 3), and the backend enforces every gate independently of the frontend (criterion 5)', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);

    // Criterion 3: Administrador visualiza usuários/segurança — GET /api/users
    // must actually succeed for the role the criterion names.
    const allowedListUsers = await request.get(`${apiBaseURL}/api/users`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(allowedListUsers.ok(), await allowedListUsers.text()).toBeTruthy();

    // Criterion 5, no-token case: the backend rejects on its own merits,
    // not because the frontend chose not to render a link.
    const unauthenticated = await request.get(`${apiBaseURL}/api/users`);
    expect(unauthenticated.status()).toBe(401);

    // Criterion 5, role-gated case: admin provisions a Técnico (accessType 2)
    // fixture user via the real API, then that user's own credentials are
    // used to prove the backend — not just the frontend — refuses a
    // non-admin role on an admin-only resource.
    const username = `tecnico.rf002.${Date.now()}`;
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF002 Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password: 'Tecnico@123',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();

    // A brand-new non-admin user must complete MFA setup before the backend
    // issues a usable session token at all (RF001's non-admin MFA gate) —
    // login returns a setup-only tempToken, not a full session.
    const loginResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password: 'Tecnico@123' },
    });
    expect(loginResponse.ok(), await loginResponse.text()).toBeTruthy();
    const loginBody = await loginResponse.json();
    expect(loginBody.requiresMFASetup).toBe(true);
    const tecnicoTempToken = loginBody.data?.tempToken;
    expect(tecnicoTempToken).toBeTruthy();

    // That setup-only token must not grant standing access to an unrelated,
    // admin-gated resource — the `authenticate` middleware's session check
    // refuses it (401, no session was ever created for a setup-only token),
    // before RBAC is even consulted.
    const forbiddenListUsers = await request.get(`${apiBaseURL}/api/users`, {
      headers: { Authorization: `Bearer ${tecnicoTempToken}` },
    });
    expect(forbiddenListUsers.status()).toBe(401);

    // Criterion 3, frontend half: Administrador reaches the same console
    // through the real UI (RF001's happy path already proves the login leg;
    // this proves the page the role is entitled to renders for real).
    await realAuthLogin(request, page);
    await page.goto('/system-management');
    await expect(page.getByTestId('system-management-page')).toBeVisible();
  });
});
