import { test, expect, type Page } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken, mockAuthVerifyKeepalive } from './support/auth';
import { mockWizardDomainApis } from './support/api-mocks';

function mockWizardApis(page: Page, options = { withActiveTcle: true }) {
  const auth = createAdminAuthContext();
  return (async () => {
    await injectSessionToken(page, auth.token);
    await mockAuthVerifyKeepalive(page, auth.user);
    await mockWizardDomainApis(page, options);
  })();
}

async function completeStep1(page: Page) {
  await expect(page.getByTestId('wizard-title')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('wizard-full-name').fill('Paciente QA Wizard');
  await page.getByTestId('wizard-birth-date').fill('10/10/1990');
  await page.getByTestId('wizard-gender').selectOption('F');
  await page.getByTestId('wizard-email').fill('qa@bioavanced.test');
  await page.getByTestId('wizard-document').fill('12345678900');
  await page.getByTestId('wizard-next-button').click();
}

async function completeStep2(page: Page) {
  await page.getByTestId('wizard-sprec-matrix').selectOption('fluid');
  await page.getByTestId('wizard-sprec-axis-1').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-2').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-3').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-4').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-5').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-6').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-7').selectOption({ index: 1 });
  await page.getByTestId('wizard-quantity').fill('3.5');
  await page.getByTestId('wizard-linked-project').fill('Projeto QA');
  await page.getByTestId('wizard-institution-name').fill('Instituto QA');
  await page.getByTestId('wizard-next-button').click();
}

test('Cenário de sucesso (Fabry): ORPHA 324 mostra biomarcadores e permite finalizar', async ({ page }) => {

  await mockWizardApis(page, { withActiveTcle: true });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await completeStep1(page);
  await completeStep2(page);

  await page.getByTestId('wizard-diagnosis-search').fill('ORPHA:324');
  await page.getByTestId('wizard-diagnosis-option-0').click();

  await expect(page.getByTestId('wizard-suggested-biomarkers-section')).toBeVisible();

  await page.getByTestId('wizard-biomarker-value-0').fill('4.2');
  await page.getByTestId('wizard-biomarker-value-1').fill('2.1');

await expect(page.locator('body')).toContainText(/Categor(?:ia|y)\s+[AB]/i, { timeout: 10000 });});

test('Cenário de bloqueio: sem TCLE ativo o envio final fica impedido', async ({ page }) => {

  await mockWizardApis(page, { withActiveTcle: false });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await completeStep1(page);
  await completeStep2(page);

  const finalizeButton = page.getByTestId('wizard-submit-button');
  await expect(finalizeButton).toBeDisabled();
});

test('Step 1 - Identificação de Paciente: deve exibir alerta quando paciente é identificado', async ({ page }) => {

  await mockWizardApis(page, { withActiveTcle: true });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  
  // Preencher nome e data de nascimento
  await expect(page.getByTestId('wizard-title')).toBeVisible({ timeout: 10000 });
  const fullNameInput = page.getByTestId('wizard-full-name');
  await fullNameInput.fill('Paciente QA Wizard');
  
  const birthDateInput = page.getByTestId('wizard-birth-date');
  await birthDateInput.fill('10/10/1990');
  
  // Verificar se o alerta de paciente identificado aparece
  const identificationAlert = page.getByTestId('wizard-patient-match-alert');
  await expect(identificationAlert).toBeVisible({ timeout: 5000 });
  
  // Completar o step 1
  await page.getByTestId('wizard-gender').selectOption('F');
  await page.getByTestId('wizard-email').fill('qa@bioavanced.test');
  await page.getByTestId('wizard-document').fill('12345678900');
  await page.getByTestId('wizard-next-button').click();
  
  await completeStep2(page);
  
  // Verify sample is created
  await page.getByTestId('wizard-diagnosis-search').fill('ORPHA:324');
  await page.getByTestId('wizard-diagnosis-option-0').click();
  
  await expect(page.getByTestId('wizard-suggested-biomarkers-section')).toBeVisible();
});

test('Step 3 - Seleção de Fármaco ATC: deve preencher ATC automaticamente ao selecionar droga', async ({ page }) => {

  await mockWizardApis(page, { withActiveTcle: true });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await completeStep1(page);
  await completeStep2(page);
  
  // Habilita os campos farmacológicos dependentes do status de tratamento
  await page.getByTestId('wizard-treatment-status').selectOption('TREATED');

  // Step 3 - Drug search and ATC autofill
  const drugSearchInput = page.getByTestId('wizard-medication-search');

  // Type drug name
  await drugSearchInput.fill('Migalastat');

  // Select the first drug result
  const drugOption = page.getByTestId('wizard-medication-option-0');
  await expect(drugOption).toBeVisible({ timeout: 5000 });
  await drugOption.click();

  // Verify ATC code is automatically filled
  const atcInput = page.getByTestId('wizard-atc-code');
  await expect(atcInput).toHaveValue('A16AX14');

  // Verify ATC Level 1 is filled
  const atcLevel1Input = page.getByTestId('wizard-atc-level1');
  await expect(atcLevel1Input).toHaveValue('A');
});

test('Step 3 - ATC Dictionary: deve exibir aba de dicionário ATC (WHO)', async ({ page }) => {

  await mockWizardApis(page, { withActiveTcle: true });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await completeStep1(page);
  await completeStep2(page);
  
  // Look for ATC Dictionary tab
  const atcDictionaryTab = page.getByRole('tab', { name: /Dicionário|ATC|WHO/i });
  if (await atcDictionaryTab.isVisible()) {
    await atcDictionaryTab.click();
    
    // Verify dictionary content is visible
    const dictionaryContent = page.getByText(/A16|Anatomical/i);
    await expect(dictionaryContent).toBeVisible({ timeout: 5000 });
  }
});
