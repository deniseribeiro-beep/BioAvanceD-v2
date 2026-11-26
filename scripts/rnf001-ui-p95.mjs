#!/usr/bin/env node
/**
 * CT-RNF001-LOAD-01 — measure p95 UI ready time on critical routes.
 * Usage:
 *   BASE_URL=http://localhost:5173 N=30 node scripts/rnf001-ui-p95.mjs
 * Optional auth (cookie/storage not required for /login; for others set TOKEN via
 * PLAYWRIGHT storage by logging in when TEST_USER/TEST_PASS are set).
 *
 * RNF001 C3 (#1469): a download and a large import are measured apart from the
 * 2 s UI budget, through the API with the login's token, record-only:
 *   SEPARATE_N   samples per separate measurement (default 5, minimum 1).
 *   IMPORT_ROWS  synthetic CSV rows posted to /api/import/validate (default
 *                100000, RNF002's reference volume of 100,000 records).
 *   OUTAGE       a stopped external service (only `influxdb`): measures only the
 *                outage, with no browser, and writes that result to OUT.
 * The run fails when either of them could not be measured on every sample.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const API_URL = (process.env.API_URL || process.env.PLAYWRIGHT_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const N = Math.max(5, Number(process.env.N || 30));
const SEPARATE_N = Math.max(1, Number(process.env.SEPARATE_N || 5));
const IMPORT_ROWS = Math.max(1, Number(process.env.IMPORT_ROWS || 100_000));
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
  if (!session) return null;
  await context.addInitScript(
    ([tokenValue, userValue]) => {
      window.localStorage.setItem('token', tokenValue);
      window.localStorage.setItem('user', userValue);
    },
    [session.token, JSON.stringify(session.user)]
  );
  return session;
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

// RNF001 C3 (#1469): with OUTAGE=influxdb the run measures only the
// external-service outage, apart from the 2 s budget and record-only: the gate
// stops influxdb-test first. GET /api/health must report checks.influxdb down,
// then SEPARATE_N samples of the temperature report preview, which reads
// InfluxDB (RF009 AC1), are timed whatever status they answer. The run passes
// only on that health reading and a response to every sample.
const OUTAGE = process.env.OUTAGE || '';
const OUTAGE_SERVICES = { influxdb: 'POST /api/reports/temperature/preview' };

async function measureOutage() {
  const result = {
    protocol: 'CT-RNF001-LOAD-01',
    measuredAt: new Date().toISOString(),
    excludedFromBudget: ['external-service-unavailable'],
    service: OUTAGE,
    route: OUTAGE_SERVICES[OUTAGE] || null,
    serviceDown: false,
    measured: false,
  };
  if (!result.route) {
    result.reason = 'unknown_outage_service';
    return result;
  }
  let session = null;
  try {
    session = await apiLogin();
  } catch (err) {
    result.loginError = String(err?.message || err);
  }
  if (!session) {
    result.reason = 'auth_required_but_login_failed';
    return result;
  }
  try {
    const res = await fetch(`${API_URL}/api/health`);
    const body = await res.json();
    result.health = { status: res.status, check: body?.checks?.[OUTAGE] ?? null };
    result.serviceDown = body?.checks?.[OUTAGE]?.status === 'down';
  } catch (err) {
    result.health = { error: String(err?.message || err) };
  }
  if (!result.serviceDown) {
    result.reason = 'service_not_down';
    return result;
  }
  const samples = [];
  const statuses = [];
  const errors = [];
  for (let i = 0; i < SEPARATE_N; i += 1) {
    try {
      const t0 = Date.now();
      const res = await fetch(`${API_URL}/api/reports/temperature/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: {} }),
      });
      await res.arrayBuffer();
      const ms = Date.now() - t0;
      samples.push(ms);
      statuses.push(res.status);
      console.error(`[rnf001] outage ${OUTAGE} ${result.route} sample ${i + 1}/${SEPARATE_N}: ${ms}ms HTTP ${res.status}`);
    } catch (err) {
      errors.push(String(err?.message || err));
      console.error(`[rnf001] outage ${OUTAGE} ${result.route} sample ${i + 1}/${SEPARATE_N} FAIL: ${errors[errors.length - 1]}`);
    }
  }
  const sorted = [...samples].sort((a, b) => a - b).concat(errors.map(() => Infinity));
  const finite = (v) => (Number.isFinite(v) ? v : null);
  Object.assign(result, {
    samples,
    statuses,
    p50: finite(percentile(sorted, 50)),
    p95: finite(percentile(sorted, 95)),
    max: finite(sorted[sorted.length - 1]),
    failedSamples: errors.length,
    measured: samples.length === SEPARATE_N && errors.length === 0,
  });
  if (errors.length) result.errors = errors;
  return result;
}

if (OUTAGE) {
  const result = await measureOutage();
  result.overallPass = result.measured === true;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.overallPass ? 0 : 2);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

let authed = false;
let session = null;
if (routes.some((r) => r.auth)) {
  session = await ensureAuth(context);
  authed = Boolean(session);
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
const routesPass = routes.every((r) => results.routes[r.path]?.pass === true);

// RNF001 C3 (#1469): downloads, large imports and external-service outage are
// measured apart from the 2 s budget. The download and the import are timed
// here, record-only, with no budget of their own; the outage is measured by
// the OUTAGE=influxdb run of this script, with InfluxDB stopped.
results.excludedFromBudget = ['download', 'import', 'external-service-unavailable'];

function buildImportCsv(rows) {
  // Synthetic rows only, no personal data.
  const lines = ['patientId,name,birthDate'];
  for (let i = 0; i < rows; i += 1) lines.push(`rnf001-${i},rnf001,2000-01-01`);
  return `${lines.join('\n')}\n`;
}

const separate = [
  {
    name: 'download GET /api/logs/export/csv',
    prepare: () => null,
    request: (token) => fetch(`${API_URL}/api/logs/export/csv`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  },
  {
    name: 'import POST /api/import/validate',
    prepare: () => buildImportCsv(IMPORT_ROWS),
    request: (token, csv) => {
      const form = new FormData();
      form.append('dataType', 'patients');
      form.append('file', new Blob([csv], { type: 'text/csv' }), 'rnf001-import.csv');
      return fetch(`${API_URL}/api/import/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
    },
  },
];

results.separatelyMeasured = {};
for (const item of separate) {
  if (!authed) {
    results.separatelyMeasured[item.name] = { measured: false, reason: 'auth_required_but_login_failed' };
    continue;
  }
  const payload = item.prepare();
  const samples = [];
  const errors = [];
  let bytes = payload === null ? null : Buffer.byteLength(payload);
  for (let i = 0; i < SEPARATE_N; i += 1) {
    try {
      const t0 = Date.now();
      const res = await item.request(session.token, payload);
      const body = await res.arrayBuffer();
      const ms = Date.now() - t0;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (payload === null) bytes = body.byteLength;
      samples.push(ms);
      console.error(`[rnf001] ${item.name} sample ${i + 1}/${SEPARATE_N}: ${ms}ms`);
    } catch (err) {
      errors.push(String(err?.message || err));
      console.error(`[rnf001] ${item.name} sample ${i + 1}/${SEPARATE_N} FAIL: ${errors[errors.length - 1]}`);
    }
  }
  // Same ranking as the routes: a failed sample counts as Infinity.
  const sorted = [...samples].sort((a, b) => a - b).concat(errors.map(() => Infinity));
  const finite = (v) => (Number.isFinite(v) ? v : null);
  const entry = {
    samples,
    p50: finite(percentile(sorted, 50)),
    p95: finite(percentile(sorted, 95)),
    max: finite(sorted[sorted.length - 1]),
    bytes,
    failedSamples: errors.length,
    measured: samples.length === SEPARATE_N && errors.length === 0,
  };
  if (errors.length) entry.errors = errors;
  results.separatelyMeasured[item.name] = entry;
}

// Positive evidence only: a missing entry or one not measured fails the run.
results.overallPass = routesPass
  && separate.every((item) => results.separatelyMeasured[item.name]?.measured === true);

await browser.close();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
process.exit(results.overallPass ? 0 : 2);
