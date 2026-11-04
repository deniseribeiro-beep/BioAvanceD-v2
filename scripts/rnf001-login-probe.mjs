import { chromium } from 'playwright';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('requestfailed', (r) => console.log('REQFAIL', r.url(), r.failure()?.errorText));

const resp = await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
console.log('STATUS', resp?.status());
console.log('URL', page.url());
console.log('TITLE', await page.title());
const html = await page.content();
console.log('HTML_LEN', html.length);
console.log('HAS_LOGIN_FORM', html.includes('login-form'));
console.log('HAS_ROOT', html.includes('id="root"'));
console.log('HTML_SNIP', html.slice(0, 2500));
await page.screenshot({ path: process.env.OUT_PNG || '/out/rnf001-probe.png', fullPage: true });
await browser.close();
