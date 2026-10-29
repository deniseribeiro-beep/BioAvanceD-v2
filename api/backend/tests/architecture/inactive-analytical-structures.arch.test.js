// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1318, RF029 AC8 and RNF030 C2-C5: the analytical-preparation entities are
// inactive structures. Each is modelled and catalog-conformant (see
// canonical-catalog-conformance.arch.test.js), and no flow loads or writes
// it, because AC8 permits them only in authorized and versioned scientific
// use and no such flow exists yet (see
// docs/decisions/2026-10-22-inactive-analytical-preparation-structures.md).
//
// This test fails the day a backend file requires one of the seven models or
// names the collection a flow would write it to. The flow that activates one
// removes it from INACTIVE in the same change, with its gate.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const { readStripped, stripComments } = require('./helpers/strip-comments');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const SCANNED_DIRS = ['src', 'scripts'].map((dir) => path.join(BACKEND_ROOT, dir));

// Model stem -> the collection name a future flow would use.
const INACTIVE = {
  DatasetSnapshot: 'datasetSnapshots',
  DatasetPartition: 'datasetPartitions',
  FeatureDefinition: 'featureDefinitions',
  LabelDefinition: 'labelDefinitions',
  CohortDefinition: 'cohortDefinitions',
  DeidentificationProcess: 'deidentificationProcesses',
  DatasetRepresentativenessAssessment: 'datasetRepresentativenessAssessments',
};

const MODEL_FILES = new Set(Object.keys(INACTIVE).map((stem) => `src/models/${stem}.js`));
const STEMS = Object.keys(INACTIVE).join('|');
const COLLECTIONS = Object.values(INACTIVE).join('|');

const MODULE_LOAD = new RegExp(
  `(?:\\brequire\\s*\\(\\s*|\\bimport\\s[^;]*?\\bfrom\\s*)(['"\`])[^'"\`]*/(?:${STEMS})(?:\\.js)?\\1`,
  'g'
);
const COLLECTION_CALL = new RegExp(
  `\\b(?:collection|getCollection)\\s*\\([^)]*?(['"\`])(?:${COLLECTIONS})\\1`,
  'g'
);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const relative = (file) => path.relative(BACKEND_ROOT, file).split(path.sep).join('/');

function sources() {
  return SCANNED_DIRS.flatMap((dir) => walk(dir))
    .map((file) => ({ file: relative(file), text: readStripped(fs, file) }));
}

// The places a piece of stripped source loads an inactive model or names its
// collection, as the matched text.
function inactiveUses(text) {
  return [...text.matchAll(MODULE_LOAD), ...text.matchAll(COLLECTION_CALL)].map((match) => match[0]);
}

test('no backend flow loads or writes an inactive analytical-preparation entity (RF029 AC8, RNF030)', () => {
  const violations = sources()
    .filter(({ file }) => !MODEL_FILES.has(file))
    .flatMap(({ file, text }) => inactiveUses(text).map((use) => `${file}: ${use}`));
  assert.deepEqual(
    violations,
    [],
    'these entities are inactive structures (RF029 AC8, RNF030, #1318). A flow that activates one removes it '
      + 'from INACTIVE in the same change, together with its authorized and versioned scientific-use gate:\n'
      + violations.join('\n')
  );
});

// Floor: a walk that silently reads nothing would pass the case above.
test('the scan reads the backend source tree (at least 500 files)', () => {
  const count = sources().length;
  assert.ok(count >= 500, `only ${count} files read under src and scripts`);
});

// Control: the matchers flag a model load or a collection call, and pass a
// shorter or longer module name, a row key or a comment, so an empty
// violation list above is not a matcher that sees nothing.
test('control: an inactive model load or collection call is flagged, other uses are not', () => {
  assert.equal(inactiveUses("const S = require('../models/DatasetSnapshot');").length, 1);
  assert.equal(inactiveUses('const F = require("./FeatureDefinition.js");').length, 1);
  assert.equal(inactiveUses("db.collection('datasetPartitions').insertOne(x)").length, 1);
  assert.equal(inactiveUses('const l = await getCollection(db, "labelDefinitions");').length, 1);
  assert.deepEqual(inactiveUses("const D = require('../models/Dataset');"), []);
  assert.deepEqual(inactiveUses("const V = require('./DatasetSnapshotView');"), []);
  assert.deepEqual(inactiveUses("rowKey: 'datasetSnapshots'"), []);
  assert.deepEqual(inactiveUses(stripComments("// const S = require('../models/DatasetSnapshot');")), []);
});
