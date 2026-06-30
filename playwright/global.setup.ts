import { chromium, type FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Auth file lives at playwright/.auth/user.json relative to the repo root.
// We resolve from process.cwd() (repo root when running `npx playwright test`)
// instead of import.meta.url, which breaks when playwright compiles this file
// as CommonJS in environments without a matching ESM tsconfig.
const AUTH_FILE = path.resolve(process.cwd(), 'playwright', '.auth', 'user.json');

function createMockJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

async function globalSetup(config: FullConfig) {
  const projectUse = config.projects[0]?.use ?? {};
  const baseURL = String(projectUse.baseURL ?? 'http://localhost:5173');

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  if (process.env.PLAYWRIGHT_USE_REAL_LOGIN !== '1') {
    const token = createMockJwt({
      id: '507f1f77bcf86cd799439011',
      userID: '507f1f77bcf86cd799439011',
      accessType: 4,
      roleName: 'Administrador',
      name: 'QA Admin',
      username: 'admin',
      email: 'admin@bioavanced.com.br',
    });

    fs.writeFileSync(
      AUTH_FILE,
      JSON.stringify(
        {
          cookies: [],
          origins: [
            {
              origin: baseURL,
              localStorage: [{ name: 'token', value: token }],
            },
          ],
        },
        null,
        2
      )
    );
    return;
  }

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

  await page.context().storageState({ path: AUTH_FILE });
  await browser.close();
}

export default globalSetup;
