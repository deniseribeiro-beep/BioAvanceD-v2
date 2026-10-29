import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// In docker mode, docker-compose already starts frontend+backend with healthchecks,
// so Playwright shouldn't also try to spawn `npm run dev`.
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker everywhere, not only on CI (#1174). Every spec shares one
  // backend and one database, and several seed global singletons such as the
  // active consent template, so parallel workers race each other's fixtures.
  // Pass --workers=N to override for a run you know is isolated.
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['junit', { outputFile: 'playwright-report/results.xml' }],
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: 'npm run dev',
        cwd: './frontend',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // RNF027 C4 (#1324): the interface spec also runs in Firefox and WebKit;
    // every other spec stays Chromium-only.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /rnf027-interface\.spec\.ts$/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /rnf027-interface\.spec\.ts$/ },
  ],
});
