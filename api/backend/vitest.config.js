const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/vitest.setup.js'],
    exclude: [
      '**/node_modules/**',
      'tests/setup.test.js',
      'tests/merkleTree.test.js',
      'tests/unit/authConsent.test.js',
      'tests/unit/security.test.js',
      'tests/integration/auth-login.node.test.js',
      'tests/integration/auth-session.node.test.js'
    ]
  }
});
