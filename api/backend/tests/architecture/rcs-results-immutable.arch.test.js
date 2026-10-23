// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1320, RF018 AC10: the inputs are frozen and the results are not
// editable. An RCSAssessment, its RCSInputSnapshot and its
// RCSGovernanceEvidenceSnapshot are appended once by
// rcs-assessment.service.js#recordAssessment, and the only other writes are
// that function's compensation, which deletes a snapshot or an evidence
// record by its own id when a later insert of the same append fails.
// collections.js and env.js only name the collections, and the essential
// reference seed only counts them.
//
// This test fails the day a file outside that list names one of the three
// collections, or the day rcs-assessment.service.js makes a write other
// than those three inserts and two compensation deletes. It reads dotted
// calls only (`.updateOne(`): a bracket call (`c['updateOne'](`) or a
// computed method name is not seen, and a compensation delete is checked by
// the key it opens with, not by that key's value.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const { readStripped, stripComments } = require('./helpers/strip-comments');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const SCANNED_DIRS = ['src', 'scripts'].map((dir) => path.join(BACKEND_ROOT, dir));

// Relative to api/backend. See the header for what each one does.
const ALLOWED_FILES = [
  'scripts/seed-essential-reference-data.js',
  'src/config/collections.js',
  'src/config/env.js',
  'src/services/rcs-assessment.service.js',
];
const WRITER = 'src/services/rcs-assessment.service.js';

const WRITE = 'insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany'
  + '|findOneAndUpdate|findOneAndReplace|findOneAndDelete|bulkWrite|drop|rename'
  + '|createIndex|createIndexes';

// A quoted literal or an identifier, so collections.js's keys and env.js's
// COLL_* names count as well as getCollection(db, 'rcsAssessments').
const RCS_COLLECTION = new RegExp(
  '(?<![\\w$])(?:rcsAssessments|rcsInputSnapshots|rcsGovernanceEvidenceSnapshots'
  + '|COLL_RCS_ASSESSMENTS|COLL_RCS_INPUT_SNAPSHOTS|COLL_RCS_GOVERNANCE_EVIDENCE_SNAPSHOTS)(?![\\w$])',
);
const WRITE_CALL = new RegExp(`\\.\\s*(${WRITE})\\s*\\(`, 'g');
const COMPENSATION_KEY = /^\s*\{\s*(?:rcsInputSnapshotId|governanceEvidenceSnapshotId)\s*:/;
const SET_OPERATOR = /(['"`]?)\$set\1\s*:/;

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

function namers() {
  return sources().filter(({ text }) => RCS_COLLECTION.test(text)).map(({ file }) => file).sort();
}

// The writes a piece of stripped source makes, as `<method>` for an allowed
// insert or compensation delete and as a violation message otherwise.
function writeShape(text) {
  const calls = [];
  const violations = [];
  for (const match of text.matchAll(WRITE_CALL)) {
    const method = match[1];
    const args = text.slice(match.index + match[0].length);
    if (method === 'insertOne') calls.push(method);
    else if (method === 'deleteOne' && COMPENSATION_KEY.test(args)) calls.push(method);
    else violations.push(`${match[0]}${args.slice(0, 60).split('\n')[0]}`);
  }
  if (SET_OPERATOR.test(text)) violations.push('$set');
  return { calls: calls.sort(), violations };
}

test('only the allowed files name the RCS collections (RF018 AC10)', () => {
  const found = namers();
  assert.deepEqual(found, ALLOWED_FILES, `the RCS collections are named by ${found.join(', ')}; RF018 AC10 allows only ${ALLOWED_FILES.join(', ')} (#1320)`);
});

test('rcs-assessment.service.js only appends and compensates (RF018 AC10)', () => {
  const text = readStripped(fs, path.join(BACKEND_ROOT, WRITER));
  const { calls, violations } = writeShape(text);
  assert.deepEqual(violations, [], `an RCS result is not editable (RF018 AC10, #1320):\n${violations.join('\n')}`);
  assert.deepEqual(calls, ['deleteOne', 'deleteOne', 'insertOne', 'insertOne', 'insertOne'],
    `${WRITER} writes ${calls.join(', ')}; RF018 AC10 allows three inserts and two compensation deletes (#1320)`);
});

// Controls: the matchers flag an edit and pass an append, a compensation
// delete, a read or a comment, and the namer scan really sees the writer,
// so an empty violation list above is not a matcher that sees nothing.
test('control: an update, $set or other-keyed delete is flagged; an append, compensation or comment is not', () => {
  assert.deepEqual(writeShape('await c.insertOne({ ...x }); await s.deleteOne({ rcsInputSnapshotId: id });'),
    { calls: ['deleteOne', 'insertOne'], violations: [] });
  assert.equal(writeShape('await c.updateOne({ rcsAssessmentId }, { x: 1 })').violations.length, 1);
  assert.equal(writeShape("await c.findOneAndReplace({ a: 1 }, b)").violations.length, 1);
  assert.equal(writeShape('await c.deleteOne({ rcsAssessmentId: id })').violations.length, 1);
  assert.equal(writeShape('const u = { $set: { a: 1 } };').violations.length, 1);
  assert.deepEqual(writeShape(stripComments('// await c.updateOne(f, { $set: {} })')).violations, []);
  assert.deepEqual(writeShape('await c.findOne({ rcsAssessmentId })').violations, []);
  assert.ok(RCS_COLLECTION.test("getCollection(db, 'rcsAssessments')"));
  assert.ok(RCS_COLLECTION.test('CANONICAL_COLLECTIONS.rcsInputSnapshots'));
  assert.ok(!RCS_COLLECTION.test('rcsAssessmentsForSpecimen'));
});

test('control: the namer scan sees rcs-assessment.service.js', () => {
  assert.ok(namers().includes(WRITER));
});
