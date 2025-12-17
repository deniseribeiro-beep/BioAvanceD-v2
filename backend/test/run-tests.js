// Minimal test runner: require additional test files here
const path = require('path');

console.log('Running backend tests...');

// Add tests as they are created
require('./merkleTree.test.js');

console.log('All tests executed.');
