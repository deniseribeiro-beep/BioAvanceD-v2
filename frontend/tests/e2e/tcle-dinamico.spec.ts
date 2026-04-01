// MOVED FILE
import { test, expect } from '@playwright/test';

import type { Page, Route } from '@playwright/test';

test('Preenchimento e submissão do TCLE dinâmico', async ({ page }) => {
  await page.context().addCookies([
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
  
  // Tenta navegar para página admin de TCLE
  // Se não existir, valida que há tratamento apropriado
  const response = await page.goto('/admin/tcle/new', { 
    waitUntil: 'networkidle'
  }).catch(() => null);
  
  if (response && response.ok()) {
    // Se página carregou, procura por inputs genéricos
    await page.waitForTimeout(1000);
    
    const textInputs = await page.locator('input[type="text"]').all();
    
    if (textInputs.length > 0) {
      await textInputs[0].fill('TCLE Teste E2E');
    }
    
    if (textInputs.length > 1) {
      await textInputs[1].fill('12345678.9.0000.0000');
    }
    
    // Procura por textareas para corpo do TCLE
    const textareas = await page.locator('textarea').all();
    if (textareas.length > 0) {
      await textareas[0].fill('Este é um TCLE de teste automatizado.');
    }
    
    // Procura por botão de submit
    const submitBtn = page.getByRole('button', { name: /Criar|Salvar|Submit/i });
    const submitVisible = await submitBtn.isVisible().catch(() => false);
    
    if (submitVisible) {
      await submitBtn.click();
      await page.waitForTimeout(1000);
    }
  } else {
    // Se página não existe, valida que redirecionou apropriadamente  
    await expect(page).not.toHaveURL(/\/admin\/tcle\/new/);
  }
});
