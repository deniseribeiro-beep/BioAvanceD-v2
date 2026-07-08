const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOTS = [
  path.resolve(__dirname, '../../src'),
  path.resolve(__dirname, '../../../../frontend/src')
];

const FORBIDDEN = [
  'COLLECTION_ALIASES',
  'resolveSourceCollectionName',
  'patientID',
  'patientId',
  'sampleID',
  'sampleId',
  'registerDate',
  'registrationDate',
  'currentStatus',
  'tcle_id',
  'merkle_root',
  'legacy_compat',
  'quality_score',
  'quality_category',
  'penalty_log',
  'medication_name',
  'drug_name',
  'patients_fhir',
  'FromLegacy',
  'FhirFirst'
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

test('blocks legacy aliases in executable code', () => {
    const hits = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const content = fs.readFileSync(file, 'utf8');
        for (const term of FORBIDDEN) {
          if (content.includes(term)) {
            hits.push({ file, term });
          }
        }
      }
    }
    assert.deepEqual(hits, []);
});
