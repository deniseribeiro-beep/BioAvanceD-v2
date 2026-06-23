import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/poc/**/*.{test,spec}.{ts,js}'],
    exclude: ['node_modules/**', 'frontend/**', 'api/**', 'playwright-report/**', 'test-results/**', 'validation-evidence/**', 'dist/**'],
    setupFiles: ['./tests/poc/setup.ts'],
    fileParallelism: false,
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'lcov'],
      reportsDirectory: 'validation-evidence/coverage',
    },
  },
});
