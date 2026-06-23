import { defineConfig, devices } from './frontend/node_modules/@playwright/test';

export default defineConfig({
  testDir: './tests/poc/e2e',
  outputDir: 'validation-evidence/test-results',
  timeout: 30 * 1000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'validation-evidence/playwright-report' }],
    ['json', { outputFile: 'validation-evidence/playwright-report/results.json' }],
    ['junit', { outputFile: 'validation-evidence/playwright-report/results.xml' }],
  ],
  webServer: {
    command: 'npm --prefix frontend run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
