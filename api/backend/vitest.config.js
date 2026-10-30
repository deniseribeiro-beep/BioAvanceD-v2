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
      // The stock v8 provider misreads files loaded through `require` (#1337).
      provider: 'custom',
      customProviderModule: './tests/support/coverage-native-require.mjs',
      reportOnFailure: true,
      reporter: ['text', 'html', 'json', 'json-summary', 'lcov'],
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
      // node:test-only (#375): these call node:test's own `test()`, not
      // vitest's, so vitest sees "no test suite found" if it picks them up.
      'tests/architecture/**',
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
