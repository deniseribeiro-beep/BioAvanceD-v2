import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { run } = require('../../src/scripts/migrateFacilitiesRoomsToLocations');

// A query-matching fake, as in facilityRoomLocationMigration.service.test.js.
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

const FREEZER_CODE = 'legacy-storage-container:F1';

function location(storageLocationId, locationType, code, parentLocationId, organizationId = 'org-1') {
  return { storageLocationId, locationType, name: storageLocationId, code, parentLocationId, organizationId, locationStatus: 'active' };
}

const freezerAtRoot = () => location('loc-f1', 'freezer', FREEZER_CODE, null);

// #1576, RNF023 C2: the migration script's own run, against an in-memory fake DB.
describe('migrateFacilitiesRoomsToLocations run (#1576)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies: mirrors the facility and its room, and moves the root freezer location under the room', async () => {
    const db = createFakeDb({ ...topology(), storageLocations: [freezerAtRoot()] });

    const summary = await run([], { db });

    expect(summary.mode).toBe('apply');
    expect(summary.facilities).toEqual({ scanned: 1, created: 1, alreadyMigrated: 0, deleted: 0 });
    expect(summary.rooms).toEqual({ scanned: 1, created: 1, alreadyMigrated: 0, deleted: 0 });
    expect(summary.freezers).toEqual({ scanned: 1, reparented: 1, alreadyUnderRoom: 0, noLocation: 0, roomNotMirrored: 0 });
    expect(summary.unresolved).toEqual([]);
    expect(locationsOf(db)).toHaveLength(3);
    const room = locationsOf(db).find((row) => row.code === `legacy-room:${ROOM_1._id}`);
    const freezerLocation = locationsOf(db).find((row) => row.code === FREEZER_CODE);
    expect(freezerLocation.parentLocationId).toBe(room.storageLocationId);
  });

  it('a second run writes nothing', async () => {
    const db = createFakeDb({ ...topology(), storageLocations: [freezerAtRoot()] });
    await run([], { db });
    const written = db.writes.length;

    const again = await run([], { db });

    expect(db.writes).toHaveLength(written);
    expect(again.facilities.alreadyMigrated).toBe(1);
    expect(again.rooms.alreadyMigrated).toBe(1);
    expect(again.freezers.alreadyUnderRoom).toBe(1);
    expect(again.freezers.reparented).toBe(0);
  });

  it('--dry-run writes nothing', async () => {
    const db = createFakeDb(topology());

    const summary = await run(['--dry-run'], { db });

    expect(db.writes).toEqual([]);
    expect(inserts(db)).toEqual([]);
    expect(summary.mode).toBe('dry-run');
    expect(summary.facilities.created).toBe(1);
    expect(summary.rooms.created).toBe(1);
  });

  it('--organization-id gives a facility none can be derived for its organization', async () => {
    const db = createFakeDb(topology({ storageContainers: [] }));

    const summary = await run(['--organization-id', 'org-1'], { db });

    expect(summary.unresolved).toEqual([]);
    expect(locationsOf(db)).toHaveLength(2);
    expect(locationsOf(db).map((row) => row.organizationId)).toEqual(['org-1', 'org-1']);
  });

  it('--organization-id with no value throws before any write', async () => {
    const db = createFakeDb(topology());

    await expect(run(['--organization-id'], { db })).rejects.toThrow('--organization-id requer um valor');

    expect(db.writes).toEqual([]);
  });
});
