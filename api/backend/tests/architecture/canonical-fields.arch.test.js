// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { stripComments } = require('./helpers/strip-comments');

const BACKEND_ROOT = path.resolve(__dirname, '../../src');
const FRONTEND_ROOT = path.resolve(__dirname, '../../../../frontend/src');

const REQUIRED_FORBIDDEN = [
  'COLLECTION_ALIASES',
  'resolveSourceCollectionName',
  'patients_fhir',
  'samples_fhir',
  'consents_fhir',
  'FromLegacy',
  'FhirFirst',
  'fhir-sync.service',
];

const ASPIRATIONAL_FORBIDDEN = [
  'patientID',
  'patientId',
  'sampleID',
  'sampleId',
  'registerDate',
  'registrationDate',
  'currentStatus',
  'tcle_id',
  'selected_tcle',
  'merkle_root',
  'legacy_compat',
  'quality_score',
  'quality_category',
  'penalty_log',
  'medication_name',
  'drug_name',
  'clinical_data',
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage', 'docs'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !full.includes('canonical-fields.arch.test.js')) {
      out.push(full);
    }
  }
  return out;
}

// #945: a comment naming a retired alias is documentation, not a use of it.
// Prose is blanked before matching; identifiers and string literals still hit.
function collectHits(root, terms) {
  const hits = [];
  for (const file of walk(root)) {
    const content = stripComments(fs.readFileSync(file, 'utf8'));
    for (const term of terms) {
      if (content.includes(term)) {
        hits.push({ file, term });
      }
    }
  }
  return hits;
}

test('blocks legacy collection aliases and retired FHIR persistence', () => {
  const hits = [
    ...collectHits(BACKEND_ROOT, REQUIRED_FORBIDDEN),
    ...collectHits(FRONTEND_ROOT, REQUIRED_FORBIDDEN),
  ];
  assert.deepStrictEqual(hits, []);
});
