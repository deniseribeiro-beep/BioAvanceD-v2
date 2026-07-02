import { chromium, type FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function globalSetup(config: FullConfig) {
  const projectUse = config.projects[0]?.use ?? {};
  const baseURL = String(projectUse.baseURL ?? 'http://localhost:5173');
  const authFile = path.resolve(__dirname, '.auth', 'user.json');

  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const testUser = process.env.TEST_USER;
  const testPass = process.env.TEST_PASS;
  if (!testUser || !testPass) {
    await browser.close();
    throw new Error('TEST_USER and TEST_PASS are required for real Playwright authentication');
  }

  await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });

  const usernameInput = page.getByTestId('login-username-input');
  const passwordInput = page.getByTestId('login-password-input');
  const loginButton = page.getByRole('button', { name: /entrar|login|sign in/i }).first();

  await usernameInput.fill(testUser);
  await passwordInput.fill(testPass);
  await loginButton.click();

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
  await page.waitForLoadState('networkidle');

  await page.context().storageState({ path: authFile });
  await browser.close();
}

export default globalSetup;
