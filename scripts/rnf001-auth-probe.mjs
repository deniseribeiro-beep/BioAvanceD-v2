import { chromium } from 'playwright';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const API = (process.env.API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const user = process.env.TEST_USER || 'admin';
const pass = process.env.TEST_PASS || 'Admin@123-e2e-stack';

const res = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: user, password: pass }),
});
const text = await res.text();
console.log('LOGIN_STATUS', res.status);
console.log('LOGIN_BODY', text.slice(0, 800));
let body;
try { body = JSON.parse(text); } catch { body = null; }
const token = body?.data?.token;
const sessionUser = body?.data?.user;
console.log('HAS_TOKEN', Boolean(token), 'HAS_USER', Boolean(sessionUser));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
if (token && sessionUser) {
  await context.addInitScript(
    ([tokenValue, userValue]) => {
      window.localStorage.setItem('token', tokenValue);
      window.localStorage.setItem('user', userValue);
    },
    [token, JSON.stringify(sessionUser)]
  );
}
const page = await context.newPage();
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
for (const path of ['/dashboard', '/samples', '/next/intake']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);
  console.log('PATH', path, 'URL', page.url());
  console.log('  login-form', await page.locator('[data-testid="login-form"]').count());
  console.log('  sidebar-nav', await page.locator('nav.sidebar-nav').count());
  console.log('  aside-sidebar', await page.locator('aside#app-sidebar').count());
  console.log('  h1', await page.locator('h1').count());
  const h1Text = await page.locator('h1').first().textContent().catch(() => null);
  console.log('  h1Text', h1Text);
}
await browser.close();
