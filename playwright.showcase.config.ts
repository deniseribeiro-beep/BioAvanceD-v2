import { defineConfig, devices } from '@playwright/test';

// Records every test (pass or fail) for a human-facing showcase reel — the
// main config only keeps video on failure. Not used by any CI/gate path;
// run manually via test:e2e:docker-style env vars against a live stack.
// See tests/e2e/README-showcase.md (if present) or the session that
// produced showcase.mp4 for the exact clip list and ffmpeg concat step.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'off',
    video: 'on',
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
