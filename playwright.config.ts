// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

// In docker mode, docker-compose already starts frontend+backend with healthchecks,
// so Playwright shouldn't also try to spawn `npm run dev`.
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './playwright/global.setup.ts',
  testMatch: [
    '**/*.spec.ts',
    '**/*.spec.js',
    '**/*.test.ts',
    '**/*.test.js',
  ],
  outputDir: 'playwright-report',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
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
    trace: 'on-first-retry',
    storageState: 'playwright/.auth/user.json',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'playwright/.auth/user.json',
      },
    },
  ],
  ignore: [
    '**/node_modules/**',
    '**/dist/**',
    '**/playwright.config.*',
    '**/tsconfig.*',
    '**/vite.config.*',
    '**/package.json',
    '**/.*.js',
  ],
});
