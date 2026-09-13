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

// #973: NOT EVALUATED BY THIS FILE, DELIBERATELY. The only test below passes
// REQUIRED_FORBIDDEN to both collectHits calls; this array is never read here.
// That is correct, and adding a term to it expecting enforcement is the trap
// this comment exists to close.
//
// These 17 names ARE enforced, live, in the position where they mean
// something: filter-keys.arch.test.js copies this list verbatim as
// RETIRED_FILTER_KEYS (:162-180, provenance at :150-161) and fails any of
// them appearing as a `.find`/`.findOne` filter key, with a line-keyed
// RETIRED_KEY_EXEMPT allowlist for documented legacy-resolution sites.
// **Add new terms there, not here.**
//
// They cannot be enforced as substrings the way REQUIRED_FORBIDDEN is, and
// the measurement is on #973: 156 hits across 82 distinct files, zero of the
// 17 at a count of 0. `sampleId` alone is 44 files and is mostly route params
// and React props -- public API surface, not field drift -- while
// `patientId`'s hits are largely `patientIds` and `patientIdentifier`. Worse,
// a substring guard flags the prohibition's own machinery: stripComments
// deliberately preserves string literals (see :61), so sample.routes.js's
// NON_CANONICAL_SAMPLE_ALIASES -- the array whose entire job is rejecting
// these names -- contains 7 of the 17 as literals and would fail.
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
