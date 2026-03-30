
const { test, expect } = require('@playwright/test');

test('cadastro integrado via intake wizard (paciente + amostra + clínica)', async ({ page }) => {
  await page.addInitScript(() => {
    const jwtLikeToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySUQiOiJxYS1jb29yZC0xIiwiYWNjZXNzVHlwZSI6Mywicm9sZU5hbWUiOiJDb29yZGVuYWRvciJ9.';
    localStorage.setItem('token', jwtLikeToken);
    localStorage.setItem('api_port', '3000');
  });

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  // Mock rotas essenciais para intake
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

  // Mock consent template
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

  // Mock intake submit
  await page.route('**/api/intake', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Cadastro integrado realizado com sucesso!' }),
    });
  });


  await page.goto('/next/intake');

  // Passo 1: Dados do paciente
  await page.waitForSelector('input[name="patientName"]', { state: 'visible', timeout: 15000 });
  await expect(page.getByLabel(/Nome completo|Full Name/i)).toBeVisible();
  await page.getByLabel(/Nome completo|Full Name/i).fill('Paciente QA E2E');
  await page.getByLabel(/Data de Nascimento|Birth Date/i).fill('01/01/1990');
  await page.getByLabel(/Sexo|Gender/i).selectOption({ label: /Masculino|Male/i });
  await page.getByLabel(/E-mail/i).fill('paciente.qa@e2e.com');
  await page.getByLabel(/CPF|Passaporte|Prontuário|Documento/i).fill('12345678900');

  // Avançar para o passo da amostra
  await page.getByRole('button', { name: /Próximo|Next/i }).click();

  // Passo 2: Dados da amostra
  await expect(page.getByLabel(/Tipo de Amostra|Sample Type/i)).toBeVisible();
  await page.getByLabel(/Tipo de Amostra|Sample Type/i).selectOption({ index: 1 });
  await page.getByLabel(/Origem da Amostra|Sample Origin/i).selectOption({ index: 1 });
  await page.getByLabel(/Protocolo de Extração|Extraction Protocol/i).selectOption({ index: 1 });
  await page.getByLabel(/Unidade de Medida|Measurement Unit|Unit of Measure/i).selectOption({ index: 1 });
  await page.getByLabel(/Quantidade|Quantity/i).fill('1');
  await page.getByLabel(/Qualidade|Quality/i).selectOption({ index: 1 });
  await page.getByLabel(/Projeto Vinculado|Linked Project/i).fill('Projeto QA E2E');

  // Avançar para o passo de clínica
  await page.getByRole('button', { name: /Próximo|Next/i }).click();

  // Passo 3: Dados clínicos (preencher apenas o mínimo obrigatório)
  await page.getByLabel(/Pressão Arterial|Blood Pressure/i).fill('120/80');
  await page.getByLabel(/Observações Clínicas|Clinical Observations/i).fill('Paciente saudável para E2E.');

  // Avançar para consentimento
  await page.getByRole('button', { name: /Próximo|Next/i }).click();

  // Selecionar TCLE e aceitar termos
  await expect(page.getByText(/TCLE QA/)).toBeVisible();
  await page.getByLabel(/Aceito os termos gerais/i).check();

  // Finalizar cadastro
  await page.getByRole('button', { name: /Finalizar|Concluir|Submit/i }).click();

  // Validar mensagem de sucesso
  await expect(page.getByText(/Cadastro integrado realizado com sucesso|sucesso/i)).toBeVisible();
});
