import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';

// #1331: a saved MFA recovery code signs in once, through the login screen's
// "use a recovery code" option, and is refused when used again. Real backend
// only, so the single-use update runs against the stack's own MongoDB.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('MFA recovery codes at sign-in (#1331) — real backend', () => {
  test('a recovery code signs in once from the login screen and is refused on reuse', async ({ page, request }) => {
    const admin = await realLogin(request);
    const username = `tecnico.1331.${Date.now()}`;
    const password = 'Recovery@1331pass';
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { name: '#1331 recovery Fixture', email: `${username}@example.com`, username, password, accessType: 2, roleName: 'Técnico' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();

    const session = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    const generated = await request.post(`${apiBaseURL}/api/user/security/recovery-codes`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(generated.status(), await generated.text()).toBe(201);
    const codes: string[] = (await generated.json()).data?.codes;
    expect(codes).toHaveLength(10);

    // The login screen: password, then the recovery code in place of TOTP.
    await page.goto('/login');
    await page.getByTestId('login-username-input').fill(username);
    await page.getByTestId('login-password-input').fill(password);
    await page.getByTestId('login-submit-button').click();
    await expect(page.getByTestId('two-factor-section')).toBeVisible();
    await page.getByTestId('login-toggle-recovery-code').click();
    await page.getByTestId('login-recovery-code-input').fill(codes[0].toLowerCase());
    await page.getByTestId('login-submit-button').click();
    await page.waitForURL((url) => !url.pathname.endsWith('/login'));

    // Spent: the same code is refused like a wrong TOTP code.
    const reuse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password, twoFactorCode: codes[0] },
    });
    expect(reuse.status()).toBe(401);
    expect((await reuse.json()).message).toBe('Código MFA inválido');

    // Another code from the same set still works, and the count follows.
    const second = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password, twoFactorCode: codes[1] },
    });
    expect(second.ok(), await second.text()).toBeTruthy();
    const token = (await second.json()).data?.token;
    expect(token).toBeTruthy();

    const status = await request.get(`${apiBaseURL}/api/user/security/mfa`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status.ok(), await status.text()).toBeTruthy();
    expect((await status.json()).data?.recoveryCodes?.remaining).toBe(8);
  });
});
