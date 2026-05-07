import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: [
      'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
      'tests/**/*.{test,spec}.{js,jsx,ts,tsx}',
    ],
    exclude: [
      'node_modules/**',
      'tests/e2e/**',
      'e2e/**',
      'playwright-report/**',
      'test-results/**',
      'traces/**',
      'dist/**',
    ],
  },
});
