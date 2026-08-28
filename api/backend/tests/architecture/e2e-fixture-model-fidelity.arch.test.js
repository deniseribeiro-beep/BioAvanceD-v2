// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #886: `seedStorageBoxLocation()` creates its equipment row with a raw
// `db.collection('equipment').insertOne(...)`, which bypasses
// `Equipment.validate()` entirely. That bypass is the mechanism behind
// three separate defects, all of them now closed:
//
//   #757 — a string containerID written into equipmentID, a field the rest
//          of the code treats as numeric
//   #736 — generateUniqueEquipmentID returning a corrupted non-numeric id
//          once string-typed debris existed in the collection
//   #774 — status: 'operational', a value the model refuses and the RF004
//          gate admitted only because it did not recognise it
//
// Each was closed by correcting the *value*. None touched the bypass, so
// the mechanism that produced all three had no guard and no open issue.
// This is that guard.
//
// It deliberately does NOT remove the bypass. The raw insert is not
// obviously wrong — the fixture pins `equipmentID: containerID` because
// sample.service.js's RF004 gate joins on
// `freezer.containerID === Equipment.equipmentID`, so the two cannot be
// typed independently, and whether `Equipment.create()` would even accept a
// caller-supplied id is #880's question. What this asserts is narrower and
// unconditional: whatever the fixture writes, the model must accept.
//
// The failure it exists to catch is silent. Add a required field to
// Equipment.js and this fixture stops describing a persistable document —
// with no failing test anywhere, because nothing else runs it through the
// model.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const EquipmentModel = require('../../src/models/Equipment');

const FIXTURE = path.resolve(
  __dirname,
  '../../../../tests/e2e/helpers/seedParticipant.ts'
);

// Balanced-brace capture from the opening `{` of the insertOne argument.
// A regex cannot do this: the literal contains a template string and nested
// braces, and a lazy match would stop at the first `}`.
function extractInsertLiteral(source, collection) {
  const anchor = `db.collection('${collection}').insertOne({`;
  const start = source.indexOf(anchor);
  assert.notEqual(
    start,
    -1,
    `Could not find a db.collection('${collection}').insertOne({ ... }) call in `
      + `${path.basename(FIXTURE)}. If the fixture was refactored, update this `
      + 'guard rather than deleting it -- the whole point is that nothing else '
      + 'runs that document through the model.'
  );

  let i = source.indexOf('{', start + anchor.length - 1);
  let depth = 0;
  for (let j = i; j < source.length; j += 1) {
    if (source[j] === '{') depth += 1;
    else if (source[j] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(i, j + 1);
    }
  }
  throw new Error('Unbalanced braces while extracting the insertOne literal.');
}

// The literal references locals from the enclosing function. Supplying them
// as parameters is what lets the real source text be evaluated rather than a
// hand-copied duplicate of it -- a duplicate would drift, which is the exact
// failure mode this guard is about.
function buildFixtureDocument(literal, { containerID, suffix }) {
  // eslint-disable-next-line no-new-func
  const build = new Function('containerID', 'suffix', `return (${literal});`);
  return build(containerID, suffix);
}

test('#886: the e2e equipment fixture writes a document Equipment.validate accepts', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literal = extractInsertLiteral(source, 'equipment');

  // A plausible run of the fixture: seedStorageBoxLocation() uses
  // `const suffix = Date.now()` and `const containerID = suffix`.
  const suffix = 1756412345678;
  const document = buildFixtureDocument(literal, { containerID: suffix, suffix });

  const result = EquipmentModel.validate(document);

  assert.deepEqual(
    result.errors,
    [],
    'seedStorageBoxLocation() writes an equipment document the product\'s own '
      + 'model would refuse. The raw insertOne bypasses validation, so this '
      + 'fails nowhere else -- the e2e suite would keep proving the RF004 gate '
      + 'against a document that could not exist. Fix the fixture (or, if the '
      + 'model gained a field the fixture legitimately should not set, decide '
      + 'that deliberately and say so here):\n  '
      + result.errors.join('\n  ')
  );
  assert.equal(result.isValid, true);
});

test('#886: the fixture still pins equipmentID to containerID', () => {
  // Not incidental, and not this guard being over-specific: sample.service.js's
  // RF004 gate joins freezer.containerID against Equipment.equipmentID, so a
  // fixture that stopped tying them together would silently stop exercising
  // the join it exists to exercise -- and #757 is what happens when their
  // TYPES drift. Pinning the identity is what keeps a future "tidy-up" from
  // giving them independent values.
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literal = extractInsertLiteral(source, 'equipment');

  const containerID = 424242;
  const document = buildFixtureDocument(literal, { containerID, suffix: containerID });

  assert.equal(
    document.equipmentID,
    containerID,
    'The equipment fixture no longer writes containerID into equipmentID. '
      + 'sample.service.js joins on exactly that equality, so the RF004 e2e '
      + 'specs would still pass while proving nothing about the join.'
  );
  assert.equal(
    typeof document.equipmentID,
    'number',
    'equipmentID must stay numeric -- a string here is #757, and #736 is what '
      + 'it corrupted downstream.'
  );
});
