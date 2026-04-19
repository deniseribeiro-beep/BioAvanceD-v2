import { test, expect } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken, mockAuthVerifyKeepalive } from './support/auth';
import { mockPatientsApi } from './support/api-mocks';

test('Tela de pacientes: Editar e Enviar Link TCLE funcionam', async ({ page, context }) => {
  const patients = [{
    patientID: '12345678',
    consentStatus: 'PENDING',
    status: 'PENDING',
    patientName: 'Paciente QA',
  }] as Array<{ patientID: string; consentStatus: string; status: string; patientName: string }>;

  const auth = createAdminAuthContext();

  await injectSessionToken(page, auth.token);

  await context.addCookies([
    {
      name: 'session',
      value: 'mocked-jwt-token-admin',
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  await mockAuthVerifyKeepalive(page, auth.user);
  await mockPatientsApi(page, patients);

  await page.goto('/patients', { waitUntil: 'networkidle' });

  await expect(page.getByTestId('patient-row-12345678')).toBeVisible({ timeout: 10000 });

  // Test: Enviar Link TCLE (apenas resend, sem redirecionamento)
  const sendTcleLinkBtn = page.getByTestId('send-tcle-link-button-12345678');
  await expect(sendTcleLinkBtn).toBeVisible();
  await sendTcleLinkBtn.click();
  // Após clique, continua na página de pacientes (apenas resend a notificação)
  await expect(page).toHaveURL(/\/patients/);

  // Test: Editar dados demográficos
  await page.goto('/patients', { waitUntil: 'networkidle' });
  const editPatientBtn = page.getByTestId('edit-patient-button-12345678');
  await expect(editPatientBtn).toBeVisible();
  await editPatientBtn.click();
  // Redireciona para a página do wizard de intake
  await expect(page).toHaveURL(/\/next\/intake/);
});
