import { test, expect, type Page, type Route } from '@playwright/test';

function sessionPayload() {
  return [
    {
      id: 'session-1',
      deviceName: 'Desktop Principal',
      browser: 'Chrome',
      os: 'Windows',
      location: 'Sao Paulo',
      ipAddress: '192.168.1.10',
      lastAccess: new Date().toISOString(),
      isCurrent: true,
    },
    {
      id: 'session-2',
      deviceName: 'Notebook QA',
      browser: 'Firefox',
      os: 'macOS',
      location: 'Remote',
      ipAddress: '192.168.1.11',
      lastAccess: new Date(Date.now() - 3600 * 1000).toISOString(),
      isCurrent: false,
    },
  ];
}

async function mockSecurityApis(page: Page) {
  let sessions = sessionPayload();

  await page.route('**/api/**', async (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/auth/verify')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            valid: true,
            user: {
              id: 1,
              userID: '1',
              username: 'qa-admin',
              name: 'QA Admin',
              accessType: 4,
              roleName: 'Administrador',
            },
          },
        }),
      });
    }

    if (url.includes('/auth/keepalive')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { valid: true } }),
      });
    }

    if (url.includes('/user/security/status')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            securityScore: 82,
            overallLevel: 'strong',
            alternativeMethodsCount: 2,
          },
        }),
      });
    }

    if (url.includes('/user/security/mfa')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            primaryEnabled: true,
            primarySetupDate: new Date().toISOString(),
            recoveryCodes: { remaining: 5 },
          },
        }),
      });
    }

    if (url.includes('/user/security/password')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            lastChanged: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 15 * 86400000).toISOString(),
            strength: 'strong',
            strengthScore: 5,
          },
        }),
      });
    }

    if (url.includes('/auth/sessions') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: sessions }),
      });
    }

    if (url.includes('/auth/sessions/all-others') && method === 'DELETE') {
      sessions = sessions.filter((session) => session.isCurrent);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Sessoes revogadas' }),
      });
    }

    if (/\/auth\/sessions\/[^/]+/.test(url) && method === 'DELETE') {
      const sessionId = url.split('/').pop();
      sessions = sessions.filter((session) => session.id !== sessionId);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Sessao revogada com sucesso' }),
      });
    }

    return route.continue();
  });
}

test.describe('Security - Session Management and Revocation', () => {
  test.beforeEach(async ({ page }) => {
    await mockSecurityApis(page);
  });

  test('deve renderizar a tela de seguranca e listar sessoes', async ({ page }) => {
    await page.goto('/user/security', { waitUntil: 'networkidle' });

    await expect(page.getByTestId('security-page-title')).toBeVisible();
    await expect(page.getByTestId('sessions-list')).toBeVisible();
    await expect(page.getByTestId('session-item')).toHaveCount(2);
  });

  test('deve exibir detalhes de dispositivo e IP por sessao', async ({ page }) => {
    await page.goto('/user/security', { waitUntil: 'networkidle' });

    await expect(page.getByTestId('session-device-name-0')).toContainText(/Desktop/i);
    await expect(page.getByTestId('session-device-details-0')).toContainText(/Chrome|Windows/i);
    await expect(page.getByTestId('session-device-details-0')).toContainText(/Sao Paulo|Remote/i);
  });

  test('deve revogar uma sessao nao atual', async ({ page }) => {
    await page.goto('/user/security', { waitUntil: 'networkidle' });

    await expect(page.getByTestId('session-item')).toHaveCount(2);

    const revokeButton = page.getByTestId('revoke-session-button-1');
    await expect(revokeButton).toBeVisible();
    await revokeButton.click();

    await page.getByTestId('security-confirm-proceed-button').click();

    await expect(page.getByTestId('session-item')).toHaveCount(1);
  });
});
