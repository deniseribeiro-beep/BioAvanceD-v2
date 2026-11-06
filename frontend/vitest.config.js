import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  // #1019: vite.config.js loads @vitejs/plugin-react and this config did not,
  // so .jsx went through the CLASSIC JSX transform under vitest and emitted
  // React.createElement with no React binding in scope. 6 of the 7 .jsx files
  // under src/ have no default React import, so every RTL render of a view
  // mounting one threw ReferenceError: React is not defined.
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Wizard / multi-step RTL suites need headroom under full-suite load.
    testTimeout: 15_000,
    passWithNoTests: false,
    setupFiles: ['./tests/unit/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
      'tests/unit/**/*.{test,spec}.{js,jsx,ts,tsx}',
    ],
    exclude: [
      'node_modules/**',
      'tests/e2e/**',
      'tests/support/**',
      'playwright-report/**',
      'test-results/**',
      'traces/**',
      'dist/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'lcov'],
      reportsDirectory: 'coverage',
      // Count every source file, not only the ones a test imports (#1443).
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});
