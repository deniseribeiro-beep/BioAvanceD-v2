import { chromium } from '@playwright/test';
import type { FullConfig } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { mockLogin } from './helpers/mockAuth';

// #819: Playwright global setup -- warms every lazy-loaded route once.
//
// Every page in frontend/src/App.tsx is `lazy(() => import(...))`. Under the
// Vite dev server (`frontend-app-test`), a chunk is transformed on its
// *first* request, not at server start. Whichever spec happens to visit a
// given route first pays that compile cost, and can exceed the 5s `expect`
// timeout configured in playwright.config.ts -- which then reads as a
// missing UI element rather than what it actually is: a compile stall. This
// is per-*route*, not per-server-start; a confirmed instance surfaced 215
// tests into a run, on a route no earlier spec happened to touch.
//
// The fix is to pre-visit every route once, before any spec runs, so the
// on-demand compile happens here instead of inside a test's timeout budget.
//
// Authentication matters for this to actually warm anything: React.lazy only
// fetches a chunk when the component *renders*. A protected route visited
// unauthenticated redirects to /login before its element renders, so the
// chunk is never requested -- an unauthenticated warm-up would silently warm
// the login page N times and nothing else. mockLogin (helpers/mockAuth.ts)
// seeds localStorage with a token before navigation so ProtectedRoute lets
// the real element through on first render.
//
// Known limitations, recorded rather than solved here:
//   - /next/* (FoundationApp) may itself nest further lazy routes below the
//     shell; visiting the FoundationApp entry point once does not warm those
//     inner chunks.
//   - A route added to App.tsx but not mirrored into ROUTES_TO_WARM below is
//     silently left cold -- this list is not derived from App.tsx at runtime.

// Keep this list in step with the `lazy(() => import(...))` declarations in
// frontend/src/App.tsx (39 as of #819). One concrete path per distinct lazy
// chunk; where a path takes a route param, a syntactically valid placeholder
// is used -- the chunk loads because the element renders, not because the id
// resolves to real data.
const ROUTES_TO_WARM: readonly string[] = [
  '/patient/e-consent',
  '/patient/e-consent/warmup-token',
  '/patient/e-consent/import/warmup-token',
  '/login',
  '/dashboard',
  '/patients',
  '/patients/import-fhir',
  '/patients/1/consent',
  '/import/quarantine',
  '/import/lgpd',
  '/samples',
  '/samples/1',
  '/results',
  '/users/new',
  '/users/new/success',
  '/logs',
  '/logs/1',
  '/samples/1/label',
  '/samples/1/chain',
  '/samples/1/movements',
  '/samples/withdrawal-return',
  '/samples/custody-reports',
  '/facility-management',
  '/system-management',
  '/reports',
  '/reports/1',
  '/reports/query/summary',
  '/reports/templates',
  '/quality-descriptions',
  '/import',
  '/backup',
  '/user/security',
  '/mfa-setup',
  '/reset-password',
  '/settings/parameters',
  '/admin/dicionario',
  '/admin/tcle/new',
  '/next/warmup',
  '/next/intake',
];

// Number of pages warming routes concurrently. Kept small and fixed -- this
// runs once before the suite, not per-test, so there is no need to tune it.
const CONCURRENCY = 4;

// #894: ROUTES_TO_WARM is hand-maintained, so a route added to App.tsx and not
// mirrored here is silently left cold -- and the symptom is #819's, which by
// then reads as 'already fixed' and gets misattributed. This does not verify
// the paths (it cannot; the params are placeholders), only that nobody added a
// lazy chunk without considering the warm list. Best-effort: if App.tsx is not
// readable -- e.g. inside playwright-runner, where the frontend source may not
// be present -- the check is skipped rather than failing the run.
function warnIfWarmListDrifted(): void {
  try {
    const appTsx = readFileSync(
      resolvePath(__dirname, '..', '..', 'frontend', 'src', 'App.tsx'),
      'utf-8'
    );
    const LAZY_MARKER = 'lazy(() => import(';
    const lazyCount = appTsx.split(LAZY_MARKER).length - 1;
    if (lazyCount !== ROUTES_TO_WARM.length) {
      console.warn(
        `[global-setup #894] warm-list drift: frontend/src/App.tsx declares ${lazyCount} `
        + `lazy chunks but ROUTES_TO_WARM has ${ROUTES_TO_WARM.length} entries. `
        + 'A route added to App.tsx without an entry here stays cold and flakes per #819.'
      );
    }
  } catch {
    // App.tsx not reachable from here; skip silently.
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  // Single-spec iteration (running one file directly) has no need to pay the
  // warm-up cost every time.
  warnIfWarmListDrifted();

  if (process.env.E2E_SKIP_WARMUP === '1') {
    return;
  }

  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

  // Best-effort throughout: a warm-up that breaks the suite is worse than the
  // flake it fixes. Any unexpected failure here -- browser launch included --
  // is caught and logged rather than thrown.
  try {
    const browser = await chromium.launch();

    try {
      const queue = [...ROUTES_TO_WARM];

      const warmNext = async (): Promise<void> => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          try {
            await mockLogin(page);

            let route = queue.shift();
            while (route !== undefined) {
              try {
                // Two-step, and both steps are load-bearing.
                //
                // 'domcontentloaded' alone is too early: React.lazy fires its
                // import() only after the app boots and renders, which is strictly
                // after DOMContentLoaded, so returning there navigates away
                // mid-chunk-fetch and warms nothing.
                //
                // 'networkidle' as the goto condition is worse -- it never fires at
                // all. The Vite dev server holds an open HMR websocket, so the
                // network is never idle and every route burns its full timeout.
                // Measured 2026-08-29 on the first real gate run: 30 of 39 routes
                // timed out at 15s and the warm-up was inert.
                //
                // So: return at domcontentloaded, then give the chunk a bounded
                // window to be requested and transformed. The wait is expected to
                // time out (HMR again) -- that is fine, the point is the dwell, and
                // the catch keeps it from ever throwing.
                await page.goto(`${baseURL}${route}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
                await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
              } catch (navigationError) {
                // A single route failing to load must not fail the run.
                console.warn(`[global-setup #819] warm-up navigation failed for ${route}:`, navigationError);
              }
              route = queue.shift();
            }
          } finally {
            await page.close();
          }
        } finally {
          await context.close();
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, () => warmNext()));
    } finally {
      await browser.close();
    }
  } catch (setupError) {
    console.warn('[global-setup #819] route warm-up failed; continuing without it:', setupError);
  }
}
