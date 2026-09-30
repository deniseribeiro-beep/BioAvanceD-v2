import { test, expect } from '@playwright/test';
import { realLogin, realAuthLogin, seedRealAuth } from './helpers/realAuth';
import { watchAuditTrail, assertAuditEventRecorded } from './helpers/assertAuditEvent';
import { completeFirstLoginMfa } from './helpers/completeFirstLoginMfa';
import { computeTotp } from './helpers/totp';
import { findLatestSession, closeSessionsDb, listSessionIndexNames } from './helpers/querySessions';

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
    // tokenHash lookup's included (ensured un-awaited, so polled).
    await expect
      .poll(async () => listSessionIndexNames(), { timeout: 10_000 })
      .toEqual(expect.arrayContaining(['sessions_tokenHash_v1', 'sessions_revocationReason_createdAt_v1']));
    await closeSessionsDb();
  });
});

// Wave 3 kickoff (#646). requisitos-index.md RF014's 8 acceptance criteria
// map onto security.service.js's existing security_config singleton
// (security.routes.js's GET/PUT /api/security/config) -- product-side
// foundation already existed (confirmed by reading the service, not
// assumed from the issue's own "likely" framing), this file just never
// proved it against the real backend. AC#4 (force a user's password reset)
// and AC#8 (revoke sessions when a policy change requires it) are NOT
// implemented anywhere in the backend -- filed as gaps rather than built
// here, since AC#8 in particular needs a design call (which policy
// changes require revocation?) bigger than this slice.
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
      const password = 'Tecnico@123456';
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
      expect(new Date(session!.refreshExpiresAt).getTime() - new Date(session!.createdAt).getTime()).toBe(capMs);

      // A real refresh rotates the tokens but keeps the ceiling. Before #914 it
      // reset refreshExpiresAt to now + 7 days on every call.
      const setCookie = relaxedLogin.headers()['set-cookie'] || '';
      const refreshCookie = /refresh_token=[^;]+/.exec(setCookie)?.[0];
      expect(refreshCookie, 'login must set the refresh cookie').toBeTruthy();
      const refreshed = await request.post(`${apiBaseURL}/api/auth/refresh`, { headers: { Cookie: refreshCookie! } });
      expect(refreshed.ok(), await refreshed.text()).toBeTruthy();
      const rotated = await findLatestSession(userID);
      expect(rotated!.sessionID).toBe(session!.sessionID);
      expect(rotated!.tokenHash).not.toBe(session!.tokenHash);
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
    const password = 'Fixture@123456';
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
    const password = 'Fixture@123456';
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
});
