const path = require('path');
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  resolve: {
    alias: {
      basic: path.resolve(__dirname, 'tests/reporters/basic.js'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    reporters: ['default'],
    setupFiles: ['./tests/vitest.setup.js'],
    fileParallelism: false,
    isolate: true,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      },
    },
    exclude: [
      '**/node_modules/**',
      'tests/setup.test.js',
      'tests/e2e/**',
      'e2e/**',
      'playwright-report/**',
      'test-results/**',
      'reports/**',
      'traces/**',
      'dist/**',
      '../../frontend/dist/**'
    ]
  }
});
