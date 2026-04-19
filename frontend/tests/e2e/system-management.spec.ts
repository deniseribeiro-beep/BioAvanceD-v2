import { test, expect, Page, Route } from '@playwright/test';

function createMockJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('E2E - System Management and User Security', () => {
  let capturedRegisterPayload: any = null;
  let capturedResetMfaRequests = 0;
  let capturedDisableMfaRequests = 0;

  async function setupAuthenticatedPage(page: Page) {
    const token = createMockJwt({
      id: '507f1f77bcf86cd799439011',
      userID: '507f1f77bcf86cd799439011',
      accessType: 4,
      roleName: 'Administrador',
      name: 'QA Admin',
      username: 'admin',
      email: 'admin@bioavanced.com.br',
    });

    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.route('http://localhost:3000/api/**', async (route: Route) => {
      const request = route.request();
      const url = request.url();
      const method = request.method();

      if (url.includes('/api/auth/login') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              token,
              user: {
                id: '507f1f77bcf86cd799439011',
                userID: '507f1f77bcf86cd799439011',
                accessType: 4,
                roleName: 'Administrador',
                name: 'QA Admin',
                username: 'admin',
                email: 'admin@bioavanced.com.br',
              },
            },
          }),
        });
        return;
      }

      if (url.includes('/api/auth/verify') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              user: {
                id: '507f1f77bcf86cd799439011',
                userID: '507f1f77bcf86cd799439011',
                accessType: 4,
                roleName: 'Administrador',
                name: 'QA Admin',
                username: 'admin',
                email: 'admin@bioavanced.com.br',
              },
              valid: true,
            },
          }),
        });
        return;
      }

      if (url.includes('/api/users') && method === 'GET' && !url.includes('/validate-status')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                _id: 'admin-1',
                id: 'admin-1',
                name: 'Administrador',
                email: 'admin@bioavanced.com.br',
                institution: '-',
                username: 'admin',
                roleName: 'Administrador',
                accessType: 4,
                status: 'Ativo',
                mfaEnabled: true,
              },
              {
                _id: 'tech-1',
                id: 'tech-1',
                name: 'Técnico QA',
                email: 'tech@example.com',
                institution: 'Lab QA',
                username: 'techqa',
                roleName: 'Técnico',
                accessType: 2,
                status: 'Ativo',
                mfaEnabled: true,
              },
            ],
          }),
        });
        return;
      }

      if (url.includes('/api/users/register') && method === 'POST') {
        capturedRegisterPayload = JSON.parse(request.postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              _id: 'user-created',
              ...capturedRegisterPayload,
            },
          }),
        });
        return;
      }

      if (url.match(/\/api\/users\/[^/]+\/reset-mfa$/) && method === 'POST') {
        capturedResetMfaRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'MFA resetado com sucesso' }),
        });
        return;
      }

      if (url.match(/\/api\/users\/[^/]+\/disable-mfa$/) && method === 'POST') {
        capturedDisableMfaRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'MFA desativado com sucesso' }),
        });
        return;
      }

      if (url.includes('/api/user/security/status') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { securityScore: 90, overallLevel: 'strong', alternativeMethodsCount: 2 } }),
        });
        return;
      }

      if (url.includes('/api/user/security/mfa') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { primaryEnabled: true, recoveryCodes: { remaining: 5 } } }),
        });
        return;
      }

      if (url.includes('/api/user/security/password') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { strength: 'strong', strengthScore: 4, lastChanged: new Date().toISOString() } }),
        });
        return;
      }

      if (url.includes('/api/auth/sessions') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                id: 'session-current',
                deviceName: 'Desktop QA',
                browser: 'Chrome',
                os: 'Windows',
                location: '127.0.0.1',
                lastAccess: new Date().toISOString(),
                isCurrent: true,
              },
              {
                id: 'session-2',
                deviceName: 'Laptop QA',
                browser: 'Firefox',
                os: 'Windows',
                location: '192.168.0.10',
                lastAccess: new Date().toISOString(),
                isCurrent: false,
              },
            ],
          }),
        });
        return;
      }

      if (url.includes('/api/user/security/activities') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        });
        return;
      }

      if (url.includes('/api/user/security/recovery-codes') && method === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { codes: ['CODE-1', 'CODE-2', 'CODE-3'], remaining: 3 } }),
        });
        return;
      }

      if (url.includes('/api/user/security/password-reset/request') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'Reset solicitado' }),
        });
        return;
      }

      if (url.includes('/api/user/security/password') && method === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'Senha alterada' }),
        });
        return;
      }

      if (url.includes('/api/auth/sessions/all-others') && method === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'Sessões revogadas' }),
        });
        return;
      }

      if (url.includes('/api/auth/sessions/') && method === 'DELETE') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, message: 'Sessão revogada' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      });
    });

    await page.goto('/login');
    await page.locator('[data-testid="login-username-input"]').fill('admin');
    await page.locator('[data-testid="login-password-input"]').fill('Senha@123');
    const loginRequest = page.waitForRequest((request) =>
      request.method() === 'POST' && request.url().includes('/api/auth/login')
    );
    await page.locator('[data-testid="login-submit-button"]').click();
    await loginRequest;
    await page.waitForURL(/\/(system-management|patients|results|next\/intake|$)/, { timeout: 10000 }).catch(() => null);

    if (!page.url().includes('/system-management')) {
      await page.goto('/system-management');
    }

    await expect(page).toHaveURL(/\/system-management/);
  }

  test.beforeEach(() => {
    capturedRegisterPayload = null;
    capturedResetMfaRequests = 0;
    capturedDisableMfaRequests = 0;
  });

  test('deve exibir a grade de usuários e ações de MFA', async ({ page }) => {
    await setupAuthenticatedPage(page);

    await expect(page.locator('[data-testid="system-management-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="users-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="reset-mfa-button-tech-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="disable-mfa-button-admin-1"]')).toBeVisible();
  });

  test('deve registrar novo usuário com payload normalizado', async ({ page }) => {
    await setupAuthenticatedPage(page);

    await page.locator('[data-testid="new-user-button"]').click();
    await page.waitForURL(/\/users\/new/, { waitUntil: 'commit' });
    await expect(page.locator('[data-testid="new-user-form"]')).toBeVisible();

    await page.locator('[data-testid="new-user-name-input"]').fill('Novo Usuário');
    await page.locator('[data-testid="new-user-email-input"]').fill('novo@example.com');
    await page.locator('[data-testid="new-user-phone-input"]').fill('(11) 99876-5432');
    await page.locator('[data-testid="new-user-institution-input"]').fill('Hospital QA');
    await page.locator('[data-testid="new-user-username-input"]').fill('novouser');
    await page.locator('[data-testid="new-user-password-input"]').fill('Senha@123');
    await page.locator('[data-testid="new-user-role-select"]').selectOption('Coordenador');
    await page.locator('[data-testid="new-user-status-select"]').selectOption('Ativo');

    await page.locator('[data-testid="new-user-submit-button"]').click();

    await expect.poll(() => capturedRegisterPayload).not.toBeNull();
    expect(capturedRegisterPayload.phone).toBe('11998765432');
    expect(capturedRegisterPayload.status).toBe('Ativo');
    expect(capturedRegisterPayload.username).toBe('novouser');
  });

  test('deve usar a página de segurança do usuário para gerar códigos e gerenciar sessões', async ({ page }) => {
    await setupAuthenticatedPage(page);

    await page.locator('a[href="/user/security"]').click();
    await page.waitForURL(/\/user\/security/, { waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/user\/security/);

    await expect(page.locator('[data-testid="security-page-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="sessions-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="sessions-list"]')).toBeVisible();

    await page.locator('[data-testid="generate-recovery-codes-button"]').click();
    await expect(page.locator('[data-testid="close-recovery-codes-button"]')).toBeVisible();
    await expect(page.getByText('CODE-1')).toBeVisible();

    const revokeSessionButton = page.locator('[data-testid="revoke-session-button-1"]');
    await revokeSessionButton.scrollIntoViewIfNeeded();
    await revokeSessionButton.dispatchEvent('click');
    await expect(page.locator('[data-testid="security-confirm-proceed-button"]')).toBeVisible();
    await page.locator('[data-testid="security-confirm-proceed-button"]').click();
  });

  test('deve chamar reset e disable MFA na grade de usuários', async ({ page }) => {
    await setupAuthenticatedPage(page);

    await expect(page.locator('[data-testid="system-management-page"]')).toBeVisible();

    const dialogHandler = async (dialog: any) => {
      await dialog.accept();
    };
    page.on('dialog', dialogHandler);

    const resetRequestPromise = page.waitForRequest((request) =>
      request.method() === 'POST' && /\/api\/users\/[^/]+\/reset-mfa$/.test(request.url())
    );
    await page.locator('[data-testid="reset-mfa-button-tech-1"]').click();
    await resetRequestPromise;

    const disableRequestPromise = page.waitForRequest((request) =>
      request.method() === 'POST' && /\/api\/users\/[^/]+\/disable-mfa$/.test(request.url())
    );
    await page.locator('[data-testid="disable-mfa-button-admin-1"]').click();
    await disableRequestPromise;

    page.off('dialog', dialogHandler);
  });
});
