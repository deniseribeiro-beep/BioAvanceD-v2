import { test, expect, Page, APIRequestContext, Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockLogin } from './helpers/mockAuth';
import { realAuthLogin } from './helpers/realAuth';

// RNF027 C2 (labelled fields, visible focus, adequate contrast, associated
// messages), #1324: an axe scan with the WCAG 2.1 AA tags of /login and of
// eight core pages among the administrator's sidebar destinations. The
// authenticated cases log in for real when PLAYWRIGHT_API_BASE_URL is set and
// seed a mock session otherwise, so the spec runs in both modes.

const SECURITY_LINK = 'nav.sidebar-nav a[href="/user/security"]';
const WCAG21AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function authenticate(request: APIRequestContext, page: Page): Promise<void> {
  if (process.env.PLAYWRIGHT_API_BASE_URL) {
    await realAuthLogin(request, page);
  } else {
    await mockLogin(page);
  }
}

async function expectNoViolation(page: Page, path: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG21AA_TAGS).analyze();
  expect(
    violations.map((v) => ({
      rule: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target.join(' ')),
    })),
    `axe violations on ${path}`
  ).toEqual([]);
}

// A page's loading text (common.loading, patients.loading and the pages'
// literal Carregando...) in any of the three languages.
const loadingText = (page: Page): Locator =>
  page.getByRole('main').getByText(/^(Carregando|Loading|Cargando)\b/);

// Each page's own heading, or its own testid where it renders no h1; most
// render it before their reads settle, so the scan also waits until the
// page's loading markers are gone (busy), or it would scan the loading state.
const PAGES: { path: string; ready: (page: Page) => Locator; busy?: (page: Page) => Locator; timeout?: number }[] = [
  {
    path: '/dashboard',
    ready: (page) => page.locator('h1.page-title'),
    // Its KPI cards read '...' while the counts load.
    busy: (page) => loadingText(page).or(page.locator('.kpi-value', { hasText: /^\.\.\.$/ })),
  },
  { path: '/patients', ready: (page) => page.locator('h1.page-title'), busy: loadingText },
  { path: '/samples', ready: (page) => page.getByTestId('samples-view-switch'), busy: loadingText },
  { path: '/results', ready: (page) => page.locator('h1.page-title'), busy: loadingText },
  { path: '/facility-management', ready: (page) => page.locator('h1.page-title'), busy: loadingText },
  { path: '/reports', ready: (page) => page.locator('h1.page-title') },
  // The page shows a skeleton until its four reads settle; with no backend
  // (mock mode) each refused read first probes ports 3001-3005 (api.ts).
  { path: '/user/security', ready: (page) => page.getByTestId('security-page-title'), timeout: 20_000 },
  { path: '/system-management', ready: (page) => page.locator('h1.page-title'), busy: loadingText },
];

test.describe('RNF027 axe scan', () => {
  test('axe: /login has no WCAG 2.1 AA violation', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-form')).toBeVisible();
    await expectNoViolation(page, '/login');
  });

  for (const { path, ready, busy, timeout } of PAGES) {
    test(`axe: ${path} has no WCAG 2.1 AA violation`, async ({ page, request }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await authenticate(request, page);
      await page.goto(path);
      // The app shows its lazy-load placeholder until the dev server has
      // compiled the shell and this page's chunk, which a cold server under
      // load can take past the default 5 s to do.
      await expect(page.locator(SECURITY_LINK)).toBeVisible({ timeout: 20_000 });
      await expect(ready(page)).toBeVisible({ timeout });
      if (busy) await expect(busy(page)).toHaveCount(0, { timeout: 20_000 });
      await expectNoViolation(page, path);
    });
  }
});
