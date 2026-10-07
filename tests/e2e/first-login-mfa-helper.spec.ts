import { test, expect } from '@playwright/test';
import { realLogin } from './helpers/realAuth';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';

// Real backend only — see auth-access-security.spec.ts for the same skip
// rationale. Run via `npm run test:e2e:docker`.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('First-login MFA e2e helper (#293) — real backend', () => {
  test('completing RF001 first-login MFA setup yields a genuine non-admin session, not the setup-only tempToken', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const username = `tecnico.totp.${Date.now()}`;
    const password = 'Tecnico@123-forte';
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'TOTP Helper Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();

    // Plain login still returns only a setup-only tempToken — RF001's
    // non-admin MFA gate (auth.service.js processLogin) has not been
    // cleared yet.
    const plainLogin = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password },
    });
    expect(plainLogin.ok(), await plainLogin.text()).toBeTruthy();
    const plainLoginBody = await plainLogin.json();
    expect(plainLoginBody.requiresMFASetup).toBe(true);

    // Complete the real TOTP setup/enable round trip — the thing #293
    // says no e2e spec could do before this helper existed.
    const session = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    expect(session.token).toBeTruthy();
    expect(session.user.roleName).toBe('Técnico');

    // Positive proof: this is a real session, not a tempToken — a plain
    // `authenticate`-gated route (no RBAC) succeeds where the tempToken
    // would 401 (see auth-access-security.spec.ts's RF002/RNF008 cases).
    const verify = await request.get(`${apiBaseURL}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(verify.ok(), await verify.text()).toBeTruthy();

    // Negative proof: the backend refuses an admin-only resource for a
    // genuine non-admin session with a real 403 (RBAC enforced against
    // the role), not the 401 a setup-only tempToken always produced —
    // the exact gap #293 flagged as unprovable before this helper.
    const forbiddenListUsers = await request.get(`${apiBaseURL}/api/users`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(forbiddenListUsers.status()).toBe(403);
  });
});
