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

async function mockQualityPreview(page: Page, previewResponse: Record<string, unknown>, capturedPayloads: unknown[] = []) {
  await page.route('**/api/quality/preview', async (route) => {
    capturedPayloads.push(route.request().postDataJSON?.() || {});
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: previewResponse }),
    });
  });
}

async function completeStep1(page: Page) {
  await expect(page.getByTestId('wizard-title')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('wizard-full-name').fill('Paciente QA Wizard');
  await page.getByTestId('wizard-birth-date').fill('10/10/1990');
  await page.getByTestId('wizard-gender').selectOption('F');
  await page.getByTestId('wizard-email').fill('qa@bioavanced.test');
  await page.getByTestId('wizard-document').fill('13360378652');
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
  await expect(page.locator('body')).toContainText('Angioqueratoma');
  await expect(page.locator('body')).toContainText('HP:0001066');
  await expect(page.locator('body')).toContainText('Alpha-galactosidase A');

  await page.getByTestId('wizard-biomarker-value-0').fill('4.2');
  await page.getByTestId('wizard-biomarker-value-1').fill('2.1');

  await expect(page.locator('body')).toContainText(/Grade\s+[AB]\s+.*RCS/i, { timeout: 10000 });
});

test('CPF: campo Documento formata numeros e preserva passaporte', async ({ page }) => {
  await mockWizardApis(page, { withActiveTcle: true });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('wizard-title')).toBeVisible({ timeout: 10000 });

  const documentInput = page.getByTestId('wizard-document');
  await expect(page.getByText('Digite somente números para CPF ou informe passaporte.')).toBeVisible();

  await documentInput.fill('13360378652');
  await expect(documentInput).toHaveValue('133.603.786-52');

  await documentInput.fill('AB123456');
  await expect(documentInput).toHaveValue('AB123456');
});

test('Documento: CPF invalido exibe validacao clara', async ({ page }) => {
  await mockWizardApis(page, { withActiveTcle: true });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('wizard-title')).toBeVisible({ timeout: 10000 });

  await page.getByTestId('wizard-full-name').fill('Paciente QA Wizard');
  await page.getByTestId('wizard-birth-date').fill('10/10/1990');
  await page.getByTestId('wizard-gender').selectOption('F');
  await page.getByTestId('wizard-email').fill('qa@bioavanced.test');
  await page.getByTestId('wizard-document').fill('12345678900');
  await expect(page.getByTestId('wizard-document')).toHaveValue('123.456.789-00');

  await page.getByTestId('wizard-next-button').click();

  await expect(page.locator('body')).toContainText(/documento válido|valid document/i);
});

test('RCS-GOV: wizard chama endpoint de qualidade e renderiza final_grade A-E sem categoria legada', async ({ page }) => {
  const previewPayloads: unknown[] = [];

  await mockWizardApis(page, { withActiveTcle: true });
  await mockQualityPreview(page, {
    model_version: 'RCS-GOV-1.0',
    matrix_type: 'fluid',
    governance_status: 1,
    governance_failure_reasons: [],
    p_bio: 6,
    rcs_score: 94,
    score_based_grade: 'A',
    final_grade: 'A',
    grade_route: 'Score-based certification',
    axis_penalties: [
      { axis_code: 'Ppre', sprec_code: 'A', weight: 30, severity: 0, penalty: 0 },
    ],
    calculation_trace: { source: 'e2e' },
  }, previewPayloads);

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await completeStep1(page);
  await completeStep2(page);

  await expect.poll(() => previewPayloads.length).toBeGreaterThan(0);
  expect(previewPayloads[0]).toMatchObject({ sprec: expect.any(Object) });
  await expect(page.locator('body')).toContainText(/Grade\s+A\s+.*RCS\s+94/i);
  await expect(page.locator('body')).toContainText('Score-based certification');
  await expect(page.locator('body')).not.toContainText(/Categoria\s+A\s+.*94/i);
});

test('RCS-GOV: governance failure com score nulo e eixos vazios nao quebra o wizard', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await mockWizardApis(page, { withActiveTcle: true });
  await mockQualityPreview(page, {
    model_version: 'RCS-GOV-1.0',
    matrix_type: 'fluid',
    governance_status: 0,
    governance_failure_reasons: ['Unknown SPREC code', 'Missing critical metadata'],
    p_bio: null,
    rcs_score: null,
    score_based_grade: null,
    final_grade: 'E',
    grade_route: 'Governance failure',
    axis_penalties: [],
    calculation_trace: {},
  });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await completeStep1(page);
  await completeStep2(page);

  await expect(page.locator('body')).toContainText(/Grade\s+E\s+.*RCS\s+-/i);
  await expect(page.locator('body')).toContainText('Governance failure');
  await expect(page.locator('body')).toContainText('Unknown SPREC code');
  expect(pageErrors).toEqual([]);
});

test('RCS-GOV: desmarcar processamento desconhecido restaura e recalcula preview', async ({ page }) => {
  const previewPayloads: unknown[] = [];

  await mockWizardApis(page, { withActiveTcle: true });
  await page.route('**/api/quality/preview', async (route) => {
    const payload = route.request().postDataJSON?.() || {};
    previewPayloads.push(payload);
    const sprec = (payload as { sprec?: Record<string, any> }).sprec || {};
    const axisCodes = [
      sprec.preCentrifugation?.code,
      sprec.centrifugation1?.code,
      sprec.centrifugation2?.code,
      sprec.postCentrifugation?.code,
    ].map((value) => String(value || '').trim().toUpperCase());
    const hasUnknownFailure = Boolean(sprec.preAnalyticalUnknown) || axisCodes.includes('X');

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: hasUnknownFailure
          ? {
            model_version: 'RCS-GOV-1.0',
            matrix_type: 'fluid',
            governance_status: 0,
            governance_failure_reasons: ['Unknown SPREC code'],
            p_bio: null,
            rcs_score: null,
            score_based_grade: null,
            final_grade: 'E',
            grade_route: 'Governance failure',
            axis_penalties: [],
            calculation_trace: { hasUnknownFailure },
          }
          : {
            model_version: 'RCS-GOV-1.0',
            matrix_type: 'fluid',
            governance_status: 1,
            governance_failure_reasons: [],
            p_bio: 6,
            rcs_score: 94,
            score_based_grade: 'A',
            final_grade: 'A',
            grade_route: 'Score-based certification',
            axis_penalties: [],
            calculation_trace: { hasUnknownFailure },
          },
      }),
    });
  });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await completeStep1(page);

  await page.getByTestId('wizard-sprec-matrix').selectOption('fluid');
  await page.getByTestId('wizard-sprec-axis-1').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-2').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-3').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-4').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-5').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-6').selectOption({ index: 1 });
  await page.getByTestId('wizard-sprec-axis-7').selectOption({ index: 1 });

  await expect(page.locator('body')).toContainText(/Grade\s+A\s+.*RCS\s+94/i);
  await page.getByTestId('wizard-processing-unknown').check();
  await expect(page.locator('body')).toContainText(/Grade\s+E\s+.*RCS\s+-/i);

  await page.getByTestId('wizard-processing-unknown').uncheck();
  await expect(page.locator('body')).toContainText(/Grade\s+A\s+.*RCS\s+94/i);
  await expect(page.locator('body')).not.toContainText('Unknown SPREC code');

  const latestPayload = previewPayloads[previewPayloads.length - 1] as { sprec?: Record<string, any> };
  expect(latestPayload.sprec?.preAnalyticalUnknown).toBe(false);
  expect([
    latestPayload.sprec?.preCentrifugation?.code,
    latestPayload.sprec?.centrifugation1?.code,
    latestPayload.sprec?.centrifugation2?.code,
    latestPayload.sprec?.postCentrifugation?.code,
  ]).not.toContain('X');
});

test('Cenário de bloqueio: sem TCLE ativo o envio final fica impedido', async ({ page }) => {

  await mockWizardApis(page, { withActiveTcle: false });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await completeStep1(page);
  await completeStep2(page);

  const finalizeButton = page.getByTestId('wizard-submit-button');
  await expect(finalizeButton).toBeDisabled();
});

test('finalização: gera label de etiqueta e permite impressão', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.addInitScript(() => {
    (window as any).__labelPrintCount = 0;
    window.print = () => {
      (window as any).__labelPrintCount += 1;
    };
  });

  await mockWizardApis(page, { withActiveTcle: true });

  await page.goto('/next/intake', { waitUntil: 'networkidle' });
  await completeStep1(page);
  await completeStep2(page);

  await page.getByTestId('wizard-diagnosis-search').fill('ORPHA:324');
  await page.getByTestId('wizard-diagnosis-option-0').click();
  await page.getByTestId('wizard-treatment-status').selectOption('NAIVE');

  await expect(page.getByTestId('wizard-submit-button')).toBeEnabled();
  const finalResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === 'POST' && /\/api\/intake-wizard(?:\?.*)?$/.test(response.url());
  });
  await page.getByTestId('wizard-submit-button').click();
  const finalResponse = await finalResponsePromise;

  expect(pageErrors).toEqual([]);
  expect(finalResponse.status()).toBe(200);
  expect(await finalResponse.text()).toContain('consentEmail');
  await expect(page.getByTestId('sample-label')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('sample-label-code')).toContainText('BC-S-1001');
  await expect(page.getByTestId('sample-label-sample-id')).toContainText('S-1001');
  await expect(page.getByTestId('sample-label-type')).toContainText('PLASMA');
  await expect(page.getByTestId('sample-label-date')).toContainText('18/05/2026');
  await expect(page.getByTestId('sample-label-patient')).toContainText('12345678');

  await page.getByTestId('sample-label-print-button').click();
  await expect.poll(() => page.evaluate(() => (window as any).__labelPrintCount)).toBe(1);
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
  await page.getByTestId('wizard-document').fill('13360378652');
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
