import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { mirrorFacilitiesAndRooms } = require('../../../src/services/facilityRoomLocationMigration.service');
const { findLegacyLocation } = require('../../../src/services/facilityRoomLocation.service');

// #1379: a query-matching fake, as in legacyPlacementChain.service.test.js.
// Equality (ObjectIds by hex), `null` as missing-or-null, `$in` and `$or`.
// Every write is recorded.
function same(a, b) {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return a != null && b != null && new Date(a).getTime() === new Date(b).getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') return String(a) === String(b);
  return false;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((branch) => matches(doc, branch));
    if (value === null) return doc[key] === null || doc[key] === undefined;
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.some((option) => same(doc[key], option));
    return same(doc[key], value);
  });
}

function createFakeCollection(name, writes) {
  const docs = [];
  return {
    docs,
    async createIndex() {},
    async insertOne(doc, options) {
      writes.push({ collection: name, op: 'insertOne', options });
      docs.push({ ...doc });
      return { insertedId: docs.length };
    },
    async updateOne(filter, update, options) {
      writes.push({ collection: name, op: 'updateOne', options });
      const doc = docs.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    },
    async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
    find(filter = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }; },
  };
}

function createFakeDb(seed = {}) {
  const collections = {};
  const writes = [];
  const db = {
    collections,
    writes,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection(name, writes);
      return collections[name];
    },
  };
  for (const [name, docs] of Object.entries(seed)) db.collection(name).docs.push(...docs);
  return db;
}

const FACILITY = { _id: new ObjectId('64c000000000000000000001'), name: 'Campus Central', code: 'CC', address: 'Rua 1', deletedAt: null };
const ROOM_1 = { _id: new ObjectId('64d000000000000000000001'), facilityId: FACILITY._id, name: 'Sala 1', deletedAt: null };
const ROOM_2 = { _id: new ObjectId('64d000000000000000000002'), facilityId: FACILITY._id, name: 'Sala 2', deletedAt: null };

function freezer(id, containerID, room) {
  return { _id: id, containerType: 'FREEZER', containerID, name: `Freezer ${id}`, parent_id: null, roomId: room._id, deletedAt: null };
}

// A facility with one room; the room's freezer's Equipment names org-1.
function topology({ facilities = [FACILITY], rooms = [ROOM_1], storageContainers = [freezer('F1', 4201, ROOM_1)] } = {}) {
  return {
    organizations: [{ organizationId: 'org-1' }, { organizationId: 'org-2' }],
    equipment: [
      { equipmentID: 4201, organizationId: 'org-1', deletedAt: null },
      { equipmentID: 4202, organizationId: 'org-2', deletedAt: null },
    ],
    facilities,
    rooms,
    storageContainers,
  };
}

const locationsOf = (db) => db.collection('storageLocations').docs;
const inserts = (db) => db.writes.filter((write) => write.op === 'insertOne');

describe('mirrorFacilitiesAndRooms (#1379)', () => {
  it('mirrors a facility and its room as two locations of the freezer organization', async () => {
    const db = createFakeDb(topology());

    const summary = await mirrorFacilitiesAndRooms(db);

    expect(summary).toEqual({
      mode: 'apply',
      facilities: { scanned: 1, created: 1, alreadyMigrated: 0, deleted: 0 },
      rooms: { scanned: 1, created: 1, alreadyMigrated: 0, deleted: 0 },
      unresolved: [],
    });
    const [facility, room] = locationsOf(db);
    expect(facility).toMatchObject({
      locationType: 'facility', name: 'Campus Central', code: `legacy-facility:${FACILITY._id}`,
      parentLocationId: null, organizationId: 'org-1', locationStatus: 'active',
    });
    expect(room).toMatchObject({
      locationType: 'room', name: 'Sala 1', code: `legacy-room:${ROOM_1._id}`,
      parentLocationId: facility.storageLocationId, organizationId: 'org-1', locationStatus: 'active',
    });
    expect(facility.storageLocationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(facility).not.toHaveProperty('address');
    expect(db.writes.every((write) => write.collection === 'storageLocations')).toBe(true);
  });

  it('writes nothing on a second run', async () => {
    const db = createFakeDb(topology());
    await mirrorFacilitiesAndRooms(db);
    const written = inserts(db).length;

    const summary = await mirrorFacilitiesAndRooms(db);

    expect(inserts(db)).toHaveLength(written);
    expect(summary.facilities).toMatchObject({ created: 0, alreadyMigrated: 1 });
    expect(summary.rooms).toMatchObject({ created: 0, alreadyMigrated: 1 });
  });

  it('under a dry run writes nothing and counts what it would create', async () => {
    const db = createFakeDb(topology());

    const summary = await mirrorFacilitiesAndRooms(db, { dryRun: true });

    expect(db.writes).toEqual([]);
    expect(locationsOf(db)).toEqual([]);
    expect(summary).toMatchObject({
      mode: 'dry-run',
      facilities: { scanned: 1, created: 1, alreadyMigrated: 0, deleted: 0 },
      rooms: { scanned: 1, created: 1, alreadyMigrated: 0, deleted: 0 },
      unresolved: [],
    });
  });

  it('gives a room with no freezer its facility organization', async () => {
    const db = createFakeDb(topology({ rooms: [ROOM_1, ROOM_2] }));

    const summary = await mirrorFacilitiesAndRooms(db);

    expect(summary.rooms.created).toBe(2);
    const room2 = locationsOf(db).find((location) => location.code === `legacy-room:${ROOM_2._id}`);
    expect(room2).toMatchObject({ organizationId: 'org-1' });
  });

  it('leaves a facility with no derivable organization unresolved, and its rooms, unless an organization is given', async () => {
    const db = createFakeDb(topology({ storageContainers: [] }));

    const summary = await mirrorFacilitiesAndRooms(db);

    expect(locationsOf(db)).toEqual([]);
    expect(summary.unresolved).toEqual([
      { kind: 'facility', id: String(FACILITY._id), reason: 'no_organization' },
      { kind: 'room', id: String(ROOM_1._id), reason: 'facility_not_mirrored' },
    ]);

    const given = await mirrorFacilitiesAndRooms(db, { organizationId: 'org-1' });

    expect(given.unresolved).toEqual([]);
    expect(locationsOf(db).map((location) => location.organizationId)).toEqual(['org-1', 'org-1']);
  });

  it('refuses an organization option that names no stored organization, before writing', async () => {
    const db = createFakeDb(topology({ storageContainers: [] }));

    await expect(mirrorFacilitiesAndRooms(db, { organizationId: 'org-9' })).rejects.toThrow(/org-9/);
    expect(db.writes).toEqual([]);
  });

  it('refuses a facility whose rooms name two organizations, writing nothing for it', async () => {
    const db = createFakeDb(topology({
      rooms: [ROOM_1, ROOM_2],
      storageContainers: [freezer('F1', 4201, ROOM_1), freezer('F2', 4202, ROOM_2)],
    }));

    const summary = await mirrorFacilitiesAndRooms(db);

    expect(locationsOf(db)).toEqual([]);
    expect(summary.unresolved).toEqual([
      { kind: 'facility', id: String(FACILITY._id), reason: 'conflicting_organizations', organizationIds: ['org-1', 'org-2'] },
      { kind: 'room', id: String(ROOM_1._id), reason: 'facility_not_mirrored' },
      { kind: 'room', id: String(ROOM_2._id), reason: 'facility_not_mirrored' },
    ]);
  });

  it('counts a deleted facility and a deleted room, and writes neither', async () => {
    const deletedFacility = { _id: new ObjectId('64c000000000000000000002'), name: 'Antigo', deletedAt: new Date('2026-01-01') };
    const deletedRoom = { ...ROOM_2, deletedAt: new Date('2026-01-01') };
    const db = createFakeDb(topology({ facilities: [FACILITY, deletedFacility], rooms: [ROOM_1, deletedRoom] }));

    const summary = await mirrorFacilitiesAndRooms(db);

    expect(summary.facilities).toEqual({ scanned: 2, created: 1, alreadyMigrated: 0, deleted: 1 });
    expect(summary.rooms).toEqual({ scanned: 2, created: 1, alreadyMigrated: 0, deleted: 1 });
    expect(locationsOf(db).map((location) => location.code)).toEqual([
      `legacy-facility:${FACILITY._id}`, `legacy-room:${ROOM_1._id}`,
    ]);
  });

  it('skips a room whose facility is not stored', async () => {
    const orphan = { ...ROOM_2, facilityId: new ObjectId('64c0000000000000000000ff') };
    const db = createFakeDb(topology({ rooms: [ROOM_1, orphan] }));

    const summary = await mirrorFacilitiesAndRooms(db);

    expect(summary.unresolved).toEqual([{ kind: 'room', id: String(orphan._id), reason: 'facility_not_found' }]);
    expect(summary.rooms.created).toBe(1);
  });
});

describe('findLegacyLocation (#1379)', () => {
  it('resolves an old room id to its mirrored location', async () => {
    const db = createFakeDb(topology());
    await mirrorFacilitiesAndRooms(db);

    const location = await findLegacyLocation(db, 'room', ROOM_1._id);

    expect(location).toMatchObject({ locationType: 'room', code: `legacy-room:${ROOM_1._id}`, name: 'Sala 1' });
    expect(await findLegacyLocation(db, 'facility', ROOM_1._id)).toBeNull();
  });
});
