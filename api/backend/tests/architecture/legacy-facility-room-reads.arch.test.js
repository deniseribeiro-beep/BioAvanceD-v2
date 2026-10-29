// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1379, ELM-0168/0169 (StorageAssignment.facilityId/roomId): the
// facilities and rooms collections are retired in favour of the
// StorageLocation hierarchy. They stay in the database as history, and
// facilityRoomLocationMigration.service.js, the migration into
// StorageLocation, is their one allowed reader (decision record
// 2026-10-14-facility-room-locations.md, item 5).
//
// This test fails the day a file outside that list names either
// collection, the day anything requires the retired Facility or Room
// model, or the day a schema references them again.
//
// The raw roomId on legacy storageContainers documents is not scanned on
// purpose: legacyPlacementChain.service.js (ensureFreezerLocated) and the
// migration still read it to place a legacy FREEZER under its room's
// location (items 3, 7).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const { readStripped } = require('./helpers/strip-comments');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const SCANNED_DIRS = ['src', 'scripts'].map((dir) => path.join(BACKEND_ROOT, dir));

// Relative to api/backend. See the header for why it reads them.
const ALLOWED_READERS = ['src/services/facilityRoomLocationMigration.service.js'];

const COLLECTION_LITERAL = /(['"`])(facilities|rooms)\1/;
const MODEL_REQUIRE = /\brequire\s*\(\s*(['"`])[^'"`]*models\/(Facility|Room)(?:\.js)?\1\s*\)/;
const MODEL_REF = /\bref\s*:\s*(['"`])(Facility|Room)\1/;

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

const matching = (regex) => sources().filter(({ text }) => regex.test(text)).map(({ file }) => file).sort();

test('only the migration names the facilities and rooms collections (ELM-0168/0169)', () => {
  assert.deepEqual(matching(COLLECTION_LITERAL), ALLOWED_READERS, `only ${ALLOWED_READERS.join(', ')} may name facilities or rooms (#1379)`);
});

test('nothing requires the retired Facility or Room model (ELM-0168/0169)', () => {
  const requirers = matching(MODEL_REQUIRE);
  assert.deepEqual(requirers, [], `${requirers.join(', ')} requires models/Facility or models/Room, retired by #1379`);
});

test('no schema references Facility or Room (ELM-0168/0169)', () => {
  const referrers = matching(MODEL_REF);
  assert.deepEqual(referrers, [], `${referrers.join(', ')} declares ref Facility or Room, retired by #1379`);
});

// Controls: each matcher flags a known positive and passes a near-miss, so
// the empty lists above are not matchers that see nothing.
test('control: each matcher flags its positive and passes a near-miss', () => {
  assert.ok(COLLECTION_LITERAL.test("db.collection('rooms')"));
  assert.ok(COLLECTION_LITERAL.test('getCollection(db, "facilities")'));
  assert.ok(!COLLECTION_LITERAL.test("db.collection('roomsFoo')"));
  assert.ok(!COLLECTION_LITERAL.test("const rooms = 1; 'facilities\""));

  assert.ok(MODEL_REQUIRE.test("require('../models/Facility')"));
  assert.ok(MODEL_REQUIRE.test('require("../../models/Room.js")'));
  assert.ok(!MODEL_REQUIRE.test("require('../models/RoomType')"));

  assert.ok(MODEL_REF.test('ref: "Room",'));
  assert.ok(MODEL_REF.test('ref: `Facility`'));
  assert.ok(!MODEL_REF.test("ref: 'RoomLocation'"));
});

test('control: the collection scan sees the migration', () => {
  assert.ok(matching(COLLECTION_LITERAL).includes('src/services/facilityRoomLocationMigration.service.js'));
});
