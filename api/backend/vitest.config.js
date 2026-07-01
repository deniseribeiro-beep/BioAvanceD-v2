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
      reportOnFailure: true,
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      exclude: ['**/node_modules/**', 'tests/**', 'src/seeders/**'],
      thresholds: {
        statements: 25,
        branches: 25,
        functions: 27,
        lines: 25,
      },
    },
    exclude: [
      '**/node_modules/**',
      'tests/setup.test.js',
      'tests/unit/authConsent.test.js',
      'tests/unit/security.test.js',
      'tests/integration/auth-login.node.test.js',
      'tests/integration/auth-session.node.test.js',
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
