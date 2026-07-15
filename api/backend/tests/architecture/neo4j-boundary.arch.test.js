import { test, expect } from 'vitest';

const fs = require('fs');
const path = require('path');

test('avoids direct driver session writes in patient service', () => {
    const file = path.resolve(__dirname, '../../src/services/patient.service.js');
    const content = fs.readFileSync(file, 'utf8');
    expect(content.includes('neo4jDriver.session')).toBe(false);
});

test('uses canonical payload names in neo4j projection', () => {
    const file = path.resolve(__dirname, '../../src/services/neo4jCanonicalProjection.service.js');
    const content = fs.readFileSync(file, 'utf8');
    expect(content.includes('patientID')).toBe(false);
    expect(content.includes('sampleID')).toBe(false);
    expect(content.includes('mongoSampleId')).toBe(false);
});
