// Minimal test runner: require additional test files here
const path = require('path');

process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'test-consent-secret';

console.log('Running backend tests...');

// Add tests as they are created
require('./merkleTree.test.js');

// Integration Tests
require('./integration/patients-integration.test.js');

console.log('All tests executed.');

