import { test, expect } from '@playwright/test';
import { realLogin, realAuthLogin } from './helpers/realAuth';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import { computeTotp } from './helpers/totp';

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

    // Stronger proof (#335): complete the Técnico's first-login MFA to get
    // a genuine non-admin session (see #293's completeFirstLoginMfa), and
    // confirm the backend's RBAC gate itself refuses it with a real 403 —
    // not just the setup-only tempToken's 401 above.
    const tecnicoSession = await completeFirstLoginMfa(request, apiBaseURL!, username, 'Tecnico@123');
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
        password: 'Tecnico@123',
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
        password: 'Tecnico@123',
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
        password: 'Tecnico@123',
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
        password: 'Tecnico@123',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();

    const loginResponse = await request.post(`${apiBaseURL}/api/auth/login`, {
      data: { username: tecnicoUsername, password: 'Tecnico@123' },
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
        password: 'Blocked@123',
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
    const tecnicoSession = await completeFirstLoginMfa(request, apiBaseURL!, tecnicoUsername, 'Tecnico@123');
    const forbiddenRegisterRbac = await request.post(`${apiBaseURL}/api/users/register`, {
      headers: { Authorization: `Bearer ${tecnicoSession.token}` },
      data: {
        name: 'Should Not Be Created (RBAC)',
        email: `blocked.rbac.${Date.now()}@example.com`,
        username: `blocked.rbac.${Date.now()}`,
        password: 'Blocked@123',
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
    const initialPassword = 'Tecnico@123456';
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

    // Rejection case: a new password failing PasswordValidator's complexity
    // rules (min 12 chars, upper+lower+special) is refused — too short and
    // missing a special character.
    const weakAttempt = await request.put(`${apiBaseURL}/api/user/security/password`, {
      headers: { Authorization: `Bearer ${tecnicoSession.token}` },
      data: { currentPassword: initialPassword, newPassword: 'Weak1234567' },
    });
    expect(weakAttempt.status()).toBe(400);

    // Happy path: a complying new password is accepted, and the change is
    // audited.
    const watch = await watchAuditTrail(request, apiBaseURL!, admin.token);
    const newPassword = 'Tecnico!New456';
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
    const password = 'Tecnico@123456';
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
    const orgB = await request.post(`${apiBaseURL}/api/organizations`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { officialName: `Biobanco Norte ${orgSuffix}`, countryCode: 'BR' },
    });
    expect(orgB.ok(), await orgB.text()).toBeTruthy();
    const orgBId = (await orgB.json()).data?.organizationId;

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
        password: 'Tecnico@123456',
        accessType: 2,
        roleName: 'Técnico',
      },
    });
    expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();
    const userID = (await registerResponse.json()).data?._id || (await registerResponse.json()).data?.id;

    // Inactivation here is PUT /:id with status: 'inactive', not DELETE
    // /:id — that route does a hard `deleteOne` (confirmed reading
    // user.routes.js), which would destroy the history AC#4 requires be
    // kept, so it can't be the mechanism this criterion is proven with.
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
      data: { username, password: 'Tecnico@123456' },
    });
    expect(loginResponse.ok()).toBeFalsy();
  });

  test('sessions can be revoked and an admin can perform a controlled MFA reset (criterion 5)', async ({
    request,
  }) => {
    const admin = await realLogin(request);

    const username = `tecnico.rf003ac5.${Date.now()}`;
    const password = 'Tecnico@123456';
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
  });
});
