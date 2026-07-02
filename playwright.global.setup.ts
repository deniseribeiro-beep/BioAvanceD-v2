import { chromium, type FullConfig } from './frontend/node_modules/@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resetEvidenceStore } from './tests/poc/utils/evidence-writer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function globalSetup(config: FullConfig) {
  resetEvidenceStore();
  const baseURL = String(config.projects[0]?.use?.baseURL ?? 'http://127.0.0.1:5173');
  const username = process.env.TEST_USER;
  const password = process.env.TEST_PASS;
  if (!username || !password) throw new Error('TEST_USER and TEST_PASS are required');

  const authFile = path.resolve(__dirname, 'playwright', '.auth', 'user.json');
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
    await page.locator('input[name="username"], input[name="email"]').first().fill(username);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole('button', { name: /entrar|login|sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'));
    await page.context().storageState({ path: authFile });
  } finally {
    await browser.close();
  }
}
