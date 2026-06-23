import { test, expect, Page, Route } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken } from './support/auth';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('E2E - Patients and Biomarker Observations', () => {
  let resendConsentCalls = 0;
  let findForEditCalls = 0;
  let fhirStageCalls = 0;
  let fhirCommitCalls = 0;
  let definitivePatientCreateCalls = 0;
  let definitiveSampleCreateCalls = 0;

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

      if (url.match(/\/api\/patients(?:\?.*)?$/) && method === 'POST') {
        definitivePatientCreateCalls += 1;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'POST definitivo não deve ser chamado no staging FHIR' }),
        });
        return;
      }

      if (url.match(/\/api\/samples(?:\?.*)?$/) && method === 'POST') {
        definitiveSampleCreateCalls += 1;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'POST definitivo não deve ser chamado no staging FHIR' }),
        });
        return;
      }

      if (url.includes('/api/import/fhir/stage') && method === 'POST') {
        fhirStageCalls += 1;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            batch: { _id: 'batch-fhir-ui', counts: { valid: 1, errors: 1, pendingConsent: 0, readyToCommit: 0 } },
            records: [
              {
                _id: 'record-valid',
                rowNumber: 1,
                status: 'VALID',
                normalized: { patientName: 'Paciente FHIR', patientID: 'P-001', patientEmail: 'fhir@example.org', sampleID: 'S-001' },
                warnings: [{ field: 'consent', message: 'TCLE ainda não enviado para assinatura.' }],
              },
              {
                _id: 'record-email',
                rowNumber: 2,
                status: 'NEEDS_EMAIL',
                normalized: { patientName: 'Paciente Sem Email', patientID: 'P-002', sampleID: 'S-002' },
                validationErrors: [{ field: 'patientEmail', message: 'E-mail válido é obrigatório para envio do TCLE.' }],
              },
            ],
          }),
        });
        return;
      }

      if (url.includes('/api/import/fhir/batches/batch-fhir-ui/send-consents') && method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            batch: { _id: 'batch-fhir-ui', counts: { valid: 0, errors: 1, pendingConsent: 1, readyToCommit: 0 } },
            consentResults: [
              { recordId: 'record-valid', sent: true, status: 'PENDING_CONSENT' },
              { recordId: 'record-email', sent: false, status: 'NEEDS_EMAIL' },
            ],
            records: [
              {
                _id: 'record-valid',
                rowNumber: 1,
                status: 'PENDING_CONSENT',
                normalized: { patientName: 'Paciente FHIR', patientID: 'P-001', patientEmail: 'fhir@example.org', sampleID: 'S-001' },
                warnings: [{ field: 'consent', message: 'TCLE enviado e aguardando assinatura.' }],
              },
              {
                _id: 'record-email',
                rowNumber: 2,
                status: 'NEEDS_EMAIL',
                normalized: { patientName: 'Paciente Sem Email', patientID: 'P-002', sampleID: 'S-002' },
                validationErrors: [{ field: 'patientEmail', message: 'E-mail válido é obrigatório para envio do TCLE.' }],
              },
            ],
          }),
        });
        return;
      }

      if (url.includes('/api/import/fhir/batches/batch-fhir-ui/commit') && method === 'POST') {
        fhirCommitCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            committed: 2,
            records: [
              {
                _id: 'record-valid',
                rowNumber: 1,
                status: 'COMMITTED',
                consentStatus: 'PENDING',
                quarantineStatus: 'QUARANTINED',
                availabilityStatus: 'BLOCKED',
                workflowStatus: 'QUARANTINED',
                normalized: { patientName: 'Paciente FHIR', patientID: 'P-001', patientEmail: 'fhir@example.org', sampleID: 'S-001' },
                consentTracking: { sentAt: new Date().toISOString() },
              },
              {
                _id: 'record-email',
                rowNumber: 2,
                status: 'COMMITTED',
                consentStatus: 'NOT_REQUIRED',
                quarantineStatus: 'QUARANTINED',
                availabilityStatus: 'BLOCKED',
                workflowStatus: 'NEEDS_REVIEW',
                normalized: { patientName: 'Paciente Sem Email', patientID: 'P-002', sampleID: 'S-002' },
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
    fhirStageCalls = 0;
    fhirCommitCalls = 0;
    definitivePatientCreateCalls = 0;
    definitiveSampleCreateCalls = 0;
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

  test('FHIR Import exibe fluxo guiado com staging, TCLE e commit bloqueado sem assinatura', async ({ page }) => {
    await setupAuthenticatedPatientsPage(page);

    const bundle = {
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Patient', id: 'P-001', name: [{ text: 'Paciente FHIR' }], telecom: [{ system: 'email', value: 'fhir@example.org' }] } },
        { resource: { resourceType: 'Specimen', id: 'S-001', subject: { reference: 'Patient/P-001' }, type: { text: 'SANGUE' } } },
      ],
    };

    await page.locator('[data-testid="patients-import-fhir-button"]').click();
    await expect(page).toHaveURL(/\/patients\/import-fhir/);
    await expect(page.getByTestId('fhir-import-page')).toBeVisible();
    await expect(page.getByText('Etapa 1 — Preparar arquivo')).toBeVisible();
    await expect(page.getByText('Baixar modelo Excel')).toBeVisible();
    await expect(page.getByText('Converter Excel para JSON FHIR')).toBeVisible();
    await expect(page.getByTestId('fhir-import-validate-button')).toContainText('Validar lote');
    await expect(page.getByTestId('fhir-import-save-quarantine-button')).toContainText('Salvar em quarentena e enviar TCLEs');

    await page.getByTestId('fhir-import-json-input').setInputFiles({
      name: 'bundle.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bundle)),
    });
    await expect(page.getByTestId('fhir-import-patient-count')).toContainText('1');
    await expect(page.getByTestId('fhir-import-specimen-count')).toContainText('1');

    await page.getByTestId('fhir-import-validate-button').click();
    await expect.poll(() => fhirStageCalls).toBe(1);
    await expect.poll(() => definitivePatientCreateCalls).toBe(0);
    await expect.poll(() => definitiveSampleCreateCalls).toBe(0);
    await expect(page.getByTestId('fhir-import-staging-table')).toContainText('PENDING_CONSENT');
    await expect(page.getByTestId('fhir-import-staging-table')).toContainText('NEEDS_REVIEW');
    await expect(page.getByTestId('fhir-import-validation-summary')).toContainText('Total');
    await expect(page.getByTestId('fhir-import-validation-summary')).toContainText('Válidos');
    await expect(page.getByTestId('fhir-import-save-quarantine-button')).toBeVisible();
    await expect(page.getByTestId('fhir-import-save-quarantine-button')).toBeEnabled();

    await page.getByTestId('fhir-import-save-quarantine-button').click();
    await expect.poll(() => fhirCommitCalls).toBe(1);
    await expect(page.getByTestId('fhir-import-status-table')).toContainText('QUARANTINED');
    await expect(page.getByTestId('fhir-import-status-table')).toContainText('TCLE_SENT');
    await expect(page.getByTestId('fhir-import-status-table')).toContainText('NEEDS_REVIEW');
    await expect(page.getByTestId('fhir-import-status-table')).toContainText('BLOCKED');
  });
});
