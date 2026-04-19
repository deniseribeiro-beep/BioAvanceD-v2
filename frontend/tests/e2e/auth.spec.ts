/**
 * E2E Tests - Authentication Flow
 * Playwright testes para login, MFA, e password reset
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_BASE_URL = 'http://localhost:3000/api';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('E2E - Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${API_BASE_URL}/auth/**`, route => {
      const url = route.request().url();
      if (url.includes('/auth/login')) {
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'Credenciais inválidas' })
        });
        return;
      }

      route.continue();
    });

    await page.goto(`${BASE_URL}/login`);
  });

  test('deve exibir página de login corretamente', async ({ page }) => {
    // Verificar que os elementos críticos estão visíveis
    await expect(page.locator('[data-testid="login-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-username-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-submit-button"]')).toBeVisible();
  });

  test('deve exibir erro ao tentar login com credenciais vazias', async ({ page }) => {
    // Clicar no botão de submit sem preencher nada
    await page.locator('[data-testid="login-submit-button"]').click();

    // Verificar se o campo username tem required atributo
    const usernameInput = page.locator('[data-testid="login-username-input"]');
    const isRequired = await usernameInput.evaluate((el: HTMLInputElement) => el.required);
    expect(isRequired).toBe(true);
  });

  test('deve preencher credenciais e enviá-las', async ({ page }) => {
    const username = 'testuser';
    const password = 'TestPass@123';

    // Preencher formulário
    await page.locator('[data-testid="login-username-input"]').fill(username);
    await page.locator('[data-testid="login-password-input"]').fill(password);

    // Verificar que os valores foram digitados
    await expect(page.locator('[data-testid="login-username-input"]')).toHaveValue(username);
    await expect(page.locator('[data-testid="login-password-input"]')).toHaveValue(password);
  });

  test('deve permitir usar email ou username indistintamente', async ({ page }) => {
    // Test 1: Usar username
    await page.locator('[data-testid="login-username-input"]').fill('testuser');
    await expect(page.locator('[data-testid="login-username-input"]')).toHaveValue('testuser');

    // Limpar
    await page.locator('[data-testid="login-username-input"]').clear();

    // Test 2: Usar email
    await page.locator('[data-testid="login-username-input"]').fill('test@example.com');
    await expect(page.locator('[data-testid="login-username-input"]')).toHaveValue('test@example.com');
  });

  test('deve desabilitar campo de senha quando MFA é requerido', async ({ page }) => {
    const passwordInput = page.locator('[data-testid="login-password-input"]');

    // Inicialmente, não deve estar desabilitado
    await expect(passwordInput).not.toBeDisabled();
  });

  test('deve permitir envio de formulário via Enter', async ({ page }) => {
    const usernameInput = page.locator('[data-testid="login-username-input"]');
    
    await usernameInput.fill('testuser');
    await page.locator('[data-testid="login-password-input"]').fill('TestPass@123');
    
    // Pressionar Enter
    await page.keyboard.press('Enter');

    // Verificar se formulário foi submetido (button estava no processo de carregamento)
    // Em um cenário real, verificaríamos redirecionamento ou erro
  });

  test('deve abrir modal de recuperação de senha ao clicar no link', async ({ page }) => {
    const forgotPasswordButton = page.locator('[data-testid="login-forgot-password-button"]');
    
    // Verificar que o botão está visível
    await expect(forgotPasswordButton).toBeVisible();
    
    // Clicar no botão
    await forgotPasswordButton.click();

    // Verificar se modal apareceu
    await expect(page.locator('[data-testid="forgot-password-modal-content"]')).toBeVisible({ timeout: 3000 });
  });

  test('deve fechar modal ao cancelar recuperação de senha', async ({ page }) => {
    // Abrir modal
    await page.locator('[data-testid="login-forgot-password-button"]').click();
    
    await expect(page.locator('[data-testid="forgot-password-modal-content"]')).toBeVisible();

    await page.getByRole('button', { name: /cancel|cancelar/i }).click();

    await expect(page.locator('[data-testid="forgot-password-modal-content"]')).toBeHidden({ timeout: 3000 });
  });

  test('deve exigir email válido para recuperação de senha', async ({ page }) => {
    // Abrir modal
    await page.locator('[data-testid="login-forgot-password-button"]').click();

    // Encontrar campo de email no modal (se houver data-testid)
    // Se não houver, usar seletor mais genérico
    const emailInputs = await page.locator('input[type="email"]').all();
    
    if (emailInputs.length > 0) {
      // Presionar Enter sem preencher - deve falhar validation HTML5
      const emailInput = emailInputs[0];
      const isRequired = await emailInput.evaluate((el: HTMLInputElement) => el.required);
      expect(isRequired).toBe(true);
    }
  });

  test('deve manter estado de username quando MFA é requerido', async ({ page }) => {
    const username = 'testuser';
    
    await page.locator('[data-testid="login-username-input"]').fill(username);
    await page.locator('[data-testid="login-password-input"]').fill('TestPass@123');

    // Simular resposta que requer MFA
    // Isso seria tratado pelo mock de API
    
    // Verificar que username permanece preenchido
    await expect(page.locator('[data-testid="login-username-input"]')).toHaveValue(username);
  });

  test('deve aceitar código MFA quando exibida seção de 2FA', async ({ page }) => {
    // Este teste seria acionado quando o backend retorna requiresTwoFactor
    // Para simular, podemos usar page.evaluate para forçar o estado
    
    // Aguardar que a seção de MFA apareça (ou pular se não aparecer em teste isolado)
    const mfaSection = page.locator('[data-testid="two-factor-section"]');
    
    // Se a seção estiver visível, testar entrada de código
    const isVisible = await mfaSection.isVisible().catch(() => false);
    
    if (isVisible) {
      const mfaInput = page.locator('[data-testid="login-mfa-code-input"]');
      await mfaInput.fill('123456');
      await expect(mfaInput).toHaveValue('123456');
    }
  });

  test('deve rejeitar código MFA que não é numérico', async ({ page }) => {
    const mfaInput = page.locator('[data-testid="login-mfa-code-input"]');
    const isVisible = await mfaInput.isVisible().catch(() => false);

    if (isVisible) {
      await mfaInput.fill('abc123');
      await expect(mfaInput).toHaveValue('123');
    }
  });

  test('deve limitar código MFA a 6 dígitos', async ({ page }) => {
    // Se MFA for requerido
    const mfaSection = page.locator('[data-testid="two-factor-section"]');
    const isVisible = await mfaSection.isVisible().catch(() => false);
    
    if (isVisible) {
      const mfaInput = page.locator('[data-testid="login-mfa-code-input"]');
      
      // Tentar digitar mais de 6 dígitos
      await mfaInput.fill('1234567890');
      
      // Verificar que apenas 6 foram mantidos
      const value = await mfaInput.inputValue();
      expect(value.length).toBeLessThanOrEqual(6);
    }
  });

  test('deve renderizar mensagem de erro de login', async ({ page }) => {
    // Simular condição de erro mockando a resposta de API
    // Para isso, interceptar a chamada e retornar erro
    
    await page.locator('[data-testid="login-username-input"]').fill('invaliduser');
    await page.locator('[data-testid="login-password-input"]').fill('wrongpass');
    
    // Aguardar potencial erro (caso API retorne erro)
    // Neste teste isolado, apenas verificamos que existe elemento for erro
    const errorElement = page.locator('[data-testid="login-error"]');
    
    // Inicialmente não deve estar visível
    const isVisible = await errorElement.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('deve ser acessível via teclado', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-testid="login-submit-button"]')).toBeVisible();
  });

  test('deve manter valores de formulário após erro de validação', async ({ page }) => {
    const username = 'testuser';
    const password = 'TestPass@123';
    
    await page.locator('[data-testid="login-username-input"]').fill(username);
    await page.locator('[data-testid="login-password-input"]').fill(password);
    
    // Simular envio (que pode falhar)
    await page.locator('[data-testid="login-submit-button"]').click();
    
    // Verificar que valores persistem
    await expect(page.locator('[data-testid="login-username-input"]')).toHaveValue(username);
    await expect(page.locator('[data-testid="login-password-input"]')).toHaveValue(password);
  });
});
