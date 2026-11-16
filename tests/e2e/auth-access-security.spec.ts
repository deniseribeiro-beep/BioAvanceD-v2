import crypto from 'crypto';
import { test, expect, APIRequestContext } from '@playwright/test';
import { realLogin, realAuthLogin, seedRealAuth } from './helpers/realAuth';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import { computeTotp } from './helpers/totp';
import { deleteOrganizations } from './helpers/listOrganizations';
import { listLoginAttemptRows, listLoginAttemptIndexes, clearLoginAttempts, closeLoginAttemptsDb, findLogRows } from './helpers/queryLoginAttempts';
import { findLatestSession, closeSessionsDb, listSessionIndexNames, setPasswordChangedAt } from './helpers/querySessions';
import { invariantViolationsFor, configurationChangeEventsFor, configurationValidationRunById, closeFoundationDb } from './helpers/queryFoundationData';
import { findStoredUser, setStoredSessionTimeoutMinutes, closeStoredCredentialsDb } from './helpers/storedCredentials1456';

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
    const testPass = process.env.TEST_PASS || 'Admin@123-e2e-stack';

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
        password: 'Tecnico@123-forte',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();

    // A brand-new non-admin user must complete MFA setup before the backend
    // issues a usable session token at all (RF001's non-admin MFA gate) —
    // login returns a setup-only tempToken, not a full session.
    const loginResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password: 'Tecnico@123-forte' },
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

    // Stronger proof (#335): complete the Técnico's first-login MFA to get
    // a genuine non-admin session (see #293's completeFirstLoginMfa), and
    // confirm the backend's RBAC gate itself refuses it with a real 403 —
    // not just the setup-only tempToken's 401 above.
    const tecnicoSession = await completeFirstLoginMfa(request, apiBaseURL!, username, 'Tecnico@123-forte');
    const forbiddenListUsersRbac = await request.get(`${apiBaseURL}/api/users`, {
      headers: { Authorization: `Bearer ${tecnicoSession.token}` },
    });
    expect(forbiddenListUsersRbac.status()).toBe(403);

    // Criterion 3, frontend half: Administrador reaches the same console
    // through the real UI (RF001's happy path already proves the login leg;
    // this proves the page the role is entitled to renders for real).
    await realAuthLogin(request, page);
    await page.goto('/system-management');
    await expect(page.getByTestId('system-management-page')).toBeVisible();
  });
});

test.describe('User management (RF003) — real backend', () => {
  // #1282: the organizations these tests create, deleted once they are done.
  const organizationIds: string[] = [];

  test.afterAll(async ({ request }) => {
    await deleteOrganizations(request, apiBaseURL!, organizationIds);
  });

  test('admin creates a user (criterion 1 happy path), the creation is audited (criterion 6), and a duplicate email/username is rejected (criterion 1 edge case)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const username = `tecnico.rf003.${Date.now()}`;
    const email = `${username}@example.com`;
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF003 Técnico Fixture',
        email,
        username,
        password: 'Tecnico@123-forte',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();

    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);

    // Criterion 1, rejection case: the same email AND the same username
    // (in separate attempts) must each be refused as already-registered,
    // not silently create a duplicate account.
    const duplicateEmail = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF003 Duplicate Email',
        email,
        username: `${username}.dup`,
        password: 'Tecnico@123-forte',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(duplicateEmail.status()).toBe(400);

    const duplicateUsername = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF003 Duplicate Username',
        email: `${username}.dup@example.com`,
        username,
        password: 'Tecnico@123-forte',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(duplicateUsername.status()).toBe(400);
  });

  test('a Técnico cannot create a user — the backend enforces the createUser RBAC gate independently of the frontend (RNF008)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    // Provision a Técnico fixture the same way RF002's cross-role test does,
    // then use that user's own credentials to prove the backend refuses a
    // non-admin/coordenador role on the user-creation endpoint.
    const tecnicoUsername = `tecnico.rnf008.${Date.now()}`;
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RNF008 Técnico Fixture',
        email: `${tecnicoUsername}@example.com`,
        username: tecnicoUsername,
        password: 'Tecnico@123-forte',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();

    const loginResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username: tecnicoUsername, password: 'Tecnico@123-forte' },
    });
    expect(loginResponse.ok(), await loginResponse.text()).toBeTruthy();
    const loginBody = await loginResponse.json();
    const tecnicoTempToken = loginBody.data?.tempToken;
    expect(tecnicoTempToken).toBeTruthy();

    const forbiddenRegister = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${tecnicoTempToken}` },
      data: {
        name: 'Should Not Be Created',
        email: `blocked.${Date.now()}@example.com`,
        username: `blocked.${Date.now()}`,
        password: 'Blocked@123-forte',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    // The setup-only tempToken has no session yet (401), independent of the
    // 403 the RBAC gate would otherwise apply to a real Técnico session —
    // either way the backend refuses on its own merits, per criterion 5.
    expect(forbiddenRegister.status()).toBe(401);

    // Stronger proof (#335): complete the Técnico's first-login MFA to get
    // a genuine non-admin session, and confirm createUser's RBAC gate
    // itself refuses it with a real 403 — not just the tempToken's 401.
    const tecnicoSession = await completeFirstLoginMfa(request, apiBaseURL!, tecnicoUsername, 'Tecnico@123-forte');
    const forbiddenRegisterRbac = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${tecnicoSession.token}` },
      data: {
        name: 'Should Not Be Created (RBAC)',
        email: `blocked.rbac.${Date.now()}@example.com`,
        username: `blocked.rbac.${Date.now()}`,
        password: 'Blocked@123-forte',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(forbiddenRegisterRbac.status()).toBe(403);
  });

  test('password complexity is enforced and a recently-used password is rejected (criterion 2)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    // A fresh Técnico fixture, with a real (MFA-completed) session, changes
    // its own password via PUT /api/user/security/password — the self-service
    // route userSecurityService.updatePassword backs (see criterion 2's
    // complexity + history requirements).
    const username = `tecnico.rf003ac2.${Date.now()}`;
    const initialPassword = 'Tecnico@123456-forte';
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF003 AC2 Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password: initialPassword,
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();

    const tecnicoSession = await completeFirstLoginMfa(request, apiBaseURL!, username, initialPassword);

    // Rejection case: a new password failing the passwordRules policy (#1246)
    // is refused — here, missing a special character. #1293: a new deployment
    // has the composition flags off (#1257), so the test sets the rule it
    // asserts and restores the stored values afterwards.
    const adminAuth = { Authorization: `Bearer ${admin.token}` };
    const before = await request.get(`${apiBaseURL}/api/security/config`, { headers: adminAuth });
    expect(before.ok()).toBeTruthy();
    const original = (await before.json()).data;
    try {
      const strict = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: adminAuth,
        data: { authentication: { requireStrongPassword: true }, passwordRules: { requireSpecialChars: true } },
      });
      expect(strict.ok(), await strict.text()).toBeTruthy();

      const weakAttempt = await request.put(`${apiBaseURL}/api/user/security/password`, {
        headers: { Authorization: `Bearer ${tecnicoSession.token}` },
        data: { currentPassword: initialPassword, newPassword: 'Weak1234567' },
      });
      expect(weakAttempt.status()).toBe(400);
    } finally {
      await request.put(`${apiBaseURL}/api/security/config`, {
        headers: adminAuth,
        data: {
          authentication: { requireStrongPassword: original.authentication.requireStrongPassword },
          passwordRules: { requireSpecialChars: original.passwordRules.requireSpecialChars },
        },
      }).catch(() => {});
    }

    // Happy path: a complying new password is accepted, and the change is
    // audited.
    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    const newPassword = 'Tecnico!New456-forte';
    const changeResponse = await request.put(`${apiBaseURL}/api/user/security/password`, {
      headers: { Authorization: `Bearer ${tecnicoSession.token}` },
      data: { currentPassword: initialPassword, newPassword },
    });
    expect(changeResponse.ok(), await changeResponse.text()).toBeTruthy();
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);

    // Reuse case: attempting to change back to a password in the last-5
    // history (the just-replaced original password) is rejected.
    const reuseAttempt = await request.put(`${apiBaseURL}/api/user/security/password`, {
      headers: { Authorization: `Bearer ${tecnicoSession.token}` },
      data: { currentPassword: newPassword, newPassword: initialPassword },
    });
    expect(reuseAttempt.status()).toBe(400);
  });

  test('a role assignment carries a validity period and organizational scope, and an expired assignment is refused (criterion 3)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const username = `tecnico.rf003ac3.${Date.now()}`;
    const password = 'Tecnico@123456-forte';
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF003 AC3 Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();
    const userID = (await registerResponse.json()).data?._id || (await registerResponse.json()).data?.id;

    // Organizational scope (#346/#347) is now a Reference[] to real Organization
    // documents, not free-text institution names — create the two orgs first.
    const orgSuffix = Date.now();
    const orgA = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { officialName: `Hospital Central ${orgSuffix}`, countryCode: 'BR' },
    });
    expect(orgA.ok(), await orgA.text()).toBeTruthy();
    const orgAId = (await orgA.json()).data?.organizationId;
    organizationIds.push(orgAId);
    const orgB = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { officialName: `Biobanco Norte ${orgSuffix}`, countryCode: 'BR' },
    });
    expect(orgB.ok(), await orgB.text()).toBeTruthy();
    const orgBId = (await orgB.json()).data?.organizationId;
    organizationIds.push(orgBId);

    // Admin assigns the role with a validity period (already in the past —
    // proves enforcement, not just storage) and an organizational scope.
    const roleValidFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const roleValidUntil = new Date(Date.now() - 1000).toISOString();
    const assignResponse = await request.put(`${apiBaseURL}/api/users/${userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        roleValidFrom,
        roleValidUntil,
        organizationIds: [orgAId, orgBId],
      },
    });
    expect(assignResponse.ok(), await assignResponse.text()).toBeTruthy();
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);

    // Persisted and returned, not silently dropped.
    const fetchResponse = await request.get(`${apiBaseURL}/api/users/${userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const fetchedUser = (await fetchResponse.json()).data;
    expect(new Date(fetchedUser.roleValidUntil).toISOString()).toBe(roleValidUntil);
    expect(fetchedUser.organizationIds).toEqual([orgAId, orgBId]);

    // The account can still log in (login itself isn't role-gated), but a
    // session under an already-expired role assignment is refused on the
    // very next authenticated call — the backend enforces vigência itself,
    // not just displays it.
    const qrResponse = await request.post(`${apiBaseURL}/api/auth/two-factor/qr-first-login`, {
      data: { username, password },
    });
    expect(qrResponse.ok(), await qrResponse.text()).toBeTruthy();
    const totpSecret = (await qrResponse.json()).data?.secret;
    const enableResponse = await request.post(`${apiBaseURL}/api/auth/two-factor/enable-first-login`, {
      data: { username, password, code: computeTotp(totpSecret) },
    });
    expect(enableResponse.ok(), await enableResponse.text()).toBeTruthy();
    const tecnicoToken = (await enableResponse.json()).data?.token;
    expect(tecnicoToken).toBeTruthy();

    const expiredRoleAttempt = await request.get(`${apiBaseURL}/api/user/security/status`, {
      headers: { Authorization: `Bearer ${tecnicoToken}` },
    });
    expect(expiredRoleAttempt.status()).toBe(403);

    // Extending validity into the future lifts the block again.
    const futureExtension = await request.put(`${apiBaseURL}/api/users/${userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { roleValidUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    });
    expect(futureExtension.ok(), await futureExtension.text()).toBeTruthy();

    const restoredAccess = await request.get(`${apiBaseURL}/api/user/security/status`, {
      headers: { Authorization: `Bearer ${tecnicoToken}` },
    });
    expect(restoredAccess.ok(), await restoredAccess.text()).toBeTruthy();
  });

  test('an account is inactivated without deleting its history (criterion 4)', async ({ request }) => {
    const admin = await realLogin(request);
    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

    const username = `tecnico.rf003ac4.${Date.now()}`;
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF003 AC4 Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password: 'Tecnico@123456-forte',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();
    const userID = (await registerResponse.json()).data?._id || (await registerResponse.json()).data?.id;

    // Inactivation here is PUT /:id with status: 'inactive'. DELETE /:id is
    // logical too since #1306; the session-lifecycle block at the end of this
    // file proves that route.
    const inactivateResponse = await request.put(`${apiBaseURL}/api/users/${userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { status: 'inactive' },
    });
    expect(inactivateResponse.ok(), await inactivateResponse.text()).toBeTruthy();
    await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);

    // The record — and its history — still exists, just marked inactive.
    const fetchResponse = await request.get(`${apiBaseURL}/api/users/${userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(fetchResponse.ok(), await fetchResponse.text()).toBeTruthy();
    const fetchedUser = (await fetchResponse.json()).data;
    expect(fetchedUser.status).toBe('Inativo');
    expect(fetchedUser.username).toBe(username);

    // An inactivated account can no longer complete a fresh login.
    const loginResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password: 'Tecnico@123456-forte' },
    });
    expect(loginResponse.ok()).toBeFalsy();
  });

  test('sessions can be revoked and an admin can perform a controlled MFA reset (criterion 5)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const username = `tecnico.rf003ac5.${Date.now()}`;
    const password = 'Tecnico@123456-forte';
    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF003 AC5 Técnico Fixture',
        email: `${username}@example.com`,
        username,
        password,
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();
    const userID = (await registerResponse.json()).data?._id || (await registerResponse.json()).data?.id;

    // Same first-login MFA setup completeFirstLoginMfa performs, done inline
    // here (rather than via the helper) so the TOTP secret is kept — it's
    // needed below for a second, *normal* MFA login, since a second
    // first-login setup attempt is refused once MFA is already configured.
    const qrResponse = await request.post(`${apiBaseURL}/api/auth/two-factor/qr-first-login`, {
      data: { username, password },
    });
    expect(qrResponse.ok(), await qrResponse.text()).toBeTruthy();
    const totpSecret = (await qrResponse.json()).data?.secret;
    expect(totpSecret).toBeTruthy();

    const enableResponse = await request.post(`${apiBaseURL}/api/auth/two-factor/enable-first-login`, {
      data: { username, password, code: computeTotp(totpSecret) },
    });
    expect(enableResponse.ok(), await enableResponse.text()).toBeTruthy();
    const enableBody = (await enableResponse.json()).data;
    const tecnicoSession = { token: enableBody.token, user: enableBody.user };

    // Revoke case: the Técnico's own active session is fetched by id, then
    // revoked — the same token is then genuinely rejected (401), because
    // `authenticate` re-checks the session document itself (sessionService
    // .verifySession), not just the JWT signature.
    const sessionsResponse = await request.get(`${apiBaseURL}/api/user/security/sessions`, {
      headers: { Authorization: `Bearer ${tecnicoSession.token}` },
    });
    expect(sessionsResponse.ok(), await sessionsResponse.text()).toBeTruthy();
    const sessions = (await sessionsResponse.json()).data;
    const currentSession = sessions.find((s: { isCurrent: boolean }) => s.isCurrent) || sessions[0];
    expect(currentSession).toBeTruthy();

    const revokeResponse = await request.delete(
      `${apiBaseURL}/api/user/security/sessions/${currentSession.id}`,
      { headers: { Authorization: `Bearer ${tecnicoSession.token}` } }
    );
    expect(revokeResponse.ok(), await revokeResponse.text()).toBeTruthy();

    const afterRevoke = await request.get(`${apiBaseURL}/api/user/security/status`, {
      headers: { Authorization: `Bearer ${tecnicoSession.token}` },
    });
    expect(afterRevoke.status()).toBe(401);

    // Controlled MFA reset: a non-admin (a fresh, normal MFA login for the
    // same Técnico — MFA is already configured, so this is a plain login
    // with a TOTP code, not another first-login setup) cannot reset anyone's
    // MFA — the reset-mfa endpoint's own admin check refuses it,
    // independent of the frontend.
    //
    // The JWT payload has only second-granularity iat/exp and no jti, so a
    // second login within the same wall-clock second as the first returns a
    // byte-identical token — session storage keys purely on the token hash,
    // so that second login would collide with the just-revoked session doc
    // above and come back pre-revoked (filed as #338). Waiting out the
    // second avoids the collision so this test proves the intended revoke
    // scope (one session revoked, not sibling logins), not #338's bug.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const secondLoginResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password, twoFactorCode: computeTotp(totpSecret) },
    });
    expect(secondLoginResponse.ok(), await secondLoginResponse.text()).toBeTruthy();
    const secondToken = (await secondLoginResponse.json()).data?.token;
    expect(secondToken).toBeTruthy();
    const forbiddenReset = await request.post(`${apiBaseURL}/api/users/${userID}/reset-mfa`, {
      headers: { Authorization: `Bearer ${secondToken}` },
    });
    expect(forbiddenReset.status()).toBe(403);

    // #1005: the audit session view is admin-or-auditor only; a Técnico is refused.
    const forbiddenSessions = await request.get(`${apiBaseURL}/api/logs/sessions?userId=${userID}`, {
      headers: { Authorization: `Bearer ${secondToken}` },
    });
    expect(forbiddenSessions.status()).toBe(403);

    // An admin's reset succeeds and actually clears the target's MFA state,
    // forcing fresh setup on the next login.
    const resetResponse = await request.post(`${apiBaseURL}/api/users/${userID}/reset-mfa`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(resetResponse.ok(), await resetResponse.text()).toBeTruthy();

    const fetchResponse = await request.get(`${apiBaseURL}/api/users/${userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const fetchedUser = (await fetchResponse.json()).data;
    expect(fetchedUser.mfaEnabled).toBe(false);
    expect(fetchedUser.lastLogin).toBeFalsy();

    // #1005: both revocations above are readable back, with their reasons,
    // through the audit session view. Before it nothing could list a revoked
    // session or another user's sessions at all.
    const auditResponse = await request.get(`${apiBaseURL}/api/logs/sessions?userId=${userID}&isRevoked=true`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(auditResponse.ok(), await auditResponse.text()).toBeTruthy();
    const audit = (await auditResponse.json()).data;
    const reasons = audit.sessions.map((s: { revocationReason: string }) => s.revocationReason).sort();
    expect(reasons).toEqual(['admin_action', 'user_request']);
    expect(audit.total).toBe(2);

    const adminRevoked = audit.sessions.find((s: { revocationReason: string }) => s.revocationReason === 'admin_action');
    const selfRevoked = audit.sessions.find((s: { revocationReason: string }) => s.revocationReason === 'user_request');
    // LGPD shaping (dict-02 P1X-0256, RNF009 AC#2): pseudonyms, never raw ids;
    // a masked IP; no token material.
    expect(adminRevoked.user).toMatch(/^USR-[0-9A-F]{8}$/);
    expect(selfRevoked.user).toBe(adminRevoked.user);
    expect(adminRevoked.revokedBy).toMatch(/^USR-[0-9A-F]{8}$/);
    expect(adminRevoked.revokedBy).not.toBe(adminRevoked.user);
    expect(selfRevoked.revokedBy).toBe(selfRevoked.user);
    const raw = JSON.stringify(audit);
    expect(raw).not.toContain(String(userID));
    expect(raw).not.toContain('tokenHash');
    expect(raw).not.toContain('TokenHash');
    for (const s of audit.sessions) {
      if (s.ipAddress !== null) expect(s.ipAddress).toMatch(/(\.x|::x|^x)$/);
      expect(s.isRevoked).toBe(true);
      expect(s.revokedAt).toBeTruthy();
    }

    const reasonFiltered = await request.get(
      `${apiBaseURL}/api/logs/sessions?userId=${userID}&revocationReason=admin_action`,
      { headers: { Authorization: `Bearer ${admin.token}` } }
    );
    expect(reasonFiltered.ok()).toBeTruthy();
    expect((await reasonFiltered.json()).data.sessions.map((s: { id: string }) => s.id)).toEqual([
      adminRevoked.id,
    ]);

    const badReason = await request.get(`${apiBaseURL}/api/logs/sessions?revocationReason=hacked`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(badReason.status()).toBe(422);

    // #1020 / RF003 AC#5: an administrator revokes the account's sessions as
    // their own act, recording 'risk' -- the P1X-0267 member that had no
    // writer -- and the revocation lands in the audit trail with its reason.
    const riskSession = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
    const nonAdminRevoke = await request.post(`${apiBaseURL}/api/users/${userID}/revoke-sessions`, {
      headers: { Authorization: `Bearer ${riskSession.token}` },
      data: { reason: 'risk' },
    });
    expect(nonAdminRevoke.status()).toBe(403);
    const riskRevoke = await request.post(`${apiBaseURL}/api/users/${userID}/revoke-sessions`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { reason: 'risk' },
    });
    expect(riskRevoke.ok(), await riskRevoke.text()).toBeTruthy();
    expect((await riskRevoke.json()).data).toEqual({ revoked: 1, reason: 'risk' });
    const afterRisk = await request.get(`${apiBaseURL}/api/user/security/status`, {
      headers: { Authorization: `Bearer ${riskSession.token}` },
    });
    expect(afterRisk.status()).toBe(401);

    const riskRows = await request.get(`${apiBaseURL}/api/logs/sessions?userId=${userID}&revocationReason=risk`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    const riskData = (await riskRows.json()).data;
    expect(riskData.total).toBe(1);
    expect(riskData.sessions[0].revokedBy).toBe(adminRevoked.revokedBy);

    const sessionAudit = await request.get(`${apiBaseURL}/api/logs?resourceType=Session&limit=200`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(sessionAudit.ok()).toBeTruthy();
    const auditBody = (await sessionAudit.json()).data;
    const auditRows: Array<{ message: string; resourceId: string }> = auditBody.logs || auditBody;
    const riskAudit = auditRows.find(
      (row) => row.resourceId === adminRevoked.user && String(row.message).includes('motivo risk')
    );
    expect(riskAudit, 'no Session audit row carrying motivo risk for this account').toBeTruthy();
    expect(riskAudit!.message).toContain('sessões afetadas 1');

    // The lookup indexes are built on the live collection, the per-request
    // token-hash lookup's included, each keyed by its canonical name
    // (ensured un-awaited, so polled).
    await expect
      .poll(async () => listSessionIndexNames(), { timeout: 10_000 })
      .toEqual(expect.arrayContaining([
        'sessions_accessTokenHash_v1',
        'sessions_revocationReason_sessionStartedAt_v1',
      ]));
    await closeSessionsDb();
  });
});

// Wave 3 kickoff (#646). requisitos-index.md RF014's 8 acceptance criteria
// map onto security.service.js's existing security_config singleton
// (security.routes.js's GET/PUT /api/security/config) -- product-side
// foundation already existed (confirmed by reading the service, not
// assumed from the issue's own "likely" framing), this file just never
// proved it against the real backend. That list, superseded by v2.0.0,
// also asked to force a user's password reset (#648, built later in this
// file) and to revoke sessions when a policy change requires it (#649,
// pinned in security.service.unit.test.js), which v2.0.0 moves out of
// RF014.
test.describe('Security policy management (RF014) — real backend', () => {
  // security_config is a single global singleton document ('main') shared
  // by the whole stack, not a per-test fixture -- capture and restore it so
  // this test doesn't leave the live policy mutated for every other spec/
  // session sharing the same compose.test.yml stack.
  test('admin updates session/login/password/MFA policy — versioned, validated, and audited as critical (criteria 1,2,3,5,6,7)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const before = await request.get(`${apiBaseURL}/api/security/config`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(before.ok()).toBeTruthy();
    const originalConfig = (await before.json()).data;
    const originalVersion = originalConfig.configVersion;

    try {
      const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);

      // Criteria 1 (session timeout/max duration), 2 (login attempts/
      // password rules), 3 (MFA mandatory) — all in one policy update, same
      // shape a real admin submitting the SecurityPage form would send.
      const update = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: {
          session: { timeoutMinutes: 45, maxSessionDurationHours: 8 },
          authentication: { maxLoginAttempts: 4, requireMFA: !originalConfig.authentication.requireMFA },
          passwordRules: { minLength: 12 },
        },
      });
      expect(update.ok(), await update.text()).toBeTruthy();
      const updated = (await update.json()).data;

      expect(updated.session.timeoutMinutes).toBe(45);
      expect(updated.session.maxSessionDurationHours).toBe(8);
      expect(updated.authentication.maxLoginAttempts).toBe(4);
      expect(updated.authentication.requireMFA).toBe(!originalConfig.authentication.requireMFA);
      expect(updated.passwordRules.minLength).toBe(12);

      // Criterion 5 — every update is a new version, not an overwrite.
      expect(updated.configVersion).toBe(originalVersion + 1);
      expect(updated.lastUpdatedBy).toBeTruthy();

      // RF014 AC2 — the update is a new, active ConfigurationRelease, and the
      // release it replaced is kept, superseded, with its settings intact.
      const history = await request.get(`${apiBaseURL}/api/security/config/releases`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(history.ok(), await history.text()).toBeTruthy();
      const releases = (await history.json()).data;
      expect(releases[0].configurationReleaseId).toBe(updated.configurationReleaseId);
      expect(releases[0].status).toBe('active');
      expect(releases[0].settings.session.timeoutMinutes).toBe(45);
      const previous = releases[1];
      expect(previous.status).toBe('superseded');
      expect(previous.configurationReleaseId).toBe(releases[0].supersedesId);
      expect(previous.settings.session.timeoutMinutes).toBe(originalConfig.session.timeoutMinutes);

      // RF014 AC4 — a governed rollback restores the previous settings as a
      // new release naming the one it restores; the active one is refused.
      const refused = await request.post(`${apiBaseURL}/api/security/config/rollback`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { configurationReleaseId: updated.configurationReleaseId },
      });
      expect(refused.status()).toBe(409);
      const rollback = await request.post(`${apiBaseURL}/api/security/config/rollback`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { configurationReleaseId: previous.configurationReleaseId },
      });
      expect(rollback.ok(), await rollback.text()).toBeTruthy();
      const restored = (await rollback.json()).data;
      expect(restored.session.timeoutMinutes).toBe(originalConfig.session.timeoutMinutes);
      expect(restored.authentication.requireMFA).toBe(originalConfig.authentication.requireMFA);
      const afterRollback = (await (await request.get(`${apiBaseURL}/api/security/config/releases`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      })).json()).data;
      expect(afterRollback[0].configurationReleaseId).toBe(restored.configurationReleaseId);
      expect(afterRollback[0].rollbackTargetId).toBe(previous.configurationReleaseId);

      // RF014 AC3/AC6/AC7, CFG-008 — a change that would switch the audit
      // trail off breaks a governance invariant: it is refused with 422
      // naming it, kept as a draft release that was never activated, and
      // the configuration in force does not move.
      const override = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { logging: { logAllActions: false } },
      });
      expect(override.status(), await override.text()).toBe(422);
      const overrideBody = await override.json();
      expect(overrideBody.violatedInvariants).toEqual(['INV-AUDIT-001']);
      expect(overrideBody.configurationValidationRunId).toBeTruthy();
      // A failed gate that breaks no invariant is a plain 400.
      const outOfRange = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { session: { timeoutMinutes: 1 } },
      });
      expect(outOfRange.status(), await outOfRange.text()).toBe(400);
      expect((await outOfRange.json()).violatedInvariants).toEqual([]);
      const afterRefusals = (await (await request.get(`${apiBaseURL}/api/security/config/releases`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      })).json()).data;
      // Newest first: the two refused candidates, as drafts.
      const [secondRefusal, firstRefusal] = afterRefusals;
      expect([firstRefusal.status, secondRefusal.status]).toEqual(['draft', 'draft']);
      expect(firstRefusal.settings.logging.logAllActions).toBe(false);
      // RF019 AC1/AC4 (#1315): the broken invariant is an InvariantViolation
      // keyed by the refused candidate; the 400 recorded none.
      expect(await invariantViolationsFor(firstRefusal.configurationReleaseId)).toEqual([
        expect.objectContaining({ invariantId: 'INV-AUDIT-001', outcome: 'block', sourceComponent: 'configurationValidation' }),
      ]);
      expect(await invariantViolationsFor(secondRefusal.configurationReleaseId)).toEqual([]);
      expect(secondRefusal.settings.session.timeoutMinutes).toBe(1);
      // RF014 AC7, CFG-008 (#1487): each lifecycle step is a ConfigurationChangeEvent
      // keyed by its release: proposal, approval and activation for a change,
      // rollback naming the activation it undoes, and a violation attempt for
      // the refusal that broke an invariant (none for the plain 400).
      const changeTypes = (events: Record<string, any>[]) => events.map((event) => event.changeType);
      const updateEvents = await configurationChangeEventsFor(updated.configurationReleaseId);
      expect(changeTypes(updateEvents)).toEqual(['proposed', 'approved', 'activated']);
      const rollbackEvents = await configurationChangeEventsFor(restored.configurationReleaseId);
      expect(changeTypes(rollbackEvents)).toEqual(['proposed', 'approved', 'rolled_back']);
      expect(rollbackEvents[2].rollbackOf).toBe(updateEvents[2].configurationChangeEventId);
      const overrideEvents = await configurationChangeEventsFor(firstRefusal.configurationReleaseId);
      expect(changeTypes(overrideEvents)).toEqual(['proposed', 'violation_attempted']);
      expect(overrideEvents[1].impactSummary).toContain('INV-AUDIT-001');
      expect(changeTypes(await configurationChangeEventsFor(secondRefusal.configurationReleaseId))).toEqual(['proposed']);
      for (const event of [...updateEvents, ...rollbackEvents, ...overrideEvents]) {
        expect(event.actorId, event.changeType).toBe(updated.lastUpdatedBy);
        expect(event.occurredAt, event.changeType).toBeInstanceOf(Date);
      }
      expect(afterRefusals.filter((release: { status: string }) => release.status === 'active')
        .map((release: { configurationReleaseId: string }) => release.configurationReleaseId)).toEqual([restored.configurationReleaseId]);
      const inForce = (await (await request.get(`${apiBaseURL}/api/security/config`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      })).json()).data;
      expect(inForce.configurationReleaseId).toBe(restored.configurationReleaseId);
      expect(inForce.logging.logAllActions).toBe(true);

      // RF014 AC3/AC6, RNF018 AC2/AC3, RNF028 AC5 — the structural,
      // dependency and security gates each refuse a candidate before
      // activation, and a key outside the policy (an unknown one, or an
      // attempt to switch off the outbox, provenance, store authority or RCS)
      // is a 422 naming INV-SCOPE-001 and each fieldPath. Identity, consent
      // and audit are proven at the #1260 #1261 test.
      const gateCases: {
        data: Record<string, unknown>;
        status: number;
        violatedInvariants: string[];
        fieldPaths: string[];
        gates: [string, string, string, string];
      }[] = [
        { data: { session: { timeoutMinutes: 'thirty' } }, status: 400, violatedInvariants: [], fieldPaths: [], gates: ['fail', 'pass', 'pass', 'pass'] },
        { data: { passwordRules: { minLength: 10, minLengthWithMFA: 12 } }, status: 400, violatedInvariants: [], fieldPaths: [], gates: ['pass', 'pass', 'fail', 'pass'] },
        { data: { passwordRules: { minLength: 7 } }, status: 400, violatedInvariants: [], fieldPaths: [], gates: ['pass', 'pass', 'pass', 'fail'] },
        { data: { authentication: { mfaMethod: 'sms' } }, status: 400, violatedInvariants: [], fieldPaths: [], gates: ['pass', 'pass', 'pass', 'fail'] },
        { data: { session: { timeout: 20 } }, status: 422, violatedInvariants: ['INV-SCOPE-001'], fieldPaths: ['session.timeout'], gates: ['fail', 'pass', 'pass', 'pass'] },
        {
          data: { outbox: { enabled: false }, provenance: { enabled: false }, storeAuthority: { mongo: false }, rcs: { admissibility: false } },
          status: 422,
          violatedInvariants: ['INV-SCOPE-001'],
          fieldPaths: ['outbox', 'provenance', 'storeAuthority', 'rcs'],
          gates: ['fail', 'pass', 'pass', 'pass'],
        },
      ];
      const gateRuns: Record<string, any>[] = [];
      for (const gateCase of gateCases) {
        const label = JSON.stringify(gateCase.data);
        const response = await request.put(`${apiBaseURL}/api/security/config`, {
          headers: { Authorization: `Bearer ${admin.token}` },
          data: gateCase.data,
        });
        expect(response.status(), `${label}: ${await response.text()}`).toBe(gateCase.status);
        const body = await response.json();
        expect(body.violatedInvariants, label).toEqual(gateCase.violatedInvariants);
        expect(body.violations, label).toEqual(gateCase.fieldPaths.map((fieldPath) => ({ invariantId: 'INV-SCOPE-001', fieldPath })));
        const run = await configurationValidationRunById(body.configurationValidationRunId);
        expect(run, label).toBeTruthy();
        expect([run!.structuralResult, run!.semanticResult, run!.dependencyResult, run!.securityResult], label).toEqual(gateCase.gates);
        expect(run!.status, label).toBe('failed');
        if (gateCase.status === 422) {
          expect(await invariantViolationsFor(run!.releaseId), label).toEqual([
            expect.objectContaining({ invariantId: 'INV-SCOPE-001', outcome: 'block' }),
          ]);
        }
        gateRuns.push(run!);
      }
      // RNF018 AC3: none of the refusals moved the active release; each
      // refused candidate is a draft.
      const inForceAfterGates = (await (await request.get(`${apiBaseURL}/api/security/config`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      })).json()).data;
      expect(inForceAfterGates.configurationReleaseId).toBe(restored.configurationReleaseId);
      const afterGates = (await (await request.get(`${apiBaseURL}/api/security/config/releases?limit=200`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      })).json()).data as { configurationReleaseId: string; status: string }[];
      expect(afterGates.filter((release) => release.status === 'active').map((release) => release.configurationReleaseId))
        .toEqual([restored.configurationReleaseId]);
      for (const run of gateRuns) {
        expect(afterGates.find((release) => release.configurationReleaseId === run.releaseId)?.status, run.releaseId).toBe('draft');
      }

      // Criterion 7 — the change is registered as a critical AuditEvent.
      // requireMFA is one of security.service.js's own criticalPaths, so
      // this isn't just "some audit event fired" (assertAuditEventRecorded
      // below already proves that generically) but specifically a
      // severity=critical SecurityConfiguration entry.
      //
      // #1121: this queried resourceType=SecurityConfig until 4a51a916
      // (#1116) renamed the last writer to the canonical dict-02 spelling.
      // log.service.js:202-214 matches resourceType/entity EXACTLY, and
      // auditLogger writes both columns from the same value, so the old
      // spelling matched zero rows and this assertion could only fail.
      // ENTITY_MAP maps /api/security to SecurityConfiguration too (#1115,
      // reached at runtime as of #1119), so both the explicit row and the
      // automatic one now answer to this name.
      await assertAuditEventRecorded(request, apiBaseURL!, admin.token, watch);
      const criticalLogs = await request.get(
        `${apiBaseURL}/api/logs?resourceType=SecurityConfiguration&severity=critical&limit=20`,
        { headers: { Authorization: `Bearer ${admin.token}` } }
      );
      expect(criticalLogs.ok()).toBeTruthy();
      const criticalLogsBody = await criticalLogs.json();
      const requireMfaEntry = (criticalLogsBody.data.logs || criticalLogsBody.data).find(
        (entry: any) => String(entry.message || '').includes('authentication.requireMFA')
      );
      expect(requireMfaEntry).toBeTruthy();

      // Criterion 6 — minimum security limits are validated, not accepted
      // as-is. maxLoginAttempts is documented (security.service.js#validateConfig)
      // to accept only 1-10.
      const invalid = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: { authentication: { maxLoginAttempts: 15 } },
      });
      expect(invalid.status()).toBe(400);
    } finally {
      // Restore the pre-test policy so this run doesn't leave a stricter
      // (or looser) session/MFA/password policy live for every other spec
      // sharing this stack.
      await request.put(`${apiBaseURL}/api/security/config`, {
        headers: { Authorization: `Bearer ${admin.token}` },
        data: {
          session: { timeoutMinutes: originalConfig.session.timeoutMinutes, maxSessionDurationHours: originalConfig.session.maxSessionDurationHours },
          authentication: { maxLoginAttempts: originalConfig.authentication.maxLoginAttempts, requireMFA: originalConfig.authentication.requireMFA },
          passwordRules: { minLength: originalConfig.passwordRules.minLength },
        },
      }).catch(() => {});
      await closeFoundationDb();
    }
  });

  // #914: the test above proves the policy is STORED. This one proves two of
  // its keys are ENFORCED on a live login, which is what RF014 AC#1/AC#3 and
  // RNF021 AC#3 ask for:
  //   - authentication.requireMFA decides whether a non-admin's first login
  //     must enrol MFA (control: a second fixture under requireMFA=true);
  //   - session.maxSessionDurationHours caps the session absolutely: the new
  //     session's refreshExpiresAt is sessionStartedAt + the cap, and a real
  //     token refresh does not slide it forward.
  // Same capture-and-restore as above: the policy is one global singleton.
  test('#914: requireMFA and maxSessionDurationHours are enforced on a live login, not just stored (criteria 1, 3)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };

    const before = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(before.ok()).toBeTruthy();
    const originalConfig = (await before.json()).data;

    async function registerTecnico(label: string) {
      const username = `tecnico.914.${label}.${Date.now()}`;
      const password = 'Tecnico@123456-forte';
      const response = await request.post(`${apiBaseURL}/api/users/register`, {
        headers: auth,
        data: { name: `#914 ${label} Fixture`, email: `${username}@example.com`, username, password, accessType: 2, roleName: 'Técnico' },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return { username, password };
    }

    try {
      const relax = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { authentication: { requireMFA: false }, session: { maxSessionDurationHours: 2 } },
      });
      expect(relax.ok(), await relax.text()).toBeTruthy();

      // requireMFA=false: a Técnico's FIRST login gets a session, no enrolment step.
      const relaxed = await registerTecnico('relaxed');
      const relaxedLogin = await request.post(`${apiBaseURL}/api/auth/login`, {
        data: { username: relaxed.username, password: relaxed.password },
      });
      expect(relaxedLogin.ok(), await relaxedLogin.text()).toBeTruthy();
      const relaxedBody = await relaxedLogin.json();
      expect(relaxedBody.requiresMFASetup).toBeFalsy();
      expect(relaxedBody.data?.token).toBeTruthy();

      // maxSessionDurationHours=2: the cap is on the session document itself.
      const userID = relaxedBody.data.user._id || relaxedBody.data.user.id;
      const session = await findLatestSession(userID);
      expect(session).toBeTruthy();
      const capMs = 2 * 60 * 60 * 1000;
      expect(new Date(session!.refreshExpiresAt).getTime() - new Date(session!.sessionStartedAt).getTime()).toBe(capMs);

      // A real refresh rotates the tokens but keeps the ceiling. Before #914 it
      // reset refreshExpiresAt to now + 7 days on every call.
      const setCookie = relaxedLogin.headers()['set-cookie'] || '';
      const refreshCookie = /refresh_token=[^;]+/.exec(setCookie)?.[0];
      expect(refreshCookie, 'login must set the refresh cookie').toBeTruthy();
      const refreshed = await request.post(`${apiBaseURL}/api/auth/refresh`, { headers: { Cookie: refreshCookie! } });
      expect(refreshed.ok(), await refreshed.text()).toBeTruthy();
      const rotated = await findLatestSession(userID);
      expect(rotated!.sessionId).toBe(session!.sessionId);
      expect(rotated!.accessTokenHash).not.toBe(session!.accessTokenHash);
      expect(new Date(rotated!.refreshExpiresAt).getTime()).toBe(new Date(session!.refreshExpiresAt).getTime());

      // Control: requireMFA=true, and the same first login is sent to enrolment.
      const strict = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { authentication: { requireMFA: true } },
      });
      expect(strict.ok(), await strict.text()).toBeTruthy();
      const strictUser = await registerTecnico('strict');
      const strictLogin = await request.post(`${apiBaseURL}/api/auth/login`, {
        data: { username: strictUser.username, password: strictUser.password },
      });
      const strictBody = await strictLogin.json();
      expect(strictBody.requiresMFASetup).toBe(true);
      expect(strictBody.data?.token).toBeFalsy();
    } finally {
      await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: {
          authentication: { requireMFA: originalConfig.authentication.requireMFA },
          session: { maxSessionDurationHours: originalConfig.session.maxSessionDurationHours },
        },
      }).catch(() => {});
      await closeSessionsDb();
    }
  });

  // #1244: the reuse window is passwordRules.maxReuseHistory, and preventReuse
  // can switch the check off. Before this the depth was a hard-coded 3 at four
  // sites (5 at a fifth) and both keys were stored and never read. Driven
  // through the administrator's set-password route, which needs no MFA
  // onboarding for the target.
  test('#1244: password reuse follows passwordRules.preventReuse and maxReuseHistory on a live set (criterion 2)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };

    const before = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(before.ok()).toBeTruthy();
    const originalRules = (await before.json()).data.passwordRules;

    const username = `tecnico.1244.${Date.now()}`;
    const passwords = ['Reuse@1244zero-forte', 'Reuse@1244one-forte', 'Reuse@1244two-forte'];
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: auth,
      data: { name: '#1244 reuse Fixture', email: `${username}@example.com`, username, password: passwords[0], accessType: 2, roleName: 'Técnico' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const registered = await register.json();
    const userID = registered.data?._id || registered.data?.id || registered.data?.user?._id || registered.data?.userID;
    expect(userID, JSON.stringify(registered)).toBeTruthy();
    const setPassword = (password: string) =>
      request.post(`${apiBaseURL}/api/users/${userID}/set-password`, { headers: auth, data: { password } });

    try {
      const depthOne = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { passwordRules: { preventReuse: true, maxReuseHistory: 1 } },
      });
      expect(depthOne.ok(), await depthOne.text()).toBeTruthy();

      expect((await setPassword(passwords[1])).status()).toBe(200);
      expect((await setPassword(passwords[2])).status()).toBe(200);
      // History is now [passwords[1]] at depth 1: the one just replaced is refused...
      const refused = await setPassword(passwords[1]);
      expect(refused.status()).toBe(422);
      expect((await refused.json()).message).toContain('Senha já utilizada recentemente');
      // ...and the one past the window is allowed. Under the old fixed depth of 3 it was refused.
      expect((await setPassword(passwords[0])).status()).toBe(200);

      // Control: the config refuses a depth outside the page's 1..20.
      const outOfRange = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { passwordRules: { maxReuseHistory: 21 } },
      });
      expect(outOfRange.status()).toBeGreaterThanOrEqual(400);

      // preventReuse=false: the history is no longer checked, so passwords[2],
      // the one just replaced, may be set again. #1253: the current password
      // is still refused, since "changing" to it is not a change.
      const off = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { passwordRules: { preventReuse: false } },
      });
      expect(off.ok(), await off.text()).toBeTruthy();
      expect((await setPassword(passwords[0])).status()).toBe(422);
      expect((await setPassword(passwords[2])).status()).toBe(200);
    } finally {
      await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { passwordRules: { preventReuse: originalRules.preventReuse, maxReuseHistory: originalRules.maxReuseHistory } },
      }).catch(() => {});
    }
  });

  // #1246: the strength keys were stored and never read, and two backend
  // validators disagreed (8 with a digit, 12 without). One policy now drives
  // every write, and the public password-policy route tells the forms.
  test('#1246: password strength follows passwordRules on a live set, and the public policy route reports it (criterion 2)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const before = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(before.ok()).toBeTruthy();
    const originalRules = (await before.json()).data.passwordRules;

    const username = `tecnico.1246.${Date.now()}`;
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: auth,
      data: { name: '#1246 strength Fixture', email: `${username}@example.com`, username, password: 'Strength@1246a-forte', accessType: 2, roleName: 'Técnico' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const userID = (await register.json()).data?._id;
    expect(userID).toBeTruthy();

    try {
      const strict = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { passwordRules: { minLength: 14, requireNumbers: false } },
      });
      expect(strict.ok(), await strict.text()).toBeTruthy();

      // No session: the reset page reads this before anyone logs in.
      const policy = await request.get(`${apiBaseURL}/api/auth/password-policy`);
      expect(policy.ok(), await policy.text()).toBeTruthy();
      const rules = (await policy.json()).data;
      expect(rules).toMatchObject({ minLength: 14, requireNumbers: false });
      expect(rules).not.toHaveProperty('maxReuseHistory');

      const tooShort = await request.post(`${apiBaseURL}/api/users/${userID}/set-password`, { headers: auth, data: { password: 'Strength@abc' } });
      expect(tooShort.status()).toBe(422);
      expect((await tooShort.json()).message).toContain('pelo menos 14 caracteres');
      // 14 characters and no digit: allowed, since the policy turned digits off.
      const ok = await request.post(`${apiBaseURL}/api/users/${userID}/set-password`, { headers: auth, data: { password: 'Strength@abcde' } });
      expect(ok.status(), await ok.text()).toBe(200);
    } finally {
      await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { passwordRules: { minLength: originalRules.minLength, requireNumbers: originalRules.requireNumbers } },
      }).catch(() => {});
    }
  });

  // #1251: passwordRules.expirationDays was stored and enforced nowhere; an
  // expired password now takes the forced-change branch at login. An
  // Administrador target, as in the criterion-4 test, has no MFA onboarding.
  test('#1251: an expired password forces a change at login, and expirationDays 0 turns expiry off (criterion 2)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const before = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(before.ok()).toBeTruthy();
    const originalDays = (await before.json()).data.passwordRules.expirationDays;

    const username = `expiry1251.${Date.now()}`;
    const password = 'Expiry@1251pass';
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: auth,
      data: { name: '#1251 expiry Fixture', email: `${username}@example.com`, username, password, accessType: 4, roleName: 'Administrador' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const userID = (await register.json()).data?._id;
    expect(userID).toBeTruthy();

    try {
      await setPasswordChangedAt(userID, new Date(Date.now() - 100 * 24 * 60 * 60 * 1000));

      // Control: expiry off, and the 100-day-old password logs straight in.
      const off = await request.put(`${apiBaseURL}/api/security/config`, { headers: auth, data: { passwordRules: { expirationDays: 0 } } });
      expect(off.ok(), await off.text()).toBeTruthy();
      const offLogin = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password } });
      expect(offLogin.ok(), await offLogin.text()).toBeTruthy();
      expect((await offLogin.json()).data?.token).toBeTruthy();

      const on = await request.put(`${apiBaseURL}/api/security/config`, { headers: auth, data: { passwordRules: { expirationDays: 90 } } });
      expect(on.ok(), await on.text()).toBeTruthy();
      const expired = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password } });
      expect(expired.ok(), await expired.text()).toBeTruthy();
      const expiredBody = await expired.json();
      expect(expiredBody.requiresPasswordChange).toBe(true);
      expect(expiredBody.reason).toBe('expired');
      expect(expiredBody.data?.token).toBeFalsy();

      const changed = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password, newPassword: 'Renewed@1251pass' } });
      expect(changed.ok(), await changed.text()).toBeTruthy();
      expect((await changed.json()).data?.token).toBeTruthy();
      // The change reset the clock: the new password logs straight in.
      const again = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password: 'Renewed@1251pass' } });
      expect((await again.json()).data?.token).toBeTruthy();
    } finally {
      await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { passwordRules: { expirationDays: originalDays } },
      }).catch(() => {});
      await closeSessionsDb();
    }
  });

  // #1252: the login page dropped the accepted TOTP when the password change
  // was asked for, so the change submit came back requiresMFA and an enrolled
  // user typed a second code. A Técnico is MFA-enrolled by its first login.
  test('#1252: an MFA-enrolled user with an expired password enters one code, sets the new password and lands past the login page', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const before = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(before.ok()).toBeTruthy();
    const originalDays = (await before.json()).data.passwordRules.expirationDays;

    const username = `tecnico.1252.${Date.now()}`;
    const password = 'Expiry@1252pass';
    const newPassword = 'Renewed@1252pass';
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: auth,
      data: { name: '#1252 enrolled Fixture', email: `${username}@example.com`, username, password, accessType: 2, roleName: 'Técnico' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const userID = (await register.json()).data?._id;
    expect(userID).toBeTruthy();

    const qr = await request.post(`${apiBaseURL}/api/auth/two-factor/qr-first-login`, { data: { username, password } });
    expect(qr.ok(), await qr.text()).toBeTruthy();
    const secret = (await qr.json()).data?.secret;
    expect(secret).toBeTruthy();
    const enable = await request.post(`${apiBaseURL}/api/auth/two-factor/enable-first-login`, {
      data: { username, password, code: computeTotp(secret) },
    });
    expect(enable.ok(), await enable.text()).toBeTruthy();

    try {
      await setPasswordChangedAt(userID, new Date(Date.now() - 100 * 24 * 60 * 60 * 1000));
      const on = await request.put(`${apiBaseURL}/api/security/config`, { headers: auth, data: { passwordRules: { expirationDays: 90 } } });
      expect(on.ok(), await on.text()).toBeTruthy();

      const loginBodies: Array<Record<string, unknown>> = [];
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().endsWith('/api/auth/login')) loginBodies.push(req.postDataJSON());
      });

      await page.goto('/login');
      await page.getByTestId('login-username-input').fill(username);
      await page.getByTestId('login-password-input').fill(password);
      await page.getByTestId('login-submit-button').click();

      await expect(page.getByTestId('two-factor-section')).toBeVisible();
      await page.getByTestId('login-mfa-code-input').fill(computeTotp(secret));
      await page.getByTestId('login-submit-button').click();

      await expect(page.getByTestId('force-password-change-section')).toBeVisible();
      // #1291: an expiry says so, not that an administrator asked for it.
      await expect(page.getByTestId('force-password-change-reason')).toHaveText(/expirou|expired|caducado/);
      await expect(page.getByTestId('two-factor-section')).toHaveCount(0);
      await page.getByTestId('login-new-password-input').fill(newPassword);
      await page.getByTestId('login-confirm-new-password-input').fill(newPassword);
      await page.getByTestId('login-submit-button').click();

      // One code: the change submit carried it, and no code field came back.
      await page.waitForURL((url) => !url.pathname.endsWith('/login'));
      expect(loginBodies).toHaveLength(3);
      expect(loginBodies[2].newPassword).toBe(newPassword);
      expect(loginBodies[2].twoFactorCode).toBe(loginBodies[1].twoFactorCode);

      const old = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password } });
      expect(old.status()).toBe(401);
    } finally {
      await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { passwordRules: { expirationDays: originalDays } },
      }).catch(() => {});
      await closeSessionsDb();
    }
  });

  // #1249: four security_config keys were stored and read by nothing.
  // allowPasswordReset gates the emailed-token flow, requireStrongPassword is
  // the master switch over the composition flags, autoRenewal decides whether
  // a session is renewed, and logExpiration audits the expiry that follows.
  test('#1249: allowPasswordReset, requireStrongPassword, autoRenewal and logExpiration act on a live system (criteria 1, 2)', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const before = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(before.ok()).toBeTruthy();
    const original = (await before.json()).data;

    const username = `admin.1249.${Date.now()}`;
    const password = 'Policy@1249pass';
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: auth,
      data: { name: '#1249 policy Fixture', email: `${username}@example.com`, username, password, accessType: 4, roleName: 'Administrador' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const userID = (await register.json()).data?._id;
    expect(userID).toBeTruthy();

    try {
      const off = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { authentication: { allowPasswordReset: false, requireStrongPassword: false }, session: { autoRenewal: false } },
      });
      expect(off.ok(), await off.text()).toBeTruthy();

      const policy = (await (await request.get(`${apiBaseURL}/api/auth/password-policy`)).json()).data;
      expect(policy).toMatchObject({ allowPasswordReset: false, requireUppercase: false, requireNumbers: false, requireSpecialChars: false });

      const resetRequest = await request.post(`${apiBaseURL}/api/auth/password-reset/request`, { data: { email: `${username}@example.com` } });
      expect(resetRequest.status()).toBe(403);
      expect((await resetRequest.json()).code).toBe('PASSWORD_RESET_DISABLED');

      await page.goto('/login');
      await expect(page.getByTestId('login-form')).toBeVisible();
      await expect(page.getByTestId('login-forgot-password-button')).toHaveCount(0);

      // requireStrongPassword off: a password with one character class is
      // accepted. #1294: it is long enough for the 15-character single-factor
      // floor (#1283), so only composition could refuse it.
      const weak = await request.post(`${apiBaseURL}/api/users/register`, {
        headers: auth,
        data: { name: '#1249 weak Fixture', email: `weak.${username}@example.com`, username: `weak.${username}`, password: 'onlylowercaseletters', accessType: 4, roleName: 'Administrador' },
      });
      expect(weak.ok(), await weak.text()).toBeTruthy();

      // autoRenewal off: the refresh is refused and the session ends as an expiry.
      const login = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password } });
      expect(login.ok(), await login.text()).toBeTruthy();
      const refreshCookie = /refresh_token=[^;]+/.exec(login.headers()['set-cookie'] || '')?.[0];
      expect(refreshCookie, 'login must set the refresh cookie').toBeTruthy();
      const refreshed = await request.post(`${apiBaseURL}/api/auth/refresh`, { headers: { Cookie: refreshCookie! } });
      expect(refreshed.status()).toBe(401);
      expect((await refreshed.json()).code).toBe('SESSION_RENEWAL_DISABLED');

      const expiredRows = await request.get(`${apiBaseURL}/api/logs/sessions?userId=${userID}&revocationReason=expiration`, { headers: auth });
      const expiredData = (await expiredRows.json()).data;
      expect(expiredData.total).toBe(1);

      // logExpiration is on by default: the expiry has its audit row.
      const sessionAudit = await request.get(`${apiBaseURL}/api/logs?resourceType=Session&limit=200`, { headers: auth });
      const auditBody = (await sessionAudit.json()).data;
      const auditRows: Array<{ message: string; resourceId: string }> = auditBody.logs || auditBody;
      const expiryAudit = auditRows.find(
        (row) => row.resourceId === expiredData.sessions[0].user && String(row.message).includes('motivo expiration')
      );
      expect(expiryAudit, 'no Session audit row carrying motivo expiration for this account').toBeTruthy();
    } finally {
      await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: {
          authentication: {
            allowPasswordReset: original.authentication.allowPasswordReset,
            requireStrongPassword: original.authentication.requireStrongPassword,
          },
          session: { autoRenewal: original.session.autoRenewal },
        },
      }).catch(() => {});
    }
  });

  // #1255: loginAttempts.trackIP and blockIPAfterAttempts were shown and read
  // by nothing. A failed login now counts against its source address in
  // login_ip_attempts, keyed by an HMAC of the address. The blocks
  // themselves are driven through the trusted hop in the #1263 tests below:
  // the runner's own address is shared by every spec, so blocking it here
  // would block every spec that runs after this one.
  test('#1255: a failed login is counted against its source, stored as a keyed hash with an expiry (criterion 2)', async ({
    request,
  }) => {
    try {
      const before = new Map((await listLoginAttemptRows()).map((row) => [row._id, row.failures]));
      const probeName = `ip-probe-${Date.now()}@example.com`;
      const failed = await request.post(`${apiBaseURL}/api/auth/login`, {
        data: { username: probeName, password: 'Not@TheRight1255' },
      });
      expect(failed.status()).toBe(401);

      const after = await listLoginAttemptRows();
      const counted = after.filter((row) => row.failures > (before.get(row._id) ?? 0));
      expect(counted, 'exactly one source row counted the failure').toHaveLength(1);
      const [row] = counted;

      expect(row._id).toMatch(/^[0-9a-f]{64}$/);
      for (const account of row.accounts) expect(account).toMatch(/^[0-9a-f]{64}$/);
      const stored = JSON.stringify(after);
      expect(stored, 'no IPv4 address is stored').not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
      expect(stored).not.toContain('ip-probe-');
      expect(row.blockedUntil ?? null).toBeNull();

      const msLeft = new Date(row.expiresAt).getTime() - Date.now();
      expect(msLeft).toBeGreaterThan(25 * 60 * 1000);
      expect(msLeft).toBeLessThanOrEqual(30 * 60 * 1000 + 5_000);
      const ttl = (await listLoginAttemptIndexes()).find((index) => index.name === 'login_ip_attempts_ttl');
      expect(ttl?.expireAfterSeconds).toBe(0);
    } finally {
      // The runner's row is shared by every spec; give the failure back.
      await clearLoginAttempts();
      await closeLoginAttemptsDb();
    }
  });

  // #1263: the blocks themselves, on the live stack. Every spec shares the
  // runner's source address, so these go through trusted-hop-test, the one
  // hop the test backend trusts (TRUST_PROXY: loopback), and name their own
  // TEST-NET-3 address (RFC 5737) in X-Forwarded-For. Each test also sends
  // the blocked address straight to the backend and expects it ignored: the
  // header is honoured from the hop only, never from a client.
  const trustedHopURL = process.env.E2E_TRUSTED_HOP_URL || 'http://localhost:3100';
  const genericLoginFailure = async (request: APIRequestContext, address: string) => {
    const res = await request.post(`${trustedHopURL}/api/auth/login`, {
      headers: { 'X-Forwarded-For': address },
      data: { username: `ip-generic-${Date.now()}@example.com`, password: 'Not@TheRight1263' },
    });
    expect(res.status()).toBe(401);
    return res.json();
  };

  test('#1263: a source past blockIPAfterAttempts is refused even with the right password, and another source is not', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const credentials = { username: process.env.TEST_USER || 'admin', password: process.env.TEST_PASS || 'Admin@123-e2e-stack' };
    const blocked = '203.0.113.10';
    const other = '203.0.113.11';
    try {
      const config = (await (await request.get(`${apiBaseURL}/api/security/config`, { headers: auth })).json()).data;
      expect(config.loginAttempts.trackIP, 'precondition: trackIP on').toBe(true);
      const blockAfter = Number(config.loginAttempts.blockIPAfterAttempts);
      expect(blockAfter, 'precondition: blockIPAfterAttempts is positive').toBeGreaterThan(0);
      await clearLoginAttempts();

      // One unknown name throughout, so #1256's distinct-account detector
      // never fires and the block can only be the attempt count's.
      const name = `ip-block-${Date.now()}@example.com`;
      for (let attempt = 1; attempt <= blockAfter; attempt += 1) {
        const res = await request.post(`${trustedHopURL}/api/auth/login`, {
          headers: { 'X-Forwarded-For': blocked },
          data: { username: name, password: 'Not@TheRight1263' },
        });
        expect(res.status(), `failure ${attempt} of ${blockAfter}`).toBe(401);
      }
      const rows = await listLoginAttemptRows();
      const blockedRows = rows.filter((row) => row.blockedUntil && new Date(row.blockedUntil).getTime() > Date.now());
      expect(blockedRows, 'exactly one source is blocked').toHaveLength(1);
      expect(blockedRows[0].blockReason).toBe('attempts');
      expect(blockedRows[0].failures).toBe(blockAfter);

      // The right password from the blocked source: the generic answer.
      const refused = await request.post(`${trustedHopURL}/api/auth/login`, {
        headers: { 'X-Forwarded-For': blocked },
        data: credentials,
      });
      expect(refused.status()).toBe(401);
      const refusedBody = await refused.json();
      expect(refusedBody.data?.token).toBeFalsy();
      expect(refusedBody.message).toBe((await genericLoginFailure(request, other)).message);

      // Another source logs in with the same password.
      const allowed = await request.post(`${trustedHopURL}/api/auth/login`, {
        headers: { 'X-Forwarded-For': other },
        data: credentials,
      });
      expect(allowed.status(), await allowed.text()).toBe(200);
      expect((await allowed.json()).data?.token).toBeTruthy();

      // A client that names the blocked address itself, straight to the
      // backend, is not that address.
      const spoofed = await request.post(`${apiBaseURL}/api/auth/login`, {
        headers: { 'X-Forwarded-For': blocked },
        data: credentials,
      });
      expect(spoofed.status(), 'X-Forwarded-For from an untrusted socket is ignored').toBe(200);
    } finally {
      await clearLoginAttempts();
      await closeLoginAttemptsDb();
    }
  });

  test('#1263: failures against maxLoginAttempts distinct accounts block the source under the enhanced mode, with a critical audit row and a notification', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const source = '203.0.113.20';
    // A little slack for clock skew between the runner and the backend.
    const started = new Date(Date.now() - 2_000);

    const before = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(before.ok()).toBeTruthy();
    const originalConfig = (await before.json()).data;
    const threshold = Number(originalConfig.authentication.maxLoginAttempts);
    expect(originalConfig.loginAttempts.trackIP, 'precondition: trackIP on').toBe(true);
    // The count's own block must not land first.
    const blockAfter = Number(originalConfig.loginAttempts.blockIPAfterAttempts);
    expect(blockAfter === 0 || blockAfter > threshold, 'precondition: blockIPAfterAttempts above maxLoginAttempts').toBe(true);

    const ruleRes = await request.post(`${apiBaseURL}/api/notification-rules`, {
      headers: auth,
      data: {
        eventType: 'unusual_activity_block',
        channels: ['in_app'],
        recipientRoleCodes: ['administrator'],
        sensitiveFieldsAllowlist: ['distinctAccounts', 'failures'],
        maxDeliveryMinutes: 2,
      },
    });
    expect(ruleRes.ok(), await ruleRes.text()).toBeTruthy();

    try {
      const on = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { enhancedSecurity: { enabled: true, blockUnusualActivity: true, requireMFAForAll: false } },
      });
      expect(on.ok(), await on.text()).toBeTruthy();
      await clearLoginAttempts();

      const stamp = Date.now();
      for (let i = 1; i <= threshold; i += 1) {
        const res = await request.post(`${trustedHopURL}/api/auth/login`, {
          headers: { 'X-Forwarded-For': source },
          data: { username: `spray-${stamp}-${i}@example.com`, password: 'Not@TheRight1263' },
        });
        expect(res.status(), `account ${i} of ${threshold}`).toBe(401);
      }

      const rows = await listLoginAttemptRows();
      const blockedRows = rows.filter((row) => row.blockedUntil && new Date(row.blockedUntil).getTime() > Date.now());
      expect(blockedRows, 'exactly one source is blocked').toHaveLength(1);
      expect(blockedRows[0].blockReason).toBe('unusual_activity');
      expect(blockedRows[0].accounts).toHaveLength(threshold);

      const credentials = { username: process.env.TEST_USER || 'admin', password: process.env.TEST_PASS || 'Admin@123-e2e-stack' };
      const refused = await request.post(`${trustedHopURL}/api/auth/login`, {
        headers: { 'X-Forwarded-For': source },
        data: credentials,
      });
      expect(refused.status(), 'the blocked source is refused the right password too').toBe(401);

      const audit = await findLogRows({
        action: 'LOGIN',
        severity: 'critical',
        'payload.reason': 'unusual_activity',
        timestamp: { $gte: started },
      });
      expect(audit, 'one critical LOGIN audit row for the block').toHaveLength(1);
      expect(audit[0].payload.distinctAccounts).toBe(threshold);
      expect(audit[0].metadata?.tracking?.ip, 'the audit row names the forwarded address').toBe(source);

      const findNotification = async () => {
        const res = await request.get(`${apiBaseURL}/api/notifications?eventType=unusual_activity_block&limit=50`, { headers: auth });
        if (!res.ok()) return null;
        const body = await res.json();
        return (body.data || []).find((n: any) => new Date(n.createdAt).getTime() >= started.getTime()) || null;
      };
      await expect.poll(findNotification, { timeout: 15_000 }).toBeTruthy();
      const notification = await findNotification();
      expect(notification.status).toBe('delivered');
      expect(notification.deliveredChannel).toBe('in_app');
      expect(notification.sourceEventType).toBe('Authentication');
      expect(notification.payload).toEqual({ distinctAccounts: threshold, failures: threshold });
    } finally {
      await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { enhancedSecurity: originalConfig.enhancedSecurity },
      }).catch(() => {});
      await clearLoginAttempts();
      await closeLoginAttemptsDb();
    }
  });

  // #1248: logging.retentionDays, privacy.autoPurge and privacy.purgeAfterDays
  // restated the active RetentionPolicy and were followed by nothing. They are
  // derived from it now, a write to them is dropped, and the Security page
  // shows them read-only. The spec reads whichever policy the stack has active
  // (other specs create them), so it asserts the derivation, not one value.
  test('#1248: the retention keys follow the active RetentionPolicy, ignore writes, and render read-only (criterion 2)', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };

    const activeRes = await request.get(`${apiBaseURL}/api/retention-policies/active`, { headers: auth });
    const active = activeRes.ok() ? (await activeRes.json()).data : null;
    const covers = Boolean(active && (active.applicableEntityTypes || []).some((type: string) => type === 'Log' || type === 'AuditEvent'));
    const dayMatch = covers ? /^P(\d+)D$/.exec(active.retentionPeriod) : null;

    const read = async () => {
      const res = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
      expect(res.ok()).toBeTruthy();
      return (await res.json()).data;
    };
    const before = await read();

    for (const path of ['logging.retentionDays', 'privacy.autoPurge', 'privacy.purgeAfterDays']) {
      expect(before.governedBy?.[path]?.entity, path).toBe('RetentionPolicy');
      expect(before.governedBy?.[path]?.policyId ?? null).toBe(covers ? String(active._id) : null);
    }
    if (!covers) {
      expect(before.privacy.autoPurge).toBe(false);
      expect(before.logging.retentionDays).toBeNull();
    } else {
      expect(before.privacy.autoPurge).toBe(['destroy', 'archive'].includes(active.postRetentionAction));
      if (dayMatch) expect(before.logging.retentionDays).toBe(Number(dayMatch[1]));
      expect(before.privacy.purgeAfterDays).toBe(active.postRetentionAction === 'destroy' ? before.logging.retentionDays : null);
    }

    // A write to the governed keys is dropped; the response and a fresh read
    // still carry the policy's values.
    const put = await request.put(`${apiBaseURL}/api/security/config`, {
      headers: auth,
      data: {
        logging: { retentionDays: 31 },
        privacy: { autoPurge: !before.privacy.autoPurge, purgeAfterDays: 91 },
      },
    });
    expect(put.ok(), await put.text()).toBeTruthy();
    const after = await read();
    expect(after.logging.retentionDays).toBe(before.logging.retentionDays);
    expect(after.privacy.autoPurge).toBe(before.privacy.autoPurge);
    expect(after.privacy.purgeAfterDays).toBe(before.privacy.purgeAfterDays);

    // The page renders the key read-only, with the line naming its source.
    await seedRealAuth(page, admin);
    await page.goto('/system-management?tab=security');
    await page.getByTestId('security-nav-logging').click();
    const help = page.getByTestId('security-retention-governed-help');
    await expect(help).toBeVisible();
    await expect(help).not.toBeEmpty();
    if (covers && active.version) await expect(help).toContainText(String(active.version));
    await expect(page.locator('.config-field').filter({ has: help }).locator('input')).toBeDisabled();
  });

  // RF014 AC1, CFG-002: the setting catalog names, for every key the
  // configuration holds, its type, scope, allowed values, default,
  // dependencies, owner and validity; a value outside a range it declares
  // is refused by the validation run.
  test('RF014 AC1: the setting catalog covers every configuration key, and its ranges are enforced', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const res = await request.get(`${apiBaseURL}/api/security/config/catalog`, { headers: auth });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { catalogVersion, settings } = (await res.json()).data;
    expect(catalogVersion).toMatch(/^\d+\.\d+\.\d+$/);
    const byPath = Object.fromEntries(settings.map((entry: { path: string }) => [entry.path, entry]));

    const config = (await (await request.get(`${apiBaseURL}/api/security/config`, { headers: auth })).json()).data;
    const groups = ['authentication', 'passwordRules', 'session', 'loginAttempts', 'logging', 'privacy', 'enhancedSecurity', 'lgpd'];
    for (const group of groups) {
      for (const key of Object.keys(config[group])) {
        const entry = byPath[`${group}.${key}`];
        expect(entry, `${group}.${key}`).toBeTruthy();
        for (const attribute of ['type', 'scope', 'allowedValues', 'dependencies', 'owner', 'validity']) {
          expect(entry[attribute], `${group}.${key}.${attribute}`).toBeDefined();
        }
      }
    }
    expect(byPath['logging.logAllActions'].allowedValues).toEqual(expect.objectContaining({ kind: 'fixed', value: true, invariantId: 'INV-AUDIT-001' }));
    expect(byPath['passwordRules.minLengthWithMFA'].dependencies).toEqual([
      { path: 'passwordRules.minLength', rule: 'at most passwordRules.minLength' },
    ]);

    const { max } = byPath['session.maxSessionDurationHours'].allowedValues;
    const past = await request.put(`${apiBaseURL}/api/security/config`, {
      headers: auth,
      data: { session: { maxSessionDurationHours: max + 1 } },
    });
    expect(past.status(), await past.text()).toBe(400);
  });

  // RF014 AC4, #1339: the Security page lists the releases and rolls back to
  // a superseded one from the page. The change uses passwordRules.expirationDays,
  // which ends no session, so a rollback here logs no other spec out.
  test('RF014 AC4: the Security page lists the configuration releases and rolls back to a superseded one', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const config = async () => (await (await request.get(`${apiBaseURL}/api/security/config`, { headers: auth })).json()).data;
    const releases = async () => (await (await request.get(`${apiBaseURL}/api/security/config/releases`, { headers: auth })).json()).data;
    const original = (await config()).passwordRules.expirationDays;
    const changed = original === 30 ? 31 : 30;

    const put = await request.put(`${apiBaseURL}/api/security/config`, {
      headers: auth,
      data: { passwordRules: { expirationDays: changed } },
    });
    expect(put.ok(), await put.text()).toBeTruthy();
    const active = (await put.json()).data.configurationReleaseId;
    const history = await releases();
    const superseded = history.find((release: { configurationReleaseId: string }) =>
      release.configurationReleaseId === history.find((r: { configurationReleaseId: string }) => r.configurationReleaseId === active).supersedesId);
    expect(superseded.status).toBe('superseded');
    let rolledBack = false;
    try {
      await seedRealAuth(page, admin);
      await page.goto('/system-management?tab=security');
      await page.getByTestId('security-nav-releases').click();
      const rows = page.getByTestId('security-release-row');
      await expect(rows.first()).toHaveAttribute('data-status', 'active');
      await expect(rows.first().getByTestId('security-release-rollback')).toHaveCount(0);

      const target = rows.filter({ has: page.getByTestId('security-release-version').getByText(superseded.semanticVersion, { exact: true }) });
      await target.getByTestId('security-release-rollback').click();
      rolledBack = true;

      // The new active release names the one it restored, on the page and in the API.
      await expect(rows.first()).toHaveAttribute('data-status', 'active');
      await expect(rows.first().getByTestId('security-release-restores')).toHaveText(superseded.semanticVersion);
      const after = await releases();
      expect(after[0].status).toBe('active');
      expect(after[0].rollbackTargetId).toBe(superseded.configurationReleaseId);
      expect((await config()).passwordRules.expirationDays).toBe(original);
    } finally {
      if (!rolledBack) {
        const restore = await request.put(`${apiBaseURL}/api/security/config`, {
          headers: auth,
          data: { passwordRules: { expirationDays: original } },
        });
        expect(restore.ok(), await restore.text()).toBeTruthy();
      }
    }
  });

  // #1260, #1261: the logging switches RNF009 makes mandatory and the privacy
  // keys whose behaviour is fixed show that behaviour and render read-only.
  // logging.level is a real input and round-trips with the fixed values
  // echoed back, as the page sends them. Since RF014 AC6 (CFG-008) a fixed
  // key sent at another value is refused with 422 naming its invariant, where
  // it used to be dropped silently, and the configuration in force stays.
  test('#1260 #1261: the fixed logging and privacy keys refuse other values and render read-only; logging.level saves', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const read = async () => {
      const res = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
      expect(res.ok()).toBeTruthy();
      return (await res.json()).data;
    };
    const before = await read();
    const fixed: Record<string, [string, unknown]> = {
      'logging.logLoginAttempts': ['audit-required', true],
      'logging.logAllActions': ['audit-required', true],
      'enhancedSecurity.logAllActions': ['audit-required', true],
      'privacy.anonymizeLogs': ['always-anonymized', true],
      'privacy.dataRetentionDays': ['not-applied', null],
      'privacy.anonymizeAfterDays': ['not-applied', null],
      // #1262
      'lgpd.requireConsent': ['consent-required', true],
      'lgpd.consentExpirationDays': ['consent-no-expiry', null],
      // #1266
      'lgpd.anonymizeOnExport': ['export-pseudonymised', true],
    };
    const valueAt = (config: Record<string, Record<string, unknown>>, path: string) => {
      const [group, key] = path.split('.');
      return config[group]?.[key];
    };
    for (const [path, [reason, value]] of Object.entries(fixed)) {
      expect(before.governedBy?.[path]?.fixed, path).toBe(reason);
      expect(valueAt(before, path), path).toBe(value);
    }

    const originalLevel = before.logging.level;
    const newLevel = originalLevel === 'warning' ? 'error' : 'warning';
    try {
      // The page's echo: the fixed keys at their fixed values, plus a real change.
      const put = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: {
          logging: { level: newLevel, logLoginAttempts: true, logAllActions: true },
          privacy: { anonymizeLogs: true, dataRetentionDays: null, anonymizeAfterDays: null },
          enhancedSecurity: { logAllActions: true },
          lgpd: { requireConsent: true, consentExpirationDays: null, anonymizeOnExport: true },
        },
      });
      expect(put.ok(), await put.text()).toBeTruthy();
      const after = await read();
      expect(after.logging.level).toBe(newLevel);
      for (const [path, [, value]] of Object.entries(fixed)) {
        expect(valueAt(after, path), path).toBe(value);
      }

      // Every fixed key at another value, with another level change riding
      // along: the whole request is refused, naming each invariant broken.
      const refused = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: {
          logging: { level: originalLevel, logLoginAttempts: false, logAllActions: false },
          privacy: { anonymizeLogs: false, dataRetentionDays: 40, anonymizeAfterDays: 40 },
          enhancedSecurity: { logAllActions: false },
          lgpd: { requireConsent: false, consentExpirationDays: 40, anonymizeOnExport: false },
        },
      });
      expect(refused.status(), await refused.text()).toBe(422);
      expect((await refused.json()).violatedInvariants).toEqual([
        'INV-AUDIT-001', 'INV-PRIVACY-001', 'INV-CONSENT-001', 'INV-IDENTITY-001',
      ]);
      const inForce = await read();
      expect(inForce.configurationReleaseId).toBe(after.configurationReleaseId);
      expect(inForce.logging.level).toBe(newLevel);
      for (const [path, [, value]] of Object.entries(fixed)) {
        expect(valueAt(inForce, path), path).toBe(value);
      }

      await seedRealAuth(page, admin);
      await page.goto('/system-management?tab=security');
      await page.getByTestId('security-nav-logging').click();
      const loggingHelp = page.getByTestId('security-logging-fixed-help');
      await expect(loggingHelp).not.toBeEmpty();
      await expect(page.locator('.config-switch input[type="checkbox"]:disabled')).toHaveCount(2);
      await page.getByTestId('security-nav-privacy').click();
      const privacyHelp = page.getByTestId('security-privacy-fixed-help');
      await expect(privacyHelp).not.toBeEmpty();
      await expect(page.locator('.config-field').filter({ has: privacyHelp }).locator('input')).toBeDisabled();
    } finally {
      const restore = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { logging: { level: originalLevel } },
      });
      expect(restore.ok(), await restore.text()).toBeTruthy();
    }
  });

  // #1262: lgpd.allowDataDeletion gates the patient delete. A participant id
  // nothing holds answers 404 while deletion is allowed and 403 while it is
  // not, because the gate runs before the lookup's result is used, so the
  // spec needs no patient fixture and deletes nothing.
  test('#1262: lgpd.allowDataDeletion switches the patient delete off', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const config = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(config.ok()).toBeTruthy();
    const original = (await config.json()).data.lgpd?.allowDataDeletion !== false;
    const setAllowed = async (value: boolean) => {
      const res = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { lgpd: { allowDataDeletion: value } },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    };
    const missingId = '99999998';
    try {
      await setAllowed(false);
      const refused = await request.delete(`${apiBaseURL}/api/patients/${missingId}`, { headers: auth });
      expect(refused.status(), await refused.text()).toBe(403);
      expect((await refused.json()).error).toBe('Eliminação desabilitada');

      await setAllowed(true);
      const allowed = await request.delete(`${apiBaseURL}/api/patients/${missingId}`, { headers: auth });
      expect(allowed.status(), await allowed.text()).toBe(404);
    } finally {
      await setAllowed(original);
    }
  });

  // #1266: lgpd.allowDataExport gates the personal-data exports. The report
  // CSV export answers 403 while it is off and anything but that 403 while
  // it is on.
  test('#1266: lgpd.allowDataExport switches the report export off', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const config = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(config.ok()).toBeTruthy();
    const original = (await config.json()).data.lgpd?.allowDataExport !== false;
    const setAllowed = async (value: boolean) => {
      const res = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: { lgpd: { allowDataExport: value } },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    };
    try {
      await setAllowed(false);
      const refused = await request.get(`${apiBaseURL}/api/reports/patient/export`, { headers: auth });
      expect(refused.status(), await refused.text()).toBe(403);
      expect((await refused.json()).error).toBe('Exportação desabilitada');

      await setAllowed(true);
      const allowed = await request.get(`${apiBaseURL}/api/reports/patient/export`, { headers: auth });
      expect(allowed.status(), await allowed.text()).not.toBe(403);
    } finally {
      await setAllowed(original);
    }
  });

  // #1247: the enhancedSecurity group is read only while its enabled switch is
  // on. Under the mode an unenrolled Administrador is sent to MFA enrolment,
  // the mode's session timeout replaces the ordinary one, and the strict
  // password policy holds every composition flag on.
  test('#1247: the enhanced-security mode enrols an Administrador in MFA, replaces the session timeout and holds the strict password policy (criteria 1, 2, 3)', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const before = await request.get(`${apiBaseURL}/api/security/config`, { headers: auth });
    expect(before.ok()).toBeTruthy();
    const originalConfig = (await before.json()).data;
    const original = originalConfig.enhancedSecurity;

    const username = `admin.1247.${Date.now()}`;
    const password = 'Enhanced@1247pass';
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: auth,
      data: { name: '#1247 enhanced Fixture', email: `${username}@example.com`, username, password, accessType: 4, roleName: 'Administrador' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const userID = (await register.json()).data?._id;

    try {
      // Control: mode off, the Administrador logs straight in without MFA.
      const offLogin = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password } });
      expect((await offLogin.json()).data?.token, 'mode off: no enrolment').toBeTruthy();

      const on = await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: {
          // requireStrongPassword off, so only the mode's strict policy refuses the weak password below.
          authentication: { requireStrongPassword: false },
          enhancedSecurity: { enabled: true, requireMFAForAll: true, strictPasswordPolicy: true, sessionTimeoutMinutes: 15 },
        },
      });
      expect(on.ok(), await on.text()).toBeTruthy();

      // The account has logged in before; the mode still enrols it.
      const onLogin = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password } });
      const onBody = await onLogin.json();
      expect(onBody.requiresMFASetup).toBe(true);
      expect(onBody.data?.token).toBeFalsy();

      const enrolled = await completeFirstLoginMfa(request, apiBaseURL!, username, password);
      expect(enrolled.token).toBeTruthy();
      const session = await findLatestSession(userID);
      expect(session!.inactivityTimeoutMs).toBe(15 * 60 * 1000);

      const weak = await request.post(`${apiBaseURL}/api/users/register`, {
        headers: auth,
        data: { name: '#1247 weak Fixture', email: `weak.${username}@example.com`, username: `weak.${username}`, password: 'onlylowercase', accessType: 4, roleName: 'Administrador' },
      });
      expect(weak.ok(), 'the strict policy refuses a one-class password').toBeFalsy();
    } finally {
      await request.put(`${apiBaseURL}/api/security/config`, {
        headers: auth,
        data: {
          authentication: { requireStrongPassword: originalConfig.authentication.requireStrongPassword },
          enhancedSecurity: original,
        },
      }).catch(() => {});
      await closeSessionsDb();
    }
  });

  // #648: AC#4 was genuinely absent (no code path at all) as of the test
  // above — built separately so this criterion's own admin-action + login-
  // gate + real-UI-blocking round trip gets its own real-backend proof.
  // Uses a second admin-role fixture user (not the shared 'admin' account
  // every other spec in this file depends on) so forcing its password reset
  // can't disrupt the rest of the suite sharing this compose.test.yml stack.
  // Admin-role specifically (not Técnico) so first login skips the
  // mandatory-MFA-setup branch entirely and reaches the forceReset gate
  // directly — same path createFirstAdmin.js's own forceReset:true bootstrap
  // takes in production, so this is also a faithful proof of that case.
  test('admin forces a password reset, and the target user is blocked at login until they set a new password (criterion 4)', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);

    const username = `admin.rf014ac4.${Date.now()}`;
    const originalPassword = 'OriginalPass@123';
    const newPassword = 'BrandNewPass@456';

    const registerResponse = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: {
        name: 'RF014 AC4 Force-Reset Fixture',
        email: `${username}@example.com`,
        username,
        password: originalPassword,
        accessType: 4,
        roleName: 'Administrador',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();
    const userID = (await registerResponse.json()).data?._id || (await registerResponse.json()).data?.id;

    const forceReset = await request.post(`${apiBaseURL}/api/users/${userID}/force-password-reset`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(forceReset.ok(), await forceReset.text()).toBeTruthy();

    // The target user logs in with their original password — blocked inline
    // (no navigation away from /login) rather than reaching the dashboard.
    await page.goto('/login');
    await page.getByTestId('login-username-input').fill(username);
    await page.getByTestId('login-password-input').fill(originalPassword);
    await page.getByTestId('login-submit-button').click();

    await expect(page.getByTestId('force-password-change-section')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // Completes the required change inline (same form, no navigation) and
    // reaches the real dashboard.
    await page.getByTestId('login-new-password-input').fill(newPassword);
    await page.getByTestId('login-confirm-new-password-input').fill(newPassword);
    await page.getByTestId('login-submit-button').click();

    await page.waitForURL('**/system-management');
    await expect(page.getByTestId('system-management-page')).toBeVisible();

    // The password genuinely changed server-side, not just client UI state —
    // the old password no longer authenticates.
    const oldPasswordAttempt = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password: originalPassword },
    });
    expect(oldPasswordAttempt.status()).toBe(401);

    const newPasswordAttempt = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password: newPassword },
    });
    expect(newPasswordAttempt.ok(), await newPasswordAttempt.text()).toBeTruthy();
    expect((await newPasswordAttempt.json()).data.token).toBeTruthy();
  });
});

// #1239 / #1005: the Logs screen follows the backend's audit-trail rule
// (administrator or the additive auditor role). A Coordenador used to be let
// onto a page whose every call was refused, and an auditor could not open it.
test.describe('Audit trail screen (RNF009, #1239) — real backend', () => {
  async function registerWithMfa(
    request: import('@playwright/test').APIRequestContext,
    adminToken: string,
    { accessType, roleName, label }: { accessType: number; roleName: string; label: string }
  ) {
    const username = `${label}.${Date.now()}`;
    const password = 'Fixture@123456-forte';
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: `#1239 ${label}`, email: `${username}@example.com`, username, password, accessType, roleName },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const body = await register.json();
    const userID = body.data?._id || body.data?.id;
    return { userID, username, password };
  }

  test('a Técnico holding the auditor role sees the Logs screen and its session view; a Coordenador is refused both', async ({
    page,
    browser,
    request,
  }) => {
    const admin = await realLogin(request);

    const auditor = await registerWithMfa(request, admin.token, { accessType: 2, roleName: 'Técnico', label: 'auditor1239' });
    const grant = await request.put(`${apiBaseURL}/api/users/${auditor.userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { auditorRole: true },
    });
    expect(grant.ok(), await grant.text()).toBeTruthy();
    const auditorSession = await completeFirstLoginMfa(request, apiBaseURL!, auditor.username, auditor.password);
    expect(auditorSession.user.roleName).toBe('Técnico');
    expect((auditorSession.user as { isAuditReader?: boolean }).isAuditReader).toBe(true);

    const coordinator = await registerWithMfa(request, admin.token, { accessType: 3, roleName: 'Coordenador', label: 'coord1239' });
    const coordinatorSession = await completeFirstLoginMfa(request, apiBaseURL!, coordinator.username, coordinator.password);
    expect((coordinatorSession.user as { isAuditReader?: boolean }).isAuditReader).toBe(false);

    // Auditor: the nav entry is there, the page opens, and the session view
    // loads from the real endpoint.
    await seedRealAuth(page, auditorSession);
    const sessionsLoaded = page.waitForResponse(
      (response) => response.url().includes('/api/logs/sessions') && response.request().method() === 'GET'
    );
    await page.goto('/logs');
    expect((await sessionsLoaded).status()).toBe(200);
    await expect(page.getByText('Sessões e motivos de revogação')).toBeVisible();
    await expect(page.getByTestId('session-audit-table')).toBeVisible();
    await expect(page.getByText('Acesso Negado')).toHaveCount(0);
    await expect(page.locator('a[href="/logs"]').first()).toBeVisible();

    // Coordenador: no nav entry, and the route is refused before any call.
    const coordinatorContext = await browser.newContext();
    const coordinatorPage = await coordinatorContext.newPage();
    await seedRealAuth(coordinatorPage, coordinatorSession);
    const refusedCalls: string[] = [];
    coordinatorPage.on('request', (req) => {
      if (req.url().includes('/api/logs')) refusedCalls.push(req.url());
    });
    await coordinatorPage.goto('/logs');
    await expect(coordinatorPage.getByText('Acesso Negado')).toBeVisible();
    await expect(coordinatorPage.locator('a[href="/logs"]')).toHaveCount(0);
    expect(refusedCalls).toEqual([]);
    await coordinatorContext.close();
  });

  // #1240 (RF003 AC#3): the auditor role is granted and revoked from the
  // user edit form, not only through a raw PUT.
  test('the administrator grants the auditor role from the user form, the list shows it, the target sees Logs, and unticking revokes it', async ({
    page,
    browser,
    request,
  }) => {
    const admin = await realLogin(request);
    const target = await registerWithMfa(request, admin.token, { accessType: 2, roleName: 'Técnico', label: 'form1240' });

    async function saveAuditorFlag(checked: boolean) {
      await page.goto('/system-management?tab=users');
      await page.getByTestId(`edit-user-button-${target.userID}`).click();
      const checkbox = page.getByTestId('new-user-auditor-checkbox');
      await expect(checkbox).toBeVisible();
      await checkbox.setChecked(checked);
      const saved = page.waitForResponse(
        (response) => response.url().includes(`/api/users/${target.userID}`) && response.request().method() === 'PUT'
      );
      await page.getByTestId('new-user-submit-button').click();
      const response = await saved;
      expect(response.status(), await response.text()).toBe(200);
      expect(response.request().postDataJSON().auditorRole).toBe(checked);
      expect((await response.json()).data.auditorRole).toBe(checked);
      await expect(page).toHaveURL(/system-management/);
    }

    await seedRealAuth(page, admin);

    // Before the grant, the list shows no auditor badge.
    await page.goto('/system-management?tab=users');
    await expect(page.getByTestId(`auditor-badge-${target.userID}`)).toHaveCount(0);

    await saveAuditorFlag(true);
    await expect(page.getByTestId(`auditor-badge-${target.userID}`)).toBeVisible();

    // The edit form now seeds itself ticked from the list row.
    await page.getByTestId(`edit-user-button-${target.userID}`).click();
    await expect(page.getByTestId('new-user-auditor-checkbox')).toBeChecked();

    const targetSession = await completeFirstLoginMfa(request, apiBaseURL!, target.username, target.password);
    expect((targetSession.user as { isAuditReader?: boolean }).isAuditReader).toBe(true);
    const targetContext = await browser.newContext();
    const targetPage = await targetContext.newPage();
    await seedRealAuth(targetPage, targetSession);
    await targetPage.goto('/logs');
    await expect(targetPage.getByText('Acesso Negado')).toHaveCount(0);
    await expect(targetPage.locator('a[href="/logs"]').first()).toBeVisible();
    await targetContext.close();

    await saveAuditorFlag(false);
    await expect(page.getByTestId(`auditor-badge-${target.userID}`)).toHaveCount(0);
    const afterRevoke = await request.get(`${apiBaseURL}/api/users/${target.userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect((await afterRevoke.json()).data.auditorRole).toBe(false);
  });
});

// #1020 / RF003 AC#5: the administrator revokes an account's sessions from
// the user-management screen, choosing 'risk' in the second dialog.
test.describe('Administrator session revoke (RF003 criterion 5, #1020) — real backend', () => {
  test('the revoke button on System Management kills the target\'s live session and records reason risk', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);
    const username = `revoke1020.${Date.now()}`;
    const password = 'Fixture@123456-forte';
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { name: '#1020 revoke target', email: `${username}@example.com`, username, password, accessType: 2, roleName: 'Técnico' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const registered = await register.json();
    const userID = registered.data?._id || registered.data?.id;
    const target = await completeFirstLoginMfa(request, apiBaseURL!, username, password);

    await seedRealAuth(page, admin);
    await page.goto('/system-management?tab=users');
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      // Both confirms are accepted: revoke, then "OK" = reason risk.
      await dialog.accept();
    });
    const revokeCall = page.waitForResponse(
      (response) => response.url().includes(`/api/users/${userID}/revoke-sessions`) && response.request().method() === 'POST'
    );
    await page.getByTestId(`revoke-sessions-button-${userID}`).click();
    const revokeResponse = await revokeCall;
    expect(revokeResponse.status()).toBe(200);
    expect(await revokeResponse.json()).toMatchObject({ data: { revoked: 1, reason: 'risk' } });
    await expect.poll(() => dialogs.length).toBe(3);
    expect(dialogs[2]).toContain('1 sessão(ões) revogada(s)');

    const afterRevoke = await request.get(`${apiBaseURL}/api/user/security/status`, {
      headers: { Authorization: `Bearer ${target.token}` },
    });
    expect(afterRevoke.status()).toBe(401);
  });
});

// #1013: an administrator sets another user's password through its own route,
// with the owner's password bookkeeping, not through PUT /api/users/:id.
test.describe('Administrator password set (RF003 criteria 2 and 5, #1013) — real backend', () => {
  test('the edit form sets the password through set-password: sessions end, a change is forced, the old password is dead and cannot be set back; PUT refuses a password', async ({
    page,
    request,
  }) => {
    const admin = await realLogin(request);
    const username = `setpw1013.${Date.now()}`;
    const originalPassword = 'OriginalPass@1013';
    const adminSetPassword = 'AdminSet@Pass1013';
    // An Administrador target, as in the RF014 criterion-4 test: it has no
    // MFA onboarding, so the login responses below are the password logic's.
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { name: '#1013 set-password target', email: `${username}@example.com`, username, password: originalPassword, accessType: 4, roleName: 'Administrador' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const userID = (await register.json()).data?._id;
    const targetLogin = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password: originalPassword } });
    expect(targetLogin.ok(), await targetLogin.text()).toBeTruthy();
    const targetToken = (await targetLogin.json()).data.token;

    const refused = await request.put(`${apiBaseURL}/api/users/${userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { password: 'Another@Pass1013' },
    });
    expect(refused.status()).toBe(422);

    await seedRealAuth(page, admin);
    await page.goto('/system-management?tab=users');
    await page.getByTestId(`edit-user-button-${userID}`).click();
    await page.getByTestId('new-user-password-input').fill(adminSetPassword);
    const setCall = page.waitForResponse(
      (response) => response.url().includes(`/api/users/${userID}/set-password`) && response.request().method() === 'POST'
    );
    const putCall = page.waitForResponse(
      (response) => response.url().includes(`/api/users/${userID}`) && response.request().method() === 'PUT'
    );
    await page.getByTestId('new-user-submit-button').click();
    const setResponse = await setCall;
    expect(setResponse.status(), await setResponse.text()).toBe(200);
    const putResponse = await putCall;
    expect(putResponse.status(), await putResponse.text()).toBe(200);
    expect(putResponse.request().postDataJSON()).not.toHaveProperty('password');

    // RF003 AC#5: the session the target already held is gone.
    const staleSession = await request.get(`${apiBaseURL}/api/user/security/status`, {
      headers: { Authorization: `Bearer ${targetToken}` },
    });
    expect(staleSession.status()).toBe(401);

    // The administrator knows the new password, so the owner must replace it.
    const withNew = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password: adminSetPassword } });
    expect(withNew.ok(), await withNew.text()).toBeTruthy();
    expect((await withNew.json()).requiresPasswordChange).toBe(true);
    const withOld = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password: originalPassword } });
    expect(withOld.status()).toBe(401);

    // RF003 AC#2: the replaced password is in the history, so it cannot be set back.
    const reuse = await request.post(`${apiBaseURL}/api/users/${userID}/set-password`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { password: originalPassword },
    });
    expect(reuse.status()).toBe(422);
    expect((await reuse.json()).message).toContain('Senha já utilizada recentemente');
  });

  // #1250: a never-logged-in non-admin is sent to MFA enrolment before
  // processLogin reaches its forceReset branch, and enable-first-login issued
  // a full session on the administrator-set password. Now the enrolment
  // completes, no session is issued, and the next login forces the change.
  test('#1250: a first-login MFA enrolment on an administrator-set password issues no session until the password is replaced', async ({
    request,
  }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const username = `tecnico.1250.${Date.now()}`;
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: auth,
      data: { name: '#1250 first-login Fixture', email: `${username}@example.com`, username, password: 'Initial@1250pass', accessType: 2, roleName: 'Técnico' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const userID = (await register.json()).data?._id;
    expect(userID).toBeTruthy();

    const adminSet = 'AdminSet@1250pass';
    const set = await request.post(`${apiBaseURL}/api/users/${userID}/set-password`, { headers: auth, data: { password: adminSet } });
    expect(set.status(), await set.text()).toBe(200);

    // The first login goes to enrolment (requireMFA is the canonical default).
    const first = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password: adminSet } });
    expect(first.ok(), await first.text()).toBeTruthy();
    expect((await first.json()).requiresMFASetup).toBe(true);

    const qr = await request.post(`${apiBaseURL}/api/auth/two-factor/qr-first-login`, { data: { username, password: adminSet } });
    expect(qr.ok(), await qr.text()).toBeTruthy();
    const secret = (await qr.json()).data?.secret;
    expect(secret).toBeTruthy();

    const enable = await request.post(`${apiBaseURL}/api/auth/two-factor/enable-first-login`, {
      data: { username, password: adminSet, code: computeTotp(secret) },
    });
    expect(enable.ok(), await enable.text()).toBeTruthy();
    const enableBody = await enable.json();
    expect(enableBody.data?.requiresPasswordChange).toBe(true);
    expect(enableBody.data?.token).toBeFalsy();
    expect(enable.headers()['set-cookie'] || '').not.toContain('refresh_token=');

    // The enrolment stands: the next login asks for the code, then for the change.
    const withCode = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password: adminSet, mfaCode: computeTotp(secret) },
    });
    expect(withCode.ok(), await withCode.text()).toBeTruthy();
    const withCodeBody = await withCode.json();
    expect(withCodeBody.requiresPasswordChange).toBe(true);
    expect(withCodeBody.data?.token).toBeFalsy();

    const changed = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password: adminSet, mfaCode: computeTotp(secret), newPassword: 'Owner@1250chosen' },
    });
    expect(changed.ok(), await changed.text()).toBeTruthy();
    expect((await changed.json()).data?.token).toBeTruthy();
  });

  // #1270: the same first login, through the authenticated enrolment the
  // login's setup tempToken admits. GET /two-factor/qr and POST
  // /two-factor/enable issued a full session on the administrator-set
  // password; they now withhold it exactly as enable-first-login does.
  test('#1270: the setup tempToken cannot complete a first login past a forced password change', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const username = `tecnico.1270.${Date.now()}`;
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: auth,
      data: { name: '#1270 first-login Fixture', email: `${username}@example.com`, username, password: 'Initial@1270pass', accessType: 2, roleName: 'Técnico' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const userID = (await register.json()).data?._id;
    expect(userID).toBeTruthy();

    const adminSet = 'AdminSet@1270pass';
    const set = await request.post(`${apiBaseURL}/api/users/${userID}/set-password`, { headers: auth, data: { password: adminSet } });
    expect(set.status(), await set.text()).toBe(200);

    const first = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username, password: adminSet } });
    expect(first.ok(), await first.text()).toBeTruthy();
    const firstBody = await first.json();
    expect(firstBody.requiresMFASetup).toBe(true);
    const temp = { Authorization: `Bearer ${firstBody.data?.tempToken}` };
    expect(firstBody.data?.tempToken).toBeTruthy();

    const qr = await request.get(`${apiBaseURL}/api/auth/two-factor/qr`, { headers: temp });
    expect(qr.ok(), await qr.text()).toBeTruthy();
    const secret = (await qr.json()).data?.secret;
    expect(secret).toBeTruthy();

    const enable = await request.post(`${apiBaseURL}/api/auth/two-factor/enable`, {
      headers: temp,
      data: { code: computeTotp(secret) },
    });
    expect(enable.ok(), await enable.text()).toBeTruthy();
    const enableBody = await enable.json();
    expect(enableBody.data?.requiresPasswordChange).toBe(true);
    expect(enableBody.data?.token).toBeFalsy();
    expect(enable.headers()['set-cookie'] || '').not.toContain('refresh_token=');

    // The enrolment stands, and the next login still forces the change.
    const withCode = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username, password: adminSet, mfaCode: computeTotp(secret) },
    });
    expect(withCode.ok(), await withCode.text()).toBeTruthy();
    const withCodeBody = await withCode.json();
    expect(withCodeBody.requiresPasswordChange).toBe(true);
    expect(withCodeBody.data?.token).toBeFalsy();
  });
});

// #1306: the session and account lifecycle on the live stack. Inactivation,
// a role change, a logical delete and a logout each end the sessions they
// should (RF001 AC4, RNF021 C2), refresh refuses an inactive account, and the
// per-account lockout holds against the right password (RF001 AC2).
test.describe('Session and account lifecycle (RF001 criteria 2 and 4, RNF021, #1306) — real backend', () => {
  const trustedHopURL = process.env.E2E_TRUSTED_HOP_URL || 'http://localhost:3100';
  const password = 'Tecnico@123456-forte';

  async function registerTecnico(request: APIRequestContext, adminToken: string, label: string) {
    const username = `tecnico.${label}.${Date.now()}`;
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: `Fixture ${label}`, email: `${username}@example.com`, username, password, accessType: 2, roleName: 'Técnico' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const body = await register.json();
    return { userID: body.data?._id || body.data?.id, username };
  }

  // The first-login enrolment, inline so the refresh cookie it sets is kept.
  async function openSession(request: APIRequestContext, username: string) {
    const qr = await request.post(`${apiBaseURL}/api/auth/two-factor/qr-first-login`, { data: { username, password } });
    expect(qr.ok(), await qr.text()).toBeTruthy();
    const secret = (await qr.json()).data?.secret;
    const enable = await request.post(`${apiBaseURL}/api/auth/two-factor/enable-first-login`, {
      data: { username, password, code: computeTotp(secret) },
    });
    expect(enable.ok(), await enable.text()).toBeTruthy();
    const refreshCookie = /refresh_token=[^;]+/.exec(enable.headers()['set-cookie'] || '')?.[0];
    expect(refreshCookie, 'enrolment sets the refresh cookie').toBeTruthy();
    return { token: (await enable.json()).data.token as string, refreshCookie: refreshCookie!, secret: secret as string };
  }

  const status = (request: APIRequestContext, token: string) =>
    request.get(`${apiBaseURL}/api/user/security/status`, { headers: { Authorization: `Bearer ${token}` } });

  test('inactivation ends the live session and refresh refuses the account (RF001 criterion 4, RNF021 criterion 2)', async ({ request }) => {
    const admin = await realLogin(request);
    const target = await registerTecnico(request, admin.token, 'inact1306');
    const session = await openSession(request, target.username);
    expect((await status(request, session.token)).status(), 'the session works before').toBe(200);

    const inactivate = await request.put(`${apiBaseURL}/api/users/${target.userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { status: 'inactive' },
    });
    expect(inactivate.ok(), await inactivate.text()).toBeTruthy();

    expect((await status(request, session.token)).status()).toBe(401);
    const refreshed = await request.post(`${apiBaseURL}/api/auth/refresh`, { headers: { Cookie: session.refreshCookie } });
    expect(refreshed.status()).toBe(401);
    expect((await refreshed.json()).data?.token).toBeFalsy();

    const revoked = await findLatestSession(target.userID);
    expect(revoked?.isActive).toBe(false);
    expect(revoked?.revocationReason).toBe('admin_action');
    await closeSessionsDb();
  });

  test('a role change ends the live session (RNF021 criterion 2, RNF008 criterion 7)', async ({ request }) => {
    const admin = await realLogin(request);
    const target = await registerTecnico(request, admin.token, 'role1306');
    const session = await openSession(request, target.username);
    expect((await status(request, session.token)).status()).toBe(200);

    const promote = await request.put(`${apiBaseURL}/api/users/${target.userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { accessType: 3, roleName: 'Coordenador' },
    });
    expect(promote.ok(), await promote.text()).toBeTruthy();
    expect((await status(request, session.token)).status()).toBe(401);
  });

  test('DELETE inactivates the account and keeps its record; its session ends and it cannot log in (RF003 criterion 4, RNF022 criterion 5)', async ({ request }) => {
    const admin = await realLogin(request);
    const target = await registerTecnico(request, admin.token, 'del1306');
    const session = await openSession(request, target.username);

    const removed = await request.delete(`${apiBaseURL}/api/users/${target.userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(removed.ok(), await removed.text()).toBeTruthy();

    const kept = await request.get(`${apiBaseURL}/api/users/${target.userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(kept.ok(), 'the record survives the delete').toBeTruthy();
    expect((await kept.json()).data.status).toBe('Inativo');
    expect((await status(request, session.token)).status()).toBe(401);
    const login = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username: target.username, password } });
    expect(login.ok()).toBeFalsy();

    // RNF022 criterion 5: the inactivated account's historical events are
    // kept, pseudonymized: its session history reads back under its stored
    // pseudonym, never its raw id or username.
    const stored = await findStoredUser(String(target.userID));
    expect(stored?.anonId).toMatch(/^USR-[0-9A-F]{8}$/);
    const historyResponse = await request.get(`${apiBaseURL}/api/logs/sessions?userId=${target.userID}`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(historyResponse.ok(), await historyResponse.text()).toBeTruthy();
    const sessionHistory = (await historyResponse.json()).data;
    expect(sessionHistory.sessions.length).toBeGreaterThan(0);
    for (const s of sessionHistory.sessions) expect(s.user).toBe(stored!.anonId);
    const adminEnded = sessionHistory.sessions.find((s: { revocationReason: string }) => s.revocationReason === 'admin_action');
    expect(adminEnded, 'the delete ended a session by admin action').toBeTruthy();
    expect(adminEnded.revokedBy).toMatch(/^USR-[0-9A-F]{8}$/);
    expect(adminEnded.revokedBy).not.toBe(stored!.anonId);
    const rawHistory = JSON.stringify(sessionHistory);
    expect(rawHistory).not.toContain(String(target.userID));
    expect(rawHistory).not.toContain(target.username);
    await closeStoredCredentialsDb();
  });

  test('logout ends the session it was sent on (RF001 criterion 4)', async ({ request }) => {
    const admin = await realLogin(request);
    const target = await registerTecnico(request, admin.token, 'logout1306');
    const session = await openSession(request, target.username);
    expect((await status(request, session.token)).status()).toBe(200);

    const logout = await request.post(`${apiBaseURL}/api/auth/logout`, { headers: { Authorization: `Bearer ${session.token}` } });
    expect(logout.ok(), await logout.text()).toBeTruthy();
    expect((await status(request, session.token)).status()).toBe(401);
  });

  // The failures go through the trusted hop, each from its own TEST-NET-3
  // address (RFC 5737), so no source reaches blockIPAfterAttempts and the
  // runner's own address, shared by every spec, counts nothing.
  test('maxLoginAttempts failed passwords lock the account, and the right password is then refused (RF001 criterion 2)', async ({ request }) => {
    const admin = await realLogin(request);
    try {
      const config = (await (await request.get(`${apiBaseURL}/api/security/config`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      })).json()).data;
      const maxAttempts = Number(config.authentication.maxLoginAttempts);
      expect(maxAttempts, 'precondition: maxLoginAttempts is positive').toBeGreaterThan(0);
      const target = await registerTecnico(request, admin.token, 'lock1306');

      // CONTROL: the right password is accepted before any failure.
      const before = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username: target.username, password } });
      expect(before.ok(), await before.text()).toBeTruthy();

      let wrongMessage = '';
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const failed = await request.post(`${trustedHopURL}/api/auth/login`, {
          headers: { 'X-Forwarded-For': `203.0.113.${100 + attempt}` },
          data: { username: target.username, password: 'Not@TheRight1306' },
        });
        expect(failed.status(), `failure ${attempt} of ${maxAttempts}`).toBe(401);
        wrongMessage = (await failed.json()).message;
      }

      const locked = await request.post(`${apiBaseURL}/api/auth/login`, { data: { username: target.username, password } });
      expect(locked.status()).toBe(401);
      const lockedBody = await locked.json();
      expect(lockedBody.data?.tempToken ?? lockedBody.data?.token).toBeFalsy();
      // The same answer as a wrong password: a distinct one would tell a
      // caller the account exists and is locked.
      expect(lockedBody.message).toBe(wrongMessage);
    } finally {
      await clearLoginAttempts();
      await closeLoginAttemptsDb();
    }
  });

  // #1456: a JWT's claims, read without verifying it (the runner holds no secret).
  const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
  const refreshCookieLine = (setCookie: string) => setCookie.split('\n').find((line) => line.startsWith('refresh_token='));

  test('a session is created with an expiry and the account role (RF001 criterion 3, #1456)', async ({ request }) => {
    const admin = await realLogin(request);
    const username = `coordenador.rf001ac3.${Date.now()}`;
    const register = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { name: 'Fixture rf001ac3', email: `${username}@example.com`, username, password, accessType: 3, roleName: 'Coordenador' },
    });
    expect(register.ok(), await register.text()).toBeTruthy();
    const registered = await register.json();
    const userID = registered.data?._id || registered.data?.id;
    const session = await openSession(request, username);

    // The role rides on the session's access token and is resolved from the
    // live assignment by /verify.
    expect(claimsOf(session.token).accessType).toBe(3);
    const verify = await request.get(`${apiBaseURL}/api/auth/verify`, { headers: { Authorization: `Bearer ${session.token}` } });
    expect(verify.ok(), await verify.text()).toBeTruthy();
    const verified = (await verify.json()).data.user;
    expect(verified.roleName).toBe('Coordenador');
    expect(verified.accessType).toBe(3);

    // The expiry is on the stored session.
    const stored = await findLatestSession(userID);
    expect(new Date(stored!.expiresAt).getTime() - new Date(stored!.sessionStartedAt).getTime()).toBe(15 * 60 * 1000);
    expect(new Date(stored!.refreshExpiresAt).getTime()).toBeGreaterThan(new Date(stored!.expiresAt).getTime());
    await closeSessionsDb();
  });

  test('an edit and a block of an account are each audited (RF003 criterion 6, #1456)', async ({ request }) => {
    const admin = await realLogin(request);
    const target = await registerTecnico(request, admin.token, 'audit1456');
    const auth = { Authorization: `Bearer ${admin.token}` };

    const edit = await request.put(`${apiBaseURL}/api/users/${target.userID}`, { headers: auth, data: { name: 'Fixture audit1456 edited' } });
    expect(edit.ok(), await edit.text()).toBeTruthy();
    const block = await request.put(`${apiBaseURL}/api/users/${target.userID}`, { headers: auth, data: { status: 'blocked' } });
    expect(block.ok(), await block.text()).toBeTruthy();
    expect((await block.json()).data.status).toBe('Bloqueado');

    const rows = await findLogRows({ action: 'UPDATE', resourceType: 'User', resourceId: String(target.userID) });
    const editRow = rows.find((row) => row.payload == null);
    expect(editRow, 'the edit wrote an UPDATE row with no status change').toBeTruthy();
    const blockRow = rows.find((row) => row.payload?.status?.to === 'blocked');
    expect(blockRow, 'the block wrote an UPDATE row naming the status change').toBeTruthy();
    expect(blockRow!.payload.status.from).toBe('active');
    expect(blockRow).not.toBe(editRow);
    await closeLoginAttemptsDb();
  });

  test('the access token is short-lived, a rotated refresh token is refused, tokens are stored only as hashes, and the refresh cookie is HttpOnly and SameSite (RNF021 criteria 1, 4 and 5, #1456)', async ({ request }) => {
    const admin = await realLogin(request);
    const target = await registerTecnico(request, admin.token, 'rot1456');
    const session = await openSession(request, target.username);

    // Criterion 1: a 15-minute access token.
    const claims = claimsOf(session.token);
    expect(claims.exp - claims.iat).toBe(15 * 60);

    // Criterion 1: rotation. Each refresh issues a new refresh token, and the
    // one it replaced is refused from then on.
    const refresh = (cookie: string) => request.post(`${apiBaseURL}/api/auth/refresh`, { headers: { Cookie: cookie } });
    const first = await refresh(session.refreshCookie);
    expect(first.ok(), await first.text()).toBeTruthy();
    const firstLine = refreshCookieLine(first.headers()['set-cookie'] || '');
    expect(firstLine, 'the refresh sets a new refresh cookie').toBeTruthy();
    const second = /refresh_token=[^;]+/.exec(firstLine!)![0];
    expect(second).not.toBe(session.refreshCookie);

    // Criterion 5: HttpOnly and SameSite on the stack. It runs NODE_ENV=test
    // over plain HTTP, where the cookie is SameSite=Lax and not Secure;
    // production's Secure and SameSite=Strict are pinned by the backend's
    // auth.refresh-cookie.1456 test.
    expect(firstLine).toMatch(/;\s*HttpOnly(;|$)/i);
    expect(firstLine).toMatch(/;\s*SameSite=Lax(;|$)/i);
    expect(firstLine).toMatch(/;\s*Path=\/api\/auth(;|$)/i);

    const reused = await refresh(session.refreshCookie);
    expect(reused.status(), 'the refresh token rotated away is refused').toBe(401);
    expect((await reused.json()).data?.token).toBeFalsy();

    const third = await refresh(second);
    expect(third.ok(), await third.text()).toBeTruthy();
    const latestCookie = /refresh_token=[^;]+/.exec(refreshCookieLine(third.headers()['set-cookie'] || '') || '')?.[0];
    expect(latestCookie).toBeTruthy();
    expect(latestCookie).not.toBe(second);
    const latestAccess = (await third.json()).data.token as string;
    const reusedSecond = await refresh(second);
    expect(reusedSecond.status(), 'a token rotated away inside the same second is refused too').toBe(401);

    // Criterion 4: the stored session holds the sha256 of the live tokens and
    // no token in clear.
    const stored = await findLatestSession(target.userID);
    const rawRefresh = latestCookie!.slice('refresh_token='.length);
    expect(stored!.accessTokenHash).toBe(sha256(latestAccess));
    expect(stored!.refreshTokenHash).toBe(sha256(rawRefresh));
    const text = JSON.stringify(stored);
    for (const raw of [session.token, latestAccess, session.refreshCookie.slice('refresh_token='.length), second.slice('refresh_token='.length), rawRefresh]) {
      expect(text.includes(raw), 'no raw token in the session document').toBe(false);
    }
    for (const field of ['token', 'accessToken', 'refreshToken']) {
      expect(stored).not.toHaveProperty(field);
    }
    await closeSessionsDb();
  });

  test('a session idle past its inactivity timeout is refused and ended as an expiry (RNF021 criterion 3, #1456)', async ({ request }) => {
    const admin = await realLogin(request);
    const config = await request.get(`${apiBaseURL}/api/security/config`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(config.ok(), await config.text()).toBeTruthy();
    expect((await config.json()).data.enhancedSecurity?.enabled, 'precondition: the enhanced mode would replace the timeout').not.toBe(true);
    const target = await registerTecnico(request, admin.token, 'idle1456');

    // The API's floor is 5 minutes, so the stored value is set to 3 seconds
    // for the one session opened here and put back at once; createSession
    // copies it onto the session.
    let session: { token: string; refreshCookie: string };
    const previous = await setStoredSessionTimeoutMinutes(0.05);
    try {
      session = await openSession(request, target.username);
      // At once: the 3-second idle clock runs from the session's creation, so
      // this check comes before any other round trip.
      expect((await status(request, session.token)).status(), 'the session works while active').toBe(200);
    } finally {
      await setStoredSessionTimeoutMinutes(previous);
      await closeStoredCredentialsDb();
    }
    const opened = await findLatestSession(target.userID);
    expect(opened!.inactivityTimeoutMs).toBe(3000);

    await new Promise((resolve) => setTimeout(resolve, 4_000));
    expect((await status(request, session.token)).status(), 'idle past the timeout').toBe(401);

    const ended = await findLatestSession(target.userID);
    expect(ended!.isActive).toBe(false);
    expect(ended!.revocationReason).toBe('expiration');
    await closeSessionsDb();
  });

  test('a password is stored only as a bcrypt hash and the MFA secret only as an AES-GCM envelope with a key id (RNF020 criteria 2, 3 and 5, #1456)', async ({ request }) => {
    const admin = await realLogin(request);
    const target = await registerTecnico(request, admin.token, 'rest1456');
    const session = await openSession(request, target.username);

    const user = await findStoredUser(target.userID);
    const text = JSON.stringify(user);

    // Criterion 2: an adaptive hash, never the password.
    const hash = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/.exec(String(user!.passwordHash));
    expect(hash, 'passwordHash is a bcrypt hash').toBeTruthy();
    expect(Number(hash![1])).toBeGreaterThanOrEqual(10);
    expect(user).not.toHaveProperty('password');
    expect(text.includes(password)).toBe(false);

    // Criterion 3: the TOTP seed is ciphertext. The enrolment that just
    // succeeded checked its code against this envelope, decrypted.
    const envelope = user!.mfaSecretCiphertext;
    expect(envelope.alg).toBe('aes-256-gcm');
    for (const field of ['iv', 'tag', 'data']) expect(typeof envelope[field]).toBe('string');
    expect(user).not.toHaveProperty('mfaSecret');
    expect(text.includes(session.secret)).toBe(false);

    // Criterion 5: the envelope names the deployment's key id, the slot a key
    // rotation reads, not the code default. Rotation itself needs a restart
    // under a new key and is proven by the backend's fieldEncryption tests.
    expect(typeof envelope.keyId).toBe('string');
    expect(envelope.keyId).not.toBe('default');
    await closeStoredCredentialsDb();
  });

  // RNF020 criterion 1: TLS 1.2 or higher is negotiated by the deployment's
  // HTTPS edge, not by this stack, which serves plain HTTP; the deployment
  // check proves the TLS version. The application's own part is to tell
  // browsers to use HTTPS only.
  test('the API sends Strict-Transport-Security (RNF020 criterion 1, #1456)', async ({ request }) => {
    const response = await request.get(`${apiBaseURL}/api/auth/password-policy`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const hsts = response.headers()['strict-transport-security'] || '';
    expect(hsts).toMatch(/max-age=31536000/);
    expect(hsts).toMatch(/includeSubDomains/);
    expect(hsts).toMatch(/preload/);
  });
});
