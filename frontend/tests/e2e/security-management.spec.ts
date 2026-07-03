import { test, expect, Page, Route } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken } from './support/auth';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('E2E - Security Management', () => {
  let capturedConfigPayload: any = null;
  let capturedPermissionsPayload: any = null;

  const baseConfig = {
    authentication: { requireMFA: true, mfaMethod: 'totp', allowPasswordReset: true, maxLoginAttempts: 5, lockoutDuration: 30, requireStrongPassword: true },
    passwordRules: { minLength: 8, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true, expirationDays: 90, preventReuse: true, maxReuseHistory: 5 },
    session: { timeoutMinutes: 30, maxSessionDuration: 12, allowMultipleSessions: false, autoRenewal: true, logExpiration: true },
    loginAttempts: { maxAttempts: 5, lockoutDuration: 30, trackIP: true, blockIPAfterAttempts: 10 },
    logging: { level: 'info', logLoginAttempts: true, logAllActions: true, retentionDays: 365 },
    privacy: { anonymizeLogs: true, dataRetentionDays: 365, autoPurge: false, purgeAfterDays: 730, anonymizeAfterDays: 90 },
    enhancedSecurity: { enabled: false, requireMFAForAll: true, strictPasswordPolicy: true, sessionTimeoutMinutes: 15, logAllActions: true, blockUnusualActivity: true },
    lgpd: { allowDataExport: true, allowDataDeletion: true, anonymizeOnExport: true, requireConsent: true, consentExpirationDays: 365 },
    metadata: { version: 1 },
  };

  const basePermissions = {
    '1': { viewReports: true },
    '2': { createSample: true, withdrawSample: true, viewTemperature: true, uploadFiles: true, viewReports: true },
    '3': { createUser: true, createPatient: true, createSample: true, withdrawSample: true, viewTemperature: true, uploadFiles: true, viewReports: true },
    '4': { createUser: true, createPatient: true, createSample: true, withdrawSample: true, viewTemperature: true, uploadFiles: true, viewReports: true, manageSystem: true, manageBackup: true, manageSecurity: true, resetMFA: true },
  };

  async function setupAuthenticatedPage(page: Page) {
    const auth = createAdminAuthContext();
    await injectSessionToken(page, auth.token);

    await page.route('http://localhost:3000/api/**', async (route: Route) => {
      const request = route.request();
      const url = request.url();
      const method = request.method();

      if (url.includes('/api/auth/verify') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              user: {
                ...auth.user,
              },
              valid: true,
            },
          }),
        });
        return;
      }

      if (url.includes('/api/security/config') && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: baseConfig }) });
        return;
      }

      if (url.includes('/api/security/config') && method === 'PUT') {
        capturedConfigPayload = JSON.parse(request.postData() || '{}');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...baseConfig, ...capturedConfigPayload } }) });
        return;
      }

      if (url.includes('/api/security/permissions') && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: basePermissions }) });
        return;
      }

      if (url.includes('/api/security/permissions') && method === 'PUT') {
        capturedPermissionsPayload = JSON.parse(request.postData() || '{}');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: capturedPermissionsPayload }) });
        return;
      }

      if (url.includes('/api/security/logs/export') && method === 'GET') {
        const parsed = new URL(url);
        const format = parsed.searchParams.get('format') || 'csv';

        if (format === 'csv') {
          await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: 'timestamp,userID,action\n2026-01-01,admin,EXPORT' });
          return;
        }

        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ timestamp: '2026-01-01', action: 'EXPORT' }]) });
        return;
      }

      if (url.includes('/api/security/consent-queue') && method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { waiting: 1, active: 0 } }) });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
    });

    await page.goto('/system-management?tab=security');
    await page.waitForURL(/\/system-management(?:\?.*)?/, { timeout: 10000 });
    await expect(page.locator('[data-testid="security-page"]')).toBeVisible();
  }

  test.beforeEach(() => {
    capturedConfigPayload = null;
    capturedPermissionsPayload = null;
  });

  test('deve atualizar configuração de autenticação', async ({ page }) => {
    await setupAuthenticatedPage(page);

    await page.locator('[data-testid="security-nav-authentication"]').click();
    await page.locator('[data-testid="security-require-mfa-toggle"]').click();

    const updateRequest = page.waitForRequest((request) =>
      request.method() === 'PUT' && request.url().includes('/api/security/config')
    );

    await page.locator('[data-testid="security-save-config-button"]').click();
    await updateRequest;

    await expect.poll(() => capturedConfigPayload).not.toBeNull();
    expect(capturedConfigPayload.authentication.requireMFA).toBe(false);
  });

  test('deve exportar logs em CSV e JSON com filtros', async ({ page }) => {
    await setupAuthenticatedPage(page);

    await page.locator('[data-testid="security-nav-logging"]').click();
    await page.locator('[data-testid="security-log-filter-severity"]').selectOption('warning');
    await page.locator('[data-testid="security-log-filter-module"]').fill('Segurança');

    const csvRequest = page.waitForRequest((request) =>
      request.method() === 'GET' && request.url().includes('/api/security/logs/export') && request.url().includes('format=csv')
    );
    await page.locator('[data-testid="security-export-logs-csv-button"]').click();
    await csvRequest;

    const jsonRequest = page.waitForRequest((request) =>
      request.method() === 'GET' && request.url().includes('/api/security/logs/export') && request.url().includes('format=json')
    );
    await page.locator('[data-testid="security-export-logs-json-button"]').click();
    await jsonRequest;
  });

  test('deve atualizar permissões por perfil', async ({ page }) => {
    await setupAuthenticatedPage(page);

    await page.locator('[data-testid="security-nav-permissions"]').click();
    const manageSecurityToggle = page.locator('[data-testid="security-permission-toggle-4-manageSecurity"]');
    await manageSecurityToggle.scrollIntoViewIfNeeded();
    await manageSecurityToggle.click();

    const savePermissionsButton = page.locator('[data-testid="security-save-permissions-button"]');
    await savePermissionsButton.scrollIntoViewIfNeeded();

    await savePermissionsButton.dispatchEvent('click');

    await expect.poll(() => capturedPermissionsPayload).not.toBeNull();
    expect(capturedPermissionsPayload['4'].manageSecurity).toBe(false);
  });
});
