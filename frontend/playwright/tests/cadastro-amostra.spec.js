
const { test, expect } = require('@playwright/test');

test('cadastro de amostra pelo inventário', async ({ page }) => {
  await page.addInitScript(() => {
    const jwtLikeToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJpZCI6MSwidXNlcm5hbWUiOiJxYS11c2VyIiwiYWNjZXNzVHlwZSI6Mn0.';
    localStorage.setItem('token', jwtLikeToken);
    localStorage.setItem('api_port', '3000');
  });

  await page.route('**/api/auth/verify', async (route) => {
    // Arquivo legado movido para _legacy_tests/cadastro-amostra.spec.js para referência histórica.
    // Removido da esteira de testes automatizados.
    });
  });

  // Navega para o inventário de amostras
  await page.goto('/samples');

  // Clica no botão de "Criar Amostra" (submit do formulário)
  const criarAmostraBtn = await page.getByRole('button', { name: /Criar Amostra|Create Sample/i });
  await expect(criarAmostraBtn).toBeVisible();
  await criarAmostraBtn.click();

  // Preenche o formulário conforme renderizado
  await expect(page.getByLabel(/ID do Paciente|Patient ID/i)).toBeVisible();
  await page.getByLabel(/ID do Paciente|Patient ID/i).fill('12345678');
  await page.getByLabel(/Tipo de Amostra|Sample Type/i).selectOption({ index: 1 });
  await page.getByLabel(/Origem da Amostra|Sample Origin/i).selectOption({ index: 1 });
  await page.getByLabel(/Protocolo de Extração|Extraction Protocol/i).selectOption({ index: 1 });
  await page.getByLabel(/Unidade de Medida|Measurement Unit|Unit of Measure/i).selectOption({ index: 1 });
  await page.getByLabel(/Quantidade|Quantity/i).fill('1');
  await page.getByLabel(/Qualidade|Quality/i).selectOption({ index: 1 });
  await page.getByLabel(/Localização|Location/i).selectOption('101');
  await page.getByLabel(/Projeto Vinculado|Linked Project/i).fill('Projeto QA E2E');
  await page.getByLabel(/Doença Rara|Rare Disease/i).check();

  // Submete o formulário
  const submitBtn = await page.getByRole('button', { name: /Criar Amostra|Create Sample|Salvar|Save/i });
  await expect(submitBtn).toBeVisible();
  await submitBtn.click();

  // Valida mensagem de sucesso ou modo estrito
  await expect(page.getByText(/Modo Estrito Ativado|sucesso|Sample created/i)).toBeVisible();
});
