import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import { createAdminAuthContext, injectSessionToken, mockAuthVerifyKeepalive } from './support/auth';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Reports - Critical flow', () => {
  test('carrega a central de relatórios e navega para a consulta', async ({ page }) => {
    const auth = createAdminAuthContext();
    await injectSessionToken(page, auth.token);
    await mockAuthVerifyKeepalive(page, auth.user);

    await page.route('**/api/reports**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (method === 'GET' && /\/api\/reports\/[^/]+\/filters$/.test(url)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            filters: [
              { name: 'startDate', label: 'Data Inicial', type: 'date' },
              { name: 'endDate', label: 'Data Final', type: 'date' },
            ],
          }),
        });
        return;
      }

      if (method === 'GET' && /\/api\/reports(\?.*)?$/.test(url)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { _id: '507f1f77bcf86cd799439001', reportID: 1, reportType: 'patients', generatedAt: '2026-04-01T10:00:00.000Z' },
          ]),
        });
        return;
      }

      if (method === 'POST' && /\/api\/reports\/generate$/.test(url)) {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ reportID: 2, reportType: 'audit' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/reports');
    await expect(page.getByText('Central de Relatórios')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Fluxo com filtros dinâmicos')).toBeVisible();
    await expect(page.locator('.report-card').first()).toBeVisible();

    await page.locator('.report-button').first().click();
    await expect(page).toHaveURL(/\/reports\/query\//);
  });

  test('FHIR Excel Import converte modelo para Bundle e envia para staging', async ({ page }) => {
    const auth = createAdminAuthContext();
    await injectSessionToken(page, auth.token);
    await mockAuthVerifyKeepalive(page, auth.user);

    let stagedBundle: any = null;
    await page.route('**/api/import/fhir/stage', async (route) => {
      stagedBundle = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            batchId: 'batch-fhir-excel',
            counters: { valid: 1, error: 0, pendingConsent: 1 },
          },
        }),
      });
    });

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet([
      {
        patient_external_id: 'P-001',
        patient_name: 'Participante Teste',
        patient_document: '12345678901',
        patient_email: 'participante@example.org',
        patient_birth_date: '1990-01-01',
        patient_sex: 'female',
        disease_name: 'Doença teste',
        cid10: 'E75.2',
        orpha_code: 'ORPHA:123',
        omim_code: '123456',
        sample_external_id: 'S-001',
        sample_type: 'Sangue',
        matrix: 'Plasma',
        collection_datetime: '2026-05-19T10:00:00-03:00',
        storage_temperature: '-20C',
        sprecs_raw: 'SER-PLAS',
        processing_unknown: 'false',
        biomarker_type: 'Biomarcador teste',
        biomarker_value: '12.5',
        biomarker_unit: 'ng/mL',
        hpo_code: 'HP:0001250',
        hpo_label: 'Seizure',
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'FHIR Import');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    await page.goto('/import');
    await expect(page.getByTestId('fhir-excel-template-button')).toBeVisible();
    await expect(page.getByTestId('fhir-excel-convert-button')).toBeVisible();
    await expect(page.getByTestId('fhir-json-import-button')).toBeVisible();

    await page.getByTestId('fhir-excel-input').setInputFiles({
      name: 'modelo-preenchido.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });
    await page.getByTestId('fhir-excel-convert-button').click();

    await expect(page.getByTestId('fhir-json-preview')).toContainText('"resourceType": "Bundle"');
    await expect(page.getByTestId('fhir-json-preview')).toContainText('"resourceType": "Patient"');

    await page.getByTestId('fhir-json-import-button').click();
    await expect(page.getByTestId('fhir-staging-result')).toContainText('lote batch-fhir-excel');
    expect(stagedBundle?.resourceType).toBe('Bundle');
    expect(stagedBundle?.entry?.some((entry: any) => entry.resource?.resourceType === 'Specimen')).toBeTruthy();
  });
});
