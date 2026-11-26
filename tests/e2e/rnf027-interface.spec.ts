import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { mockLogin } from './helpers/mockAuth';
import { realAuthLogin } from './helpers/realAuth';

// RNF027 C1 (essential navigation by keyboard), C2 (visible focus and
// associated messages), C4 (the browser matrix: the config runs this spec in
// Chromium, Firefox and WebKit) and C5 (the institutional viewports), #1324.
// The shell cases log in for real when PLAYWRIGHT_API_BASE_URL is set and
// seed a mock session otherwise, so the spec runs in both modes.

// Prefer the permanent desktop aside — a closed Sheet may still leave a
// second `nav.sidebar-nav` in the DOM that is not visible, and Playwright's
// strict first-match then times out on toBeVisible (#1440 follow-up).
const DESKTOP_SECURITY_LINK = 'aside#app-sidebar nav.sidebar-nav a[href="/user/security"]';
const MOBILE_SECURITY_LINK =
  '[role="dialog"] nav.sidebar-nav a[href="/user/security"], [data-state="open"] nav.sidebar-nav a[href="/user/security"]';
const LANGUAGE_SELECT = '[data-testid="language-selector-container"] select';

async function authenticate(request: APIRequestContext, page: Page): Promise<void> {
  if (process.env.PLAYWRIGHT_API_BASE_URL) {
    await realAuthLogin(request, page);
  } else {
    await mockLogin(page);
  }
}

// An outline or a box-shadow on the focused element counts as a visible focus.
// Polled, because .input animates its box-shadow over 0.2 s. A failure names
// the focused control and its computed focus style (#1409).
async function expectVisibleFocus(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return `no focused control (${el ? 'body' : 'null'})`;
          const style = window.getComputedStyle(el);
          if (
            (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
            style.boxShadow !== 'none'
          ) {
            return '';
          }
          const testId = el.getAttribute('data-testid');
          return [
            el.tagName.toLowerCase(),
            testId ? `data-testid="${testId}"` : '',
            `class="${el.getAttribute('class') ?? ''}"`,
            `outlineStyle=${style.outlineStyle}`,
            `outlineWidth=${style.outlineWidth}`,
            `boxShadow=${style.boxShadow}`,
          ]
            .filter(Boolean)
            .join(' ');
        }),
      { message: 'the focused control shows an outline or a box-shadow' }
    )
    .toBe('');
  await expect(page.locator(':focus')).toHaveAccessibleName(/\S/);
}

test.describe('RNF027 interface', () => {
  test('login form is operable by keyboard alone and announces its error', async ({ page, browserName }) => {
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Credenciais invalidas', message: 'x' }),
      });
    });

    await page.goto('/login');
    await expect(page.getByTestId('login-username-input')).toBeFocused();
    await page.keyboard.type('keyboard-user');
    await page.keyboard.press(tab);
    await expect(page.getByTestId('login-password-input')).toBeFocused();
    await page.keyboard.type('wrong-password');

    const loginRequest = page.waitForRequest('**/api/auth/login');
    await page.keyboard.press('Enter');
    await loginRequest;

    // The error element is itself the alert, so a screen reader announces it.
    await expect(page.getByRole('alert').and(page.getByTestId('login-error'))).toBeVisible();
  });

  test('every control reached by Tab on the login page shows a visible focus', async ({ page, browserName }) => {
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await page.goto('/login');
    await expect(page.getByTestId('login-username-input')).toBeFocused();
    await expectVisibleFocus(page);

    const select = page.locator(LANGUAGE_SELECT);
    let reached = false;
    for (let i = 0; i < 15; i += 1) {
      await page.keyboard.press(tab);
      await expectVisibleFocus(page);
      if (await select.evaluate((el) => el === document.activeElement)) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
  });

  test('the sidebar navigation is reachable and operable by keyboard', async ({ page, request, browserName }) => {
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await page.setViewportSize({ width: 1366, height: 768 });
    await authenticate(request, page);
    await page.goto('/dashboard');

    const link = page.locator(DESKTOP_SECURITY_LINK);
    await expect(link).toBeVisible();
    await link.scrollIntoViewIfNeeded();

    // Start inside the desktop aside so header/chrome tab stops do not
    // exhaust the budget before /user/security (Firefox was the outlier).
    const firstNav = page.locator('aside#app-sidebar nav.sidebar-nav a').first();
    await firstNav.focus();
    await expect(firstNav).toBeFocused();

    let reached = false;
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press(tab);
      await expectVisibleFocus(page);
      if (await link.evaluate((el) => el === document.activeElement)) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/user\/security$/);
  });

  test('the layout has no horizontal overflow at the institutional viewports', async ({ page, request }) => {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
    ];
    const noOverflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/login');
      await expect(page.getByTestId('login-form')).toBeVisible();
      expect(await noOverflow(), `/login at ${viewport.width}x${viewport.height}`).toBe(true);
    }

    await authenticate(request, page);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/dashboard');
      const toggle = page.locator('button.sidebar-toggle');
      await expect(page.locator('aside#app-sidebar nav.sidebar-nav')).toBeAttached();
      expect(await noOverflow(), `/dashboard at ${viewport.width}x${viewport.height}`).toBe(true);

      // xl = 1280px: desktop aside visible; 1024 uses the sheet toggle.
      if (viewport.width >= 1280) {
        await expect(toggle).toBeHidden();
        await expect(page.locator(DESKTOP_SECURITY_LINK)).toBeVisible();
      } else {
        await expect(toggle).toBeVisible();
        await toggle.click();
        await expect(page.locator(MOBILE_SECURITY_LINK).first()).toBeVisible();
      }
    }
  });
});
