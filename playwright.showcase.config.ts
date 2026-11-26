import { defineConfig, devices } from '@playwright/test';

// Records every test (pass or fail) for a human-facing showcase reel — the
// main config only keeps video on failure. Not used by any CI/gate path;
// run manually via test:e2e:docker-style env vars against a live stack.
// testDir points at tests/e2e-showcase/, not tests/e2e/ — showcase specs are
// deliberately kept out of the directory the main playwright.config.ts (and
// CI's bare `playwright test`) discovers.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e-showcase',
  // Longer than the default 30s -- the Wave 2 reel's beat() pauses alone
  // sum to ~30s across its 3 segments (login, organizations, collections).
  // The Wave 3 reel adds a 4th test (login, RF014 security, RF017
  // equipment, RF016 labeling) whose own beats sum to ~30s on top of real
  // participant/sample/equipment backend round trips -- 60s was too tight
  // for that combination, bumped to 120s.
  timeout: 120_000,
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
    // Recorded at the viewport's own size rather than Playwright's default
    // fit-to-800x800, which downscales 1280x720 to 800x450 and leaves small
    // text unreadable. A larger size does not sharpen it: the screencast
    // frames stay at CSS pixels whatever the device scale factor, and a
    // 1920x1080 size only pads them with grey.
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
});
