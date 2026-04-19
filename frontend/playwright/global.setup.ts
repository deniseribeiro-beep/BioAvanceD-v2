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

  const testUser = process.env.TEST_USER || 'admin';
  const testPass = process.env.TEST_PASS || 'Admin@123';

  await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });

  const usernameInput = page
    .locator('input[name="username"], input[name="email"], input[type="email"], input[aria-label*="Username" i], input[aria-label*="Email" i]')
    .first();
  const passwordInput = page
    .locator('input[type="password"], input[name="password"], input[aria-label*="Password" i], input[aria-label*="Senha" i]')
    .first();
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
