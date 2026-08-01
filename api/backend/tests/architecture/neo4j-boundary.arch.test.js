// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

test('avoids direct driver session writes in patient service', () => {
    const file = path.resolve(__dirname, '../../src/services/patient.service.js');
    const content = fs.readFileSync(file, 'utf8');
    assert.strictEqual(content.includes('neo4jDriver.session'), false);
});

test('uses canonical payload names in neo4j projection', () => {
    const file = path.resolve(__dirname, '../../src/services/neo4jCanonicalProjection.service.js');
    const content = fs.readFileSync(file, 'utf8');
    assert.strictEqual(content.includes('patientID'), false);
    assert.strictEqual(content.includes('sampleID'), false);
    assert.strictEqual(content.includes('mongoSampleId'), false);
});
