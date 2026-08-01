// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const FILES = [path.resolve(__dirname, '../../src')];

const FORBIDDEN = ['patients_fhir', 'samples_fhir', 'consents_fhir', 'FromLegacy', 'FhirFirst', 'syncAllLegacyData', 'models/fhir', 'models/Observation', 'fhir-sync.service'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage', 'docs'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !full.includes('fhir-boundary.arch.test.js')) {
      out.push(full);
    }
  }
  return out;
}

test('does not contain legacy FHIR persistence references', () => {
  const hits = [];
  for (const root of FILES) {
    for (const file of walk(root)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const term of FORBIDDEN) {
        if (content.includes(term)) hits.push({ file, term });
      }
    }
  }
  assert.deepStrictEqual(hits, []);
});
