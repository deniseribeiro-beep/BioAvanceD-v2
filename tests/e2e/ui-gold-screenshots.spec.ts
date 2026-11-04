import { test } from '@playwright/test';
import path from 'node:path';
import { realAuthLogin } from './helpers/realAuth';

/**
 * Full-page visual evidence for the TailAdmin Sectioned / BioAvanceD gold UI.
 * Artifacts land under test-results/ui-gold-screenshots (and can be copied to docs/evidencias).
 */
const OUT = path.join('test-results', 'ui-gold-screenshots');

const ROUTES: { name: string; path: string; auth?: boolean }[] = [
  { name: '01-login', path: '/login', auth: false },
  { name: '02-dashboard', path: '/dashboard', auth: true },
  { name: '03-facility-equipment', path: '/facility-management?tab=equipment', auth: true },
  { name: '04-facility-temperature', path: '/facility-management?tab=temperature', auth: true },
  { name: '05-tcle-builder', path: '/admin/tcle/new', auth: true },
  { name: '06-consents', path: '/consents', auth: true },
  { name: '07-samples', path: '/samples', auth: true },
  { name: '08-patients', path: '/patients', auth: true },
  { name: '09-system-management', path: '/system-management?tab=users', auth: true },
];

test.describe('UI gold fullPage screenshots', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const route of ROUTES) {
    test(`screenshot ${route.name}`, async ({ page, request }) => {
      test.setTimeout(120_000);
      if (route.auth !== false) {
        await realAuthLogin(request, page);
      }
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(OUT, `${route.name}.png`),
        fullPage: true,
      });
    });
  }
});
