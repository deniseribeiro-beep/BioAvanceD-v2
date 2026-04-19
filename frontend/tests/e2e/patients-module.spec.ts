import { test, expect, Page, Route } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken } from './support/auth';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('E2E - Patients and Biomarker Observations', () => {
  let resendConsentCalls = 0;
  let findForEditCalls = 0;

  async function setupAuthenticatedPatientsPage(page: Page) {
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

      if (url.includes('/api/auth/login') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              token: auth.token,
              user: {
                ...auth.user,
              },
            },
          }),
        });
        return;
      }

      if (url.includes('/api/patients/search') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              patients: [
                {
                  patientID: '12345678',
                  patientName: 'Paciente QA',
                  consentStatus: 'PENDING',
                  status: 'PENDING_CONSENT',
                },
              ],
              total: 1,
            },
          }),
        });
        return;
      }

      if (url.match(/\/api\/patients(?:\?.*)?$/) && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              patients: [
                {
                  patientID: '12345678',
                  patientName: 'Paciente QA',
                  consentStatus: 'PENDING',
                  status: 'PENDING_CONSENT',
                },
              ],
              total: 1,
            },
          }),
        });
        return;
      }

      if (url.includes('/api/patients/find-for-edit') && method === 'POST') {
        findForEditCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              patientID: '12345678',
              patientName: 'Paciente QA',
              sex: 'F',
              birthDate: '1990-01-01',
            },
          }),
        });
        return;
      }

      if (url.includes('/api/patients/12345678/consent/resend') && method === 'POST') {
        resendConsentCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Notificações reenviadas',
          }),
        });
        return;
      }

      if (url.includes('/api/patients/12345678') && method === 'DELETE') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      });
    });

    await page.goto('/patients');

    if (page.url().includes('/login')) {
      await page.locator('[data-testid="login-username-input"]').fill('admin');
      await page.locator('[data-testid="login-password-input"]').fill('Senha@123');
      await page.locator('[data-testid="login-submit-button"]').click();
      await page.goto('/patients');
    }

    await expect(page.locator('[data-testid="patients-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="patients-table"]')).toBeVisible();
  }

  test.beforeEach(() => {
    resendConsentCalls = 0;
    findForEditCalls = 0;
  });

  test('deve listar pacientes e buscar por termo sem quebrar i18n', async ({ page }) => {
    await setupAuthenticatedPatientsPage(page);

    await expect(page.locator('[data-testid="patient-row-12345678"]')).toBeVisible();

    await page.locator('[data-testid="patients-search-input"]').fill('Paciente QA');
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-testid="patient-row-12345678"]')).toBeVisible();
  });

  test('deve reenviar notificação de consentimento e abrir edição do paciente', async ({ page }) => {
    await setupAuthenticatedPatientsPage(page);

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.locator('[data-testid="send-tcle-link-button-12345678"]').click();
    await expect.poll(() => resendConsentCalls).toBe(1);

    await page.locator('[data-testid="edit-patient-button-12345678"]').click();
    await expect.poll(() => findForEditCalls).toBe(1);
    await expect(page).toHaveURL(/\/next\/intake/);
  });
});
