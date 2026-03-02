const { test, expect } = require('@playwright/test');

test('cadastro de amostra com Doença Rara exibe Modo Estrito Ativado', async ({ page }) => {
  await page.addInitScript(() => {
    const jwtLikeToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJpZCI6MSwidXNlcm5hbWUiOiJxYS11c2VyIiwiYWNjZXNzVHlwZSI6Mn0.';
    localStorage.setItem('token', jwtLikeToken);
    localStorage.setItem('api_port', '3000');
  });

  await page.route('**/api/auth/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          valid: true,
          user: {
            id: 1,
            userID: 'qa-user',
            name: 'QA User',
            username: 'qa-user',
            accessType: 2,
            roleName: 'Técnico',
          },
        },
      }),
    });
  });

  await page.route('**/api/samples*', async (route) => {
    const request = route.request();

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
      return;
    }

    if (request.method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            sampleID: '507f1f77bcf86cd799439011',
            patientID: '12345678',
            operationMode: 'STRICT',
            topology: {
              synced: true,
              fallbackQueued: false,
            },
          },
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/locations*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          {
            _id: 'loc-1',
            locationID: 101,
            equipmentType: 1,
            block: 1,
            rack: 1,
            drawer: 1,
            box: 1,
            wellPosition: 'A1',
          },
        ],
      }),
    });
  });

  await page.route('**/api/patients/validate-id', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, patientID: '12345678' }),
    });
  });

  await page.route('**/api/patients/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { patients: [] } }),
    });
  });

  await page.route('**/api/patients/12345678', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          patientID: '12345678',
          status: 'ACTIVE',
        },
      }),
    });
  });

  await page.goto('/samples/new');

  await page.getByLabel(/ID do Paciente|Patient ID/i).fill('12345678');
  await page.getByLabel(/Tipo de Amostra|Sample Type/i).selectOption('Sangue');
  await page.getByLabel(/Origem da Amostra|Sample Origin/i).selectOption('Coleta');
  await page.getByLabel(/Protocolo de Extração|Extraction Protocol/i).selectOption('Protocolo A');
  await page.getByLabel(/Unidade de Medida|Measurement Unit|Unit of Measure/i).selectOption('µL');
  await page.getByLabel(/Quantidade|Quantity/i).fill('1');
  await page.getByLabel(/Qualidade|Quality/i).selectOption('1');
  await page.getByLabel(/Localização|Location/i).selectOption('101');
  await page.getByLabel(/Projeto Vinculado|Linked Project/i).fill('Projeto QA E2E');
  await page.getByLabel(/Doença Rara|Rare Disease/i).check();

  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });

  await page.getByRole('button', { name: /Criar Amostra|Create Sample/i }).click();

  await expect(page.getByText('Modo Estrito Ativado')).toBeVisible();
});
