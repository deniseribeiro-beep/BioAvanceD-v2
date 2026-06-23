import { chromium, type FullConfig } from './frontend/node_modules/@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resetEvidenceStore } from './tests/poc/utils/evidence-writer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createMockJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

export default async function globalSetup(config: FullConfig) {
  resetEvidenceStore();

  const projectUse = config.projects[0]?.use ?? {};
  const baseURL = String(projectUse.baseURL ?? 'http://127.0.0.1:5173');
  const authFile = path.resolve(__dirname, 'playwright', '.auth', 'user.json');

  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  const token = createMockJwt({
    id: '507f1f77bcf86cd799439011',
    userID: '507f1f77bcf86cd799439011',
    accessType: 4,
    roleName: 'Administrador',
    name: 'QA Admin',
    username: 'admin',
    email: 'admin@bioavanced.example',
  });

  fs.writeFileSync(
    authFile,
    JSON.stringify(
      {
        cookies: [],
        origins: [{ origin: baseURL, localStorage: [{ name: 'token', value: token }] }],
      },
      null,
      2
    )
  );

  if (process.env.PLAYWRIGHT_USE_REAL_LOGIN === '1') {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
    await browser.close();
  }
}
