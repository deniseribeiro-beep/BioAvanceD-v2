const { test, expect } = require('@playwright/test');

test('cadastro de paciente como Coordenador exibe sucesso e fluxo pós-salvamento', async ({ page }) => {
  await page.addInitScript(() => {
    const jwtLikeToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySUQiOiJxYS1jb29yZC0xIiwiYWNjZXNzVHlwZSI6Mywicm9sZU5hbWUiOiJDb29yZGVuYWRvciJ9.';
    localStorage.setItem('token', jwtLikeToken);
    localStorage.setItem('api_port', '3000');
  });

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  let createPatientCalled = false;

  await page.route('**/api/auth/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          valid: true,
          user: {
            userID: 'qa-coord-1',
            name: 'QA Coordenador',
            username: 'qa.coordenador',
            accessType: 3,
            roleName: 'Coordenador',
          },
        },
      }),
    });
  });

  await page.route('**/api/patients', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { patients: [], total: 0 } }),
      });
      return;
    }

    if (method === 'POST') {
      createPatientCalled = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Paciente cadastrado com sucesso',
          data: { patientID: '12345678' },
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/patients/*/consent/resend', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'TCLE enviado' }),
    });
  });

  await page.route('**/api/consent-templates/active', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          _id: 'template-qa-1',
          title: 'TCLE QA',
          content: 'Termo de consentimento de teste',
          permissions: [
            { key: 'terms', label: 'Aceito os termos gerais', required: true },
          ],
        },
      }),
    });
  });

  await page.goto('/patients/new');

  await page.getByLabel(/Nome do Paciente|Patient Name/i).fill('Paciente QA E2E');
  await page.getByLabel(/Data de Nascimento|Birth Date/i).fill('01/01/1990');
  await page.getByLabel(/Prontuário|Record Number/i).fill('PRONT-E2E-001');
  await page.getByLabel(/Variante Genética|Genetic Variant/i).fill('GLA-c.123A>G');

  await page.getByRole('button', { name: /Cadastrar Paciente|Register Patient|Salvar/i }).click();

  await expect(page.getByText(/TCLE pronto para envio e assinatura/i)).toBeVisible();
  expect(createPatientCalled).toBe(true);

  await expect(page).toHaveURL(/\/patients\/new$/);
});
