#!/usr/bin/env node
/**
 * CT-RNF001-LOAD-01 — measure p95 UI ready time on critical routes.
 * Usage:
 *   BASE_URL=http://localhost:5173 N=30 node scripts/rnf001-ui-p95.mjs
 * Optional auth (cookie/storage not required for /login; for others set TOKEN via
 * PLAYWRIGHT storage by logging in when TEST_USER/TEST_PASS are set).
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const API_URL = (process.env.API_URL || process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const N = Math.max(5, Number(process.env.N || 30));
const OUT = process.env.OUT
  || join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'evidencias', 'homologacao-runtime', 'rnf001-ui-p95-results.json');

const routes = [
  { path: '/login', ready: '[data-testid="login-form"]', auth: false },
  { path: '/dashboard', ready: 'aside#app-sidebar h1, h1', auth: true },
  { path: '/samples', ready: 'h1, [data-testid="samples-page"]', auth: true },
  // Intake wizard has no page-level h1; readiness is the first wizard field.
  { path: '/next/intake', ready: '[data-testid="wizard-full-name"]', auth: true },
];

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function apiLogin() {
  const user = process.env.TEST_USER || process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';
  const pass = process.env.TEST_PASS || process.env.BOOTSTRAP_ADMIN_TEMP_PASSWORD || '';
  if (!pass) return null;
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (!res.ok) {
    console.error(`api login failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const body = await res.json();
  const token = body?.data?.token;
  const sessionUser = body?.data?.user;
  if (!token || !sessionUser) return null;
  return { token, user: sessionUser };
}

async function ensureAuth(context) {
  const session = await apiLogin();
  if (!session) return false;
  await context.addInitScript(
    ([tokenValue, userValue]) => {
      window.localStorage.setItem('token', tokenValue);
      window.localStorage.setItem('user', userValue);
    },
    [session.token, JSON.stringify(session.user)]
  );
  return true;
}

async function measure(page, route) {
  const t0 = Date.now();
  await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator(route.ready).first().waitFor({ state: 'visible', timeout: 20_000 });
  return Date.now() - t0;
}

async function waitStackReady(page, attempts = 12) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.locator('[data-testid="login-form"]').first().waitFor({ state: 'visible', timeout: 20_000 });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  throw lastErr || new Error('stack not ready for /login');
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

let authed = false;
if (routes.some((r) => r.auth)) {
  authed = await ensureAuth(context);
}
const page = await context.newPage();

const results = {
  protocol: 'CT-RNF001-LOAD-01',
  baseUrl: BASE_URL,
  n: N,
  measuredAt: new Date().toISOString(),
  authed,
  routes: {},
  passCriterionMs: 2000,
};

try {
  await waitStackReady(page);
} catch (err) {
  results.error = String(err?.message || err);
  results.overallPass = false;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
  console.error(results.error);
  await browser.close();
  process.exit(2);
}

for (const route of routes) {
  if (route.auth && !authed) {
    results.routes[route.path] = { skipped: true, reason: 'auth_required_but_login_failed' };
    continue;
  }
  // /login must be measured without seeded auth or ProtectedRoute redirects away.
  const measurePage = route.auth
    ? page
    : await (async () => {
        const bare = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const p = await bare.newPage();
        p._bareContext = bare;
        return p;
      })();
  const samples = [];
  const errors = [];
  for (let i = 0; i < N; i += 1) {
    try {
      const ms = await measure(measurePage, route);
      samples.push(ms);
      if ((i + 1) % 5 === 0 || i === 0) {
        console.error(`[rnf001] ${route.path} sample ${i + 1}/${N}: ${ms}ms`);
      }
    } catch (err) {
      errors.push(String(err?.message || err));
      console.error(`[rnf001] ${route.path} sample ${i + 1}/${N} FAIL: ${errors[errors.length - 1]}`);
    }
  }
  if (measurePage._bareContext) {
    await measurePage._bareContext.close();
  }
  if (!samples.length) {
    results.routes[route.path] = { skipped: true, reason: 'all_samples_failed', errors };
    continue;
  }
  // A failed sample (a navigation that errored or never became ready) ranks
  // above every measured one, so it can raise the p95 but never lower it.
  const sorted = [...samples].sort((a, b) => a - b).concat(errors.map(() => Infinity));
  const p95 = percentile(sorted, 95);
  const summary = {
    samples,
    p50: Number.isFinite(percentile(sorted, 50)) ? percentile(sorted, 50) : null,
    p95: Number.isFinite(p95) ? p95 : null,
    max: Number.isFinite(sorted[sorted.length - 1]) ? sorted[sorted.length - 1] : null,
    failedSamples: errors.length,
    pass: Number.isFinite(p95) && p95 <= results.passCriterionMs,
  };
  if (errors.length) summary.errors = errors;
  results.routes[route.path] = summary;
}

// RNF001 C1: the run passes only when every route was measured and met the
// budget; a skipped route (login failed, every sample failed) is a failure.
results.overallPass = routes.every((r) => results.routes[r.path]?.pass === true);

await browser.close();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
process.exit(results.overallPass ? 0 : 2);
