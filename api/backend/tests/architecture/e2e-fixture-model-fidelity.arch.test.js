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
const StorageContainerModel = require('../../src/models/StorageContainer');
const StorageBoxModel = require('../../src/models/StorageBox');
const CollectionModel = require('../../src/models/Collection');
const StudyModel = require('../../src/models/Study');
const ProtocolModel = require('../../src/models/Protocol');
const TerminologyConceptModel = require('../../src/models/TerminologyConcept');
const ReferenceDatasetReleaseModel = require('../../src/models/ReferenceDatasetRelease');
const SensorModel = require('../../src/models/Sensor');

// #906: three seedParticipant.ts raw inserts are deliberately NOT under
// this guard -- seedRawSpecimen (samples), seedAssay (assays) and
// seedActiveConsent (patientConsents) are reference stubs whose only
// consumer resolves the id via findOne (assertReferencesExist /
// consent.validator's {participantId, status} query). Their partiality is
// documented at each fixture. The sensors fixture, by contrast, IS
// guarded below: the RF004 gates read its fields
// (sample.service.js#isOperationalSensor and intakeWizard.js's twin), the
// exact mechanism that made the equipment fixture worth guarding.

const FIXTURE = path.resolve(
  __dirname,
  '../../../../tests/e2e/helpers/seedParticipant.ts'
);

// Balanced-brace capture from the opening `{` of the insertOne argument.
// A regex cannot do this: the literal contains a template string and nested
// braces, and a lazy match would stop at the first `}`.
//
// Returns every match for `collection` in source order, not just the first
// -- seedStorageBoxLocation() alone writes three separate `storageContainers`
// literals (freezer/shelf/rack), and seedParticipant.ts writes
// `terminologyConcepts` from two different functions (seedDuoConcept,
// seedActiveTerminologyConcept). A first-match-only extractor would silently
// leave the later ones unguarded.
function extractAllInsertLiterals(source, collection) {
  const anchor = `db.collection('${collection}').insertOne({`;
  const literals = [];
  let searchFrom = 0;
  for (;;) {
    const start = source.indexOf(anchor, searchFrom);
    if (start === -1) break;

    const i = source.indexOf('{', start + anchor.length - 1);
    let depth = 0;
    let end = -1;
    for (let j = i; j < source.length; j += 1) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) throw new Error('Unbalanced braces while extracting the insertOne literal.');
    literals.push(source.slice(i, end + 1));
    searchFrom = end + 1;
  }
  return literals;
}

// Convenience wrapper for the (still common) single-literal case.
function extractInsertLiteral(source, collection) {
  const literals = extractAllInsertLiterals(source, collection);
  assert.notEqual(
    literals.length,
    0,
    `Could not find a db.collection('${collection}').insertOne({ ... }) call in `
      + `${path.basename(FIXTURE)}. If the fixture was refactored, update this `
      + 'guard rather than deleting it -- the whole point is that nothing else '
      + 'runs that document through the model.'
  );
  return literals[0];
}

// The literal references locals from the enclosing function. Supplying them
// as parameters is what lets the real source text be evaluated rather than a
// hand-copied duplicate of it -- a duplicate would drift, which is the exact
// failure mode this guard is about. `locals` is a plain object; its keys
// become the Function's parameter names, in the order Object.keys returns
// them (insertion order for string keys), so each literal gets exactly the
// names it actually references.
function buildFixtureDocument(literal, locals) {
  const names = Object.keys(locals);
  const values = names.map((name) => locals[name]);
  // eslint-disable-next-line no-new-func
  const build = new Function(...names, `return (${literal});`);
  return build(...values);
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

// #886 generalization: the same silent-bypass mechanism the equipment guard
// above exists for applies to every other raw `insertOne` in
// seedParticipant.ts whose target collection has a model exposing
// `validate()`. Each block below extracts the real literal and runs it
// through that model, same technique as the equipment case.
//
// Two collections seedParticipant.ts writes to are deliberately NOT guarded
// here:
//   - `terminologies` (seedLegacyDiagnosisTerminology): Terminology.js is a
//     plain Mongoose schema with no exported `validate()` -- there is
//     nothing for this guard's technique to call.
//   - `samples` (seedRawSpecimen), `assays` (seedAssay), `patientConsents`
//     (seedActiveConsent), and `sensors` (the second insertOne inside
//     seedStorageBoxLocation) DO have a model `validate()`, and running the
//     real literals through it fails -- these fixtures are intentionally
//     minimal (id-only) stand-ins for flows that don't need a fully-formed
//     document, per each function's own comment. Adding a passing assertion
//     here would either be dishonest (asserting isValid on a document that
//     isn't) or force a fixture change this guard has no authority to make.
//     Left out of the assertions below on purpose; see the test report for
//     the exact validation errors.

test('#886: the e2e freezer/shelf/rack fixtures each write a StorageContainer document StorageContainer.validate accepts', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literals = extractAllInsertLiterals(source, 'storageContainers');

  assert.equal(
    literals.length,
    3,
    'seedStorageBoxLocation() no longer writes exactly 3 storageContainers '
      + 'insertOne literals (freezer/shelf/rack) -- update this guard to match, '
      + 'rather than silently validating fewer than it used to.'
  );

  const suffix = 1756412345678;
  const containerID = suffix;

  const cases = [
    { label: 'freezer', doc: buildFixtureDocument(literals[0], { suffix, containerID }) },
    // shelf/rack reference their parent insertOne's result object only for
    // its `.insertedId` -- any object with that shape stands in fine, since
    // StorageContainer.validate() doesn't dereference parent_id at all.
    { label: 'shelf', doc: buildFixtureDocument(literals[1], { suffix, freezerResult: { insertedId: 'mock-freezer-id' } }) },
    { label: 'rack', doc: buildFixtureDocument(literals[2], { suffix, shelfResult: { insertedId: 'mock-shelf-id' } }) },
  ];

  for (const { label, doc } of cases) {
    const result = StorageContainerModel.validate(doc);
    assert.deepEqual(
      result.errors,
      [],
      `seedStorageBoxLocation()'s ${label} storageContainers document fails `
        + 'StorageContainer.validate(). The raw insertOne bypasses validation, '
        + 'so this fails nowhere else:\n  '
        + result.errors.join('\n  ')
    );
  }
});

test('#886: the freezer fixture still pins containerID to the value shared with Equipment.equipmentID', () => {
  // Not incidental: the same #757 comment block above `const containerID =
  // suffix;` in seedStorageBoxLocation() says this value is "written to
  // StorageContainer.containerID and Equipment.equipmentID" for the RF004
  // join -- this is the StorageContainer half of the equality the equipment
  // test above already pins.
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const freezerLiteral = extractAllInsertLiterals(source, 'storageContainers')[0];

  const containerID = 424242;
  const document = buildFixtureDocument(freezerLiteral, { suffix: containerID, containerID });

  assert.equal(
    document.containerID,
    containerID,
    'The freezer fixture no longer writes the shared containerID value into '
      + 'StorageContainer.containerID -- sample.service.js\'s RF004 gate joins '
      + 'freezer.containerID against Equipment.equipmentID, so this needs to '
      + 'stay pinned the same way the equipment side is.'
  );
});

test('#886: the e2e storageBox fixture writes a document StorageBox.validate accepts', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literal = extractInsertLiteral(source, 'storageBoxes');

  const suffix = 1756412345678;
  const document = buildFixtureDocument(literal, { suffix, rackResult: { insertedId: 'mock-rack-id' } });

  const result = StorageBoxModel.validate(document);
  assert.deepEqual(
    result.errors,
    [],
    'seedStorageBoxLocation()\'s storageBoxes document fails StorageBox.validate(). '
      + 'The raw insertOne bypasses validation, so this fails nowhere else:\n  '
      + result.errors.join('\n  ')
  );
});

test('#886: the e2e collection fixture (seedCollectionEntity) writes a document Collection.validate accepts', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literal = extractInsertLiteral(source, 'collections');

  const document = buildFixtureDocument(literal, { collectionId: 'rf004-e2e-collection-1756412345678' });

  const result = CollectionModel.validate(document);
  assert.deepEqual(
    result.errors,
    [],
    'seedCollectionEntity() writes a document Collection.validate refuses. '
      + 'The raw insertOne bypasses validation, so this fails nowhere else:\n  '
      + result.errors.join('\n  ')
  );
});

test('#886: the e2e study fixture (seedStudy) writes a document Study.validate accepts', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literal = extractInsertLiteral(source, 'studies');

  const document = buildFixtureDocument(literal, { studyId: 'rf004-e2e-study-1756412345678', options: {} });

  const result = StudyModel.validate(document);
  assert.deepEqual(
    result.errors,
    [],
    'seedStudy() writes a document Study.validate refuses. The raw insertOne '
      + 'bypasses validation, so this fails nowhere else:\n  '
      + result.errors.join('\n  ')
  );
});

test('#886: the e2e protocol fixture (seedProtocol) writes a document Protocol.validate accepts', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literal = extractInsertLiteral(source, 'protocols');

  const document = buildFixtureDocument(literal, { protocolId: 'rf004-e2e-protocol-1756412345678', options: {} });

  const result = ProtocolModel.validate(document);
  assert.deepEqual(
    result.errors,
    [],
    'seedProtocol() writes a document Protocol.validate refuses. The raw '
      + 'insertOne bypasses validation, so this fails nowhere else:\n  '
      + result.errors.join('\n  ')
  );
});

test('#886: the e2e DUO concept fixture (seedDuoConcept) writes a document TerminologyConcept.validate accepts', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literals = extractAllInsertLiterals(source, 'terminologyConcepts');

  assert.equal(
    literals.length,
    2,
    'seedParticipant.ts no longer writes exactly 2 terminologyConcepts '
      + 'insertOne literals (seedDuoConcept, seedActiveTerminologyConcept) -- '
      + 'update this guard to match, rather than silently validating fewer '
      + 'than it used to.'
  );

  const document = buildFixtureDocument(literals[0], { code: 'DUO:0000042', options: {} });

  const result = TerminologyConceptModel.validate(document);
  assert.deepEqual(
    result.errors,
    [],
    'seedDuoConcept() writes a document TerminologyConcept.validate refuses. '
      + 'The raw insertOne bypasses validation, so this fails nowhere else:\n  '
      + result.errors.join('\n  ')
  );
});

test('#886: the e2e active-release concept fixture (seedActiveTerminologyConcept) writes a document TerminologyConcept.validate accepts', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literals = extractAllInsertLiterals(source, 'terminologyConcepts');
  const literal = literals[1];

  const referenceDatasetReleaseId = 'e2e-696-E2E-1756412345678';
  const document = buildFixtureDocument(literal, {
    systemUri: 'http://purl.obolibrary.org/obo/hp.owl',
    code: 'HP:0001250',
    display: 'Seizure',
    referenceDatasetReleaseId,
  });

  const result = TerminologyConceptModel.validate(document);
  assert.deepEqual(
    result.errors,
    [],
    'seedActiveTerminologyConcept()\'s terminologyConcepts document fails '
      + 'TerminologyConcept.validate(). The raw insertOne bypasses validation, '
      + 'so this fails nowhere else:\n  '
      + result.errors.join('\n  ')
  );
});

test('#886: the e2e referenceDatasetReleases fixture (seedActiveTerminologyConcept) writes a document ReferenceDatasetRelease.validate accepts', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literal = extractInsertLiteral(source, 'referenceDatasetReleases');

  const referenceDatasetReleaseId = 'e2e-696-E2E-1756412345678';
  const document = buildFixtureDocument(literal, {
    referenceDatasetReleaseId,
    datasetCode: 'E2E',
    systemUri: 'http://purl.obolibrary.org/obo/hp.owl',
  });

  const result = ReferenceDatasetReleaseModel.validate(document);
  assert.deepEqual(
    result.errors,
    [],
    'seedActiveTerminologyConcept()\'s referenceDatasetReleases document fails '
      + 'ReferenceDatasetRelease.validate(). The raw insertOne bypasses '
      + 'validation, so this fails nowhere else:\n  '
      + result.errors.join('\n  ')
  );
});

test('#906: the e2e sensor fixture writes a document Sensor.validate accepts', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literal = extractInsertLiteral(source, 'sensors');

  const suffix = 1756412345678;
  const containerID = suffix;
  const document = buildFixtureDocument(literal, { suffix, containerID });

  const result = SensorModel.validate(document);
  assert.deepEqual(
    result.errors,
    [],
    'seedStorageBoxLocation()\'s sensors document fails Sensor.validate(). '
      + 'The RF004 gates (sample.service.js#isOperationalSensor and '
      + 'intakeWizard.js\'s twin) read this document\'s status fields, so an '
      + 'invalid shape here is admitted only by their permissive check -- '
      + 'the #774 mechanism one collection over:\n  '
      + result.errors.join('\n  ')
  );
});

test('#906: the sensor fixture still pins locationId to containerID', () => {
  const source = fs.readFileSync(FIXTURE, 'utf8');
  const literal = extractInsertLiteral(source, 'sensors');

  const suffix = 1756412345678;
  const containerID = suffix;
  const document = buildFixtureDocument(literal, { suffix, containerID });

  assert.equal(
    document.locationId,
    containerID,
    'seedStorageBoxLocation()\'s sensor no longer ties locationId to '
      + 'containerID. The RF004 operational-sensor gates join on exactly that '
      + 'equality (sensorLocationQuery over the freezer\'s containerID '
      + 'variants), so a fixture that drops it keeps passing while no longer '
      + 'exercising the join it exists to exercise.'
  );
});
