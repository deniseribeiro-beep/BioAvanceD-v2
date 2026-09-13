// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { stripComments } = require('./helpers/strip-comments');

// #945: this guard forbids the literals `patientID`, `sampleID` and
// `mongoSampleId` — which are exactly the legacy aliases the #795/#803/#804/
// #940 family exists to retire. Matching raw text made it impossible to write,
// in the guarded file, the sentence explaining why the alias is not used
// there. Prose is blanked before matching; real identifiers still count.
function read(file) {
    return stripComments(fs.readFileSync(file, 'utf8'));
}

test('avoids direct driver session writes in patient service', () => {
    const file = path.resolve(__dirname, '../../src/services/patient.service.js');
    assert.strictEqual(read(file).includes('neo4jDriver.session'), false);
});

test('uses canonical payload names in neo4j projection', () => {
    const file = path.resolve(__dirname, '../../src/services/neo4jCanonicalProjection.service.js');
    const content = read(file);
    assert.strictEqual(content.includes('patientID'), false);
    assert.strictEqual(content.includes('sampleID'), false);
    assert.strictEqual(content.includes('mongoSampleId'), false);
});
