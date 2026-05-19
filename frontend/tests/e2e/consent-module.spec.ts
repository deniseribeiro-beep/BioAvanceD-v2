import { test, expect } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken } from './support/auth';

const API_BASE = 'http://localhost:3000/api';

test.describe('E2E - Consentimento/TCLE', () => {
  async function ensureConsentPageLoaded(page: any) {
    await page.goto('/patients/12345678/consent');

    if (page.url().includes('/login')) {
      await page.getByTestId('login-username-input').fill('admin');
      await page.getByTestId('login-password-input').fill('Admin@123');
      await page.getByTestId('login-submit-button').click();
      await page.goto('/patients/12345678/consent');
    }

    await page.waitForLoadState('domcontentloaded');
  }

  test.beforeEach(async ({ page }) => {
    const auth = createAdminAuthContext();
    await injectSessionToken(page, auth.token);

    await page.addInitScript(() => {
      window.localStorage.setItem('api_port', '3000');
      window.sessionStorage.setItem('lastLoginTime', '0');
    });
  });

  test('deve renderizar a página de consentimento e permitir reenviar link', async ({ page }) => {
    let resendCalled = false;

    await page.route('http://localhost:3000/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const method = route.request().method();

      if (path.endsWith('/api/auth/verify') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              user: {
                id: 'e2e-user-1',
                userID: 'e2e-user-1',
                name: 'E2E Admin',
                username: 'e2e-admin',
                email: 'e2e@example.com',
                accessType: 4,
                roleName: 'Administrador',
              },
              valid: true,
            },
          }),
        });
        return;
      }

      if (path.endsWith('/api/patients/12345678') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              _id: 'pat-001',
              patientID: '12345678',
              patientName: 'Paciente E2E',
            },
          }),
        });
        return;
      }

      if (path.endsWith('/api/e-consent/consent-templates/current') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              _id: 'tmpl-001',
              title: 'TCLE Padrão',
              content: '<p>Termo de consentimento para testes E2E.</p>',
              htmlContent: '<p>Termo de consentimento para testes E2E.</p>',
              permissions: [
                {
                  key: 'consent_terms',
                  label: 'Concordo com os termos gerais',
                  required: true,
                },
              ],
            },
          }),
        });
        return;
      }

      if (path.endsWith('/api/patients/12345678/consent/resend') && method === 'POST') {
        resendCalled = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      });
    });

    await ensureConsentPageLoaded(page);

    await expect(page.getByTestId('consent-page')).toBeVisible();
    await expect(page.getByTestId('consent-page-patient-id')).toContainText('12345678');
    await expect(page.getByTestId('consent-form')).toBeVisible();
    await expect(page.getByTestId('consent-form-content')).toBeVisible();

    await page.getByTestId('consent-page-resend-button').click();
    await expect.poll(() => resendCalled).toBe(true);
  });

  test('deve permitir preencher e confirmar consentimento', async ({ page }) => {
    let consentPayload: any = null;

    await page.route('http://localhost:3000/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const method = route.request().method();

      if (path.endsWith('/api/auth/verify') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              user: {
                id: 'e2e-user-1',
                userID: 'e2e-user-1',
                name: 'E2E Admin',
                username: 'e2e-admin',
                email: 'e2e@example.com',
                accessType: 4,
                roleName: 'Administrador',
              },
              valid: true,
            },
          }),
        });
        return;
      }

      if (path.endsWith('/api/patients/12345678') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              _id: 'pat-001',
              patientID: '12345678',
              patientName: 'Paciente E2E',
            },
          }),
        });
        return;
      }

      if (path.endsWith('/api/e-consent/consent-templates/current') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              _id: 'tmpl-001',
              title: 'TCLE Padrão',
              content: '<p>Termo de consentimento para testes E2E.</p>',
              htmlContent: '<p>Termo de consentimento para testes E2E.</p>',
              permissions: [
                {
                  key: 'consent_terms',
                  label: 'Concordo com os termos gerais',
                  required: true,
                },
              ],
            },
          }),
        });
        return;
      }

      if (path.endsWith('/api/e-consent/consents') && method === 'POST') {
        consentPayload = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { _id: 'consent-001' } }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      });
    });

    await ensureConsentPageLoaded(page);

    await expect(page.getByTestId('consent-submit-button')).toBeDisabled();

    await page.getByTestId('consent-caae-input').fill('83746219.8.0000.5432');
    await page.getByTestId('consent-permission-consent_terms').check();

    await page.getByTestId('consent-signature-e2e-bypass-button').click();
    await expect(page.getByTestId('consent-signature-success')).toBeVisible();
    await expect(page.getByTestId('consent-submit-button')).toBeEnabled();

    await page.getByTestId('consent-submit-button').click();
    await expect.poll(() => Boolean(consentPayload)).toBe(true);

    expect(consentPayload.patientId).toBe('12345678');
    expect(consentPayload.templateId).toBe('tmpl-001');
    expect(consentPayload.responses.consent_terms).toBe(true);
    expect(typeof consentPayload.signatureImageBase64).toBe('string');
  });

  test('TCLE Builder PDF de teste usa placeholders genericos sem dados de paciente', async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {};
    });

    await page.route('http://localhost:3000/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const method = route.request().method();

      if (path.endsWith('/api/auth/verify') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              user: {
                id: 'e2e-user-1',
                userID: 'e2e-user-1',
                name: 'E2E Admin',
                username: 'e2e-admin',
                email: 'e2e@example.com',
                accessType: 4,
                roleName: 'Administrador',
              },
              valid: true,
            },
          }),
        });
        return;
      }

      if (path.endsWith('/api/e-consent/consent-templates') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                _id: 'tmpl-preview-001',
                title: 'TCLE Preview',
                version: 'v1',
                caae: '11111111.1.1111.1111',
                active: true,
                validFrom: '2026-01-01T12:00:00.000Z',
                createdAt: '2026-01-01T12:00:00.000Z',
                htmlContent: '<p>Texto configurado no builder para impressão.</p>',
                granularPermissions: [
                  { key: 'consent_research', label: 'Aceito uso em pesquisa', required: true },
                ],
              },
            ],
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      });
    });

    await page.goto('/admin/tcle/new');
    await page.getByRole('tab', { name: /Histórico/i }).click();
    await page.getByRole('button', { name: /^PDF$/ }).click();

    let pdfFrame = page.frames().find((frame) => frame.url().startsWith('blob:')) || null;
    await expect.poll(() => {
      pdfFrame = page.frames().find((frame) => frame.url().startsWith('blob:')) || null;
      return Boolean(pdfFrame);
    }).toBe(true);
    const pdfText = await pdfFrame!.locator('body').innerText();

    expect(pdfText).toContain('Texto configurado no builder para impressão.');
    expect(pdfText).toContain('Nome do participante: ______________________');
    expect(pdfText).toContain('CPF/Documento: ______________________');
    expect(pdfText).toContain('Data: ____/____/______');
    expect(pdfText).toContain('Assinatura do participante: ______________________');
    expect(pdfText).toContain('Assinatura do pesquisador/responsável: ______________________');
    expect(pdfText).not.toContain('João Carlos da Silva');
    expect(pdfText).not.toContain('PAC-00012345');
    expect(pdfText).not.toContain('SAM-00067890');
  });

  test('Histórico TCLE exibe validade ou texto claro quando ausente', async ({ page }) => {
    await page.route('http://localhost:3000/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const method = route.request().method();

      if (path.endsWith('/api/auth/verify') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              user: {
                id: 'e2e-user-1',
                userID: 'e2e-user-1',
                name: 'E2E Admin',
                username: 'e2e-admin',
                email: 'e2e@example.com',
                accessType: 4,
                roleName: 'Administrador',
              },
              valid: true,
            },
          }),
        });
        return;
      }

      if (path.endsWith('/api/e-consent/consent-templates') && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: [
              {
                _id: 'tmpl-valid-until',
                title: 'TCLE com validade',
                version: 'v2',
                caae: '11111111.1.1111.1111',
                active: true,
                validFrom: '2026-01-01T12:00:00.000Z',
                validUntil: '2026-12-31T23:59:59.999Z',
                createdAt: '2026-01-02T12:00:00.000Z',
                htmlContent: '<p>Texto do TCLE com validade.</p>',
                granularPermissions: [],
              },
              {
                _id: 'tmpl-no-validity',
                title: 'TCLE sem validade',
                version: 'v1',
                caae: '22222222.2.2222.2222',
                active: false,
                validFrom: '2026-01-01T12:00:00.000Z',
                createdAt: '2026-01-01T12:00:00.000Z',
                htmlContent: '<p>Texto do TCLE sem validade.</p>',
                granularPermissions: [],
              },
            ],
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      });
    });

    await page.goto('/admin/tcle/new');
    await page.getByRole('tab', { name: /Histórico/i }).click();

    await expect(page.getByRole('columnheader', { name: 'Validity Date' })).toBeVisible();
    await expect(page.getByRole('row', { name: /TCLE com validade|v2/i })).toContainText('31/12/2026');
    await expect(page.getByRole('row', { name: /TCLE sem validade|v1/i })).toContainText('Sem validade definida');
  });
});
