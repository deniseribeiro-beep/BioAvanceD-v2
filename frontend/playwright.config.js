const { defineConfig } = require('@playwright/test');
const path = require('path');

const auditDir = path.resolve(__dirname, '../reports/system-audit/playwright');

module.exports = defineConfig({
  testDir: './playwright/tests',
  timeout: 60_000,
  outputDir: path.join(auditDir, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(auditDir, 'results.json') }],
    ['html', { outputFolder: path.join(auditDir, 'html'), open: 'never' }],
  ],
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: __dirname,
  },
});
