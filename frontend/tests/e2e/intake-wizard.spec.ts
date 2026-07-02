import { test, expect, type Page } from '@playwright/test';
import { createAdminAuthContext, injectSessionToken, mockAuthVerifyKeepalive } from './support/auth';
import { mockWizardDomainApis } from './support/api-mocks';

type QualityAssessment = Record<string, unknown>;

async function mockWizardApis(page: Page, options: { withActiveTcle?: boolean; qualityAssessment?: QualityAssessment } = {}) {
  const auth = createAdminAuthContext();
  await injectSessionToken(page, auth.token);
  await mockAuthVerifyKeepalive(page, auth.user);
  await mockWizardDomainApis(page, { withActiveTcle: true, ...options });
}

async function openWizard(page: Page) {
  await page.goto('/next/intake');
  await expect(page.getByTestId('wizard-title')).toBeVisible({ timeout: 10_000 });
}

async function completeStep1(page: Page, document = '13360378652') {
  await page.getByTestId('wizard-full-name').fill('Paciente QA Wizard');
  await page.getByTestId('wizard-birth-date').fill('10/10/1990');
  await page.getByTestId('wizard-gender').selectOption('F');
  await page.getByTestId('wizard-email').fill('qa@bioavanced.test');
  await page.getByTestId('wizard-document').fill(document);
  await page.getByTestId('wizard-next-button').click();
}

async function fillStep2(page: Page) {
  await page.getByTestId('wizard-sprec-matrix').selectOption('fluid');
  for (let axis = 1; axis <= 7; axis += 1) {
    await page.getByTestId(`wizard-sprec-axis-${axis}`).selectOption({ index: 1 });
  }
  await page.getByTestId('wizard-quantity').fill('3.5');
  await page.getByTestId('wizard-linked-project').fill('Projeto QA');
  await page.getByTestId('wizard-institution-name').fill('Instituto QA');
}

async function completeStep2(page: Page) {
  await fillStep2(page);
  await page.getByTestId('wizard-next-button').click();
}

async function selectFabry(page: Page) {
  await page.getByTestId('wizard-diagnosis-search').fill('ORPHA:324');
  const responsePromise = page.waitForResponse((response) => response.url().includes('/dictionary/suggest') && response.ok());
  await page.getByTestId('wizard-diagnosis-option-0').click();
  await responsePromise;
  await page.getByTestId('wizard-treatment-status').selectOption('NAIVE');
}

async function submitWizard(page: Page) {
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && /\/api\/intake-wizard(?:\?.*)?$/.test(request.url()));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && /\/api\/intake-wizard(?:\?.*)?$/.test(response.url()));
  await page.getByTestId('wizard-submit-button').click();
  return { request: await requestPromise, response: await responsePromise };
}

test('Fabry ORPHA:324 usa exclusivamente fenótipos e biomarcadores da API', async ({ page }) => {
  await mockWizardApis(page);
  await openWizard(page);
  await completeStep1(page);
  await completeStep2(page);
  await selectFabry(page);
  await expect(page.getByTestId('wizard-suggested-biomarkers-section')).toContainText('Angioqueratoma');
  await expect(page.getByTestId('wizard-suggested-biomarkers-section')).toContainText('HP:0001066');
  await expect(page.getByTestId('wizard-disease-biomarkers-section')).toContainText('Alpha-galactosidase A');
  await expect(page.getByTestId('wizard-disease-biomarkers-section')).toContainText('Lyso-Gb3');
});

test('Documento aplica máscara de CPF e preserva passaporte alfanumérico', async ({ page }) => {
  await mockWizardApis(page);
  await openWizard(page);
  const input = page.getByTestId('wizard-document');
  await input.fill('13360378652');
  await expect(input).toHaveValue('133.603.786-52');
  await input.fill('ab123456');
  await expect(input).toHaveValue('AB123456');
  await expect(input).not.toHaveAttribute('inputmode', 'numeric');
  await expect(input).not.toHaveAttribute('pattern', '[0-9]*');
});

test('Documento rejeita CPF inválido e impede avanço', async ({ page }) => {
  await mockWizardApis(page);
  await openWizard(page);
  await completeStep1(page, '12345678900');
  await expect(page.getByTestId('wizard-document')).toHaveValue('123.456.789-00');
  await expect(page.getByText(/documento válido|valid document/i)).toBeVisible();
  await expect(page.getByTestId('wizard-sprec-matrix')).not.toBeVisible();
});

test('RCS-GOV renderiza somente a decisão persistida retornada pelo POST', async ({ page }) => {
  await mockWizardApis(page);
  await openWizard(page);
  await completeStep1(page);
  await completeStep2(page);
  await selectFabry(page);
  await expect(page.getByTestId('persisted-quality-assessment')).not.toBeVisible();
  const { response } = await submitWizard(page);
  expect(response.status()).toBe(200);
  await expect(page.getByTestId('persisted-quality-grade')).toHaveText(/Grade A.*RCS 94/);
  await expect(page.getByTestId('persisted-quality-route')).toContainText('Score-based certification');
});

test('RCS-GOV exibe governance failure com score nulo sem pageerror', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await mockWizardApis(page, { qualityAssessment: {
    model_version: 'RCS-GOV-1.0', governance_status: 0,
    governance_failure_reasons: ['Unknown SPREC code', 'Missing critical metadata'],
    p_bio: null, rcs_score: null, score_based_grade: null, final_grade: 'E',
    grade_route: 'Governance failure', axis_penalties: [], calculation_trace: {},
  } });
  await openWizard(page);
  await completeStep1(page);
  await completeStep2(page);
  await selectFabry(page);
  await submitWizard(page);
  await expect(page.getByTestId('persisted-quality-grade')).toHaveText(/Grade E.*RCS -/);
  await expect(page.getByTestId('persisted-quality-route')).toContainText('Unknown SPREC code');
  expect(errors).toEqual([]);
});

test('Processamento desconhecido restaura eixos e submete os valores restaurados', async ({ page }) => {
  await mockWizardApis(page);
  await openWizard(page);
  await completeStep1(page);
  await fillStep2(page);
  const original = await page.getByTestId('wizard-sprec-axis-3').inputValue();
  await page.getByTestId('wizard-processing-unknown').check();
  await page.getByTestId('wizard-processing-unknown').uncheck();
  await expect(page.getByTestId('wizard-sprec-axis-3')).toHaveValue(original);
  await page.getByTestId('wizard-next-button').click();
  await selectFabry(page);
  const { request } = await submitWizard(page);
  const payload = request.postDataJSON() as { sample?: { sprec?: { preAnalyticalUnknown?: boolean; preCentrifugation?: { code?: string } } } };
  expect(payload.sample?.sprec?.preAnalyticalUnknown).toBe(false);
  expect(payload.sample?.sprec?.preCentrifugation?.code).not.toBe('X');
});

test('Etiqueta usa somente dados da amostra e abre a rota autenticada', async ({ page }) => {
  await mockWizardApis(page);
  await openWizard(page);
  await completeStep1(page);
  await completeStep2(page);
  await selectFabry(page);
  await submitWizard(page);
  const label = page.getByTestId('sample-label');
  await expect(label).toContainText('BC-S-1001');
  await expect(label).toContainText('S-1001');
  await expect(label).toContainText('PLASMA');
  await expect(label).not.toContainText('12345678');
  await expect(label).not.toContainText('133.603.786-52');
  await expect(page.getByTestId('sample-label-print-button')).toHaveAttribute('type', 'button');
  await expect(page.getByRole('link', { name: 'Abrir etiqueta autenticada' })).toHaveAttribute('href', '/samples/S-1001/label');
});
