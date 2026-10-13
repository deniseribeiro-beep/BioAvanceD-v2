import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const logger = require('../../../src/utils/logger');
const bridge = require('../../../src/services/legacyPlacementChain.service');

// #1314: a query-matching fake. Equality (Dates by instant, ObjectIds by
// hex), `null` as missing-or-null, and `$in`, the way Mongo matches. Every
// write and index build is recorded with the options it was given.
function same(a, b) {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return a != null && b != null && new Date(a).getTime() === new Date(b).getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') return String(a) === String(b);
  return false;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value === null) return doc[key] === null || doc[key] === undefined;
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.some((option) => same(doc[key], option));
    return same(doc[key], value);
  });
}

function createFakeCollection(name, writes) {
  const docs = [];
  return {
    docs,
    async createIndex(keys, options) { writes.push({ collection: name, op: 'createIndex', options }); },
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

// FREEZER -> SHELF -> RACK -> two boxes. The freezer's Equipment names org-1.
const BOX_1 = { _id: new ObjectId('64b000000000000000000001'), name: 'Caixa 1', parent_id: 'R1' };
const BOX_2 = { _id: new ObjectId('64b000000000000000000002'), name: 'Caixa 2', parent_id: 'R1' };

function topology({ organizationId = 'org-1', organizations = [{ organizationId: 'org-1' }] } = {}) {
  return {
    organizations,
    equipment: [{ equipmentID: 4201, organizationId, deletedAt: null }],
    storageContainers: [
      { _id: 'F1', containerType: 'FREEZER', containerID: 4201, name: 'Freezer 1', parent_id: null },
      { _id: 'S1', containerType: 'SHELF', name: 'Prateleira 1', parent_id: 'F1' },
      { _id: 'R1', containerType: 'RACK', name: 'Rack 1', parent_id: 'S1' },
    ],
    storageBoxes: [BOX_1, BOX_2],
  };
}

const SAMPLE = {
  _id: new ObjectId('64a000000000000000000001'),
  specimenId: 'SPC-2026-0001',
  primaryContainer: 'cryogenic_vial',
  storageLocation: { position: 'A1' },
};
const T = (day) => new Date(`2026-10-0${day}T00:00:00.000Z`);
const SESSION = { id: 'caller-session' };

afterEach(() => vi.restoreAllMocks());

describe('legacyPlacementChain.service (#1314)', () => {
  it('converts position codes both ways, and names a position by its box', () => {
    expect(bridge.chainPositionCode('A1')).toBe('A01');
    expect(bridge.chainPositionCode('h12')).toBe('H12');
    expect(bridge.chainPositionCode('A01')).toBe('A01');
    expect(bridge.legacyPositionCode('A01')).toBe('A1');
    expect(bridge.legacyPositionCode('H12')).toBe('H12');
    expect(bridge.legacyPositionCode('A1')).toBe('A1');
    expect(bridge.rackIdForBox(BOX_1)).toBe('64b000000000000000000001');
    expect(bridge.storagePositionIdFor(BOX_1, 'B3')).toBe('64b000000000000000000001:B03');
  });

  it('places, moves and releases: one container kept loaded, one position at a time, the box located in its mirrored tree', async () => {
    const db = createFakeDb(topology());

    await bridge.placeSpecimen(db, { sample: SAMPLE, box: BOX_1, position: 'A1', at: T(1), sourceEventId: 'evt-place' }, SESSION);
    await bridge.moveSpecimen(db, { sample: SAMPLE, toBox: BOX_2, toPosition: 'B2', at: T(2), sourceEventId: 'evt-move' }, SESSION);
    await bridge.releaseSpecimen(db, { sample: SAMPLE, at: T(3), sourceEventId: 'evt-release' }, SESSION);

    const [container] = db.collections.containers.docs;
    expect(db.collections.containers.docs).toHaveLength(1);
    expect(container).toMatchObject({ containerType: 'cryogenic_vial', emptyStatus: 'occupied' });
    expect(db.collections.specimenContainerAssignments.docs).toEqual([
      expect.objectContaining({ specimenId: 'SPC-2026-0001', containerId: container.containerId, loadedAt: T(1), unloadedAt: null, assignmentStatus: 'active', sourceEventId: 'evt-place' }),
    ]);
    expect(db.collections.containerPositionAssignments.docs).toEqual([
      expect.objectContaining({ storagePositionId: '64b000000000000000000001:A01', placedAt: T(1), removedAt: T(2), assignmentStatus: 'ended' }),
      expect.objectContaining({ storagePositionId: '64b000000000000000000002:B02', placedAt: T(2), removedAt: T(3), assignmentStatus: 'ended' }),
    ]);

    const locations = db.collections.storageLocations.docs;
    expect(locations.map(({ code, locationType, organizationId }) => ({ code, locationType, organizationId }))).toEqual([
      { code: 'legacy-storage-container:F1', locationType: 'freezer', organizationId: 'org-1' },
      { code: 'legacy-storage-container:S1', locationType: 'shelf', organizationId: 'org-1' },
      { code: 'legacy-storage-container:R1', locationType: 'rack', organizationId: 'org-1' },
    ]);
    expect(locations[0].parentLocationId).toBeNull();
    expect(locations[1].parentLocationId).toBe(locations[0].storageLocationId);
    expect(locations[2].parentLocationId).toBe(locations[1].storageLocationId);
    expect(db.collections.rackLocationAssignments.docs).toEqual([
      expect.objectContaining({ storageRackId: '64b000000000000000000001', storageLocationId: locations[2].storageLocationId, placedAt: T(1), sourceEventId: 'evt-place', assignmentStatus: 'active' }),
      expect.objectContaining({ storageRackId: '64b000000000000000000002', storageLocationId: locations[2].storageLocationId, placedAt: T(2), sourceEventId: 'evt-move', assignmentStatus: 'active' }),
    ]);
    expect(db.collections.storageAssignments).toBeUndefined();
  });

  it('runs every write in the caller\'s session, and builds no index', async () => {
    const db = createFakeDb(topology());

    await bridge.placeSpecimen(db, { sample: SAMPLE, box: BOX_1, position: 'A1', at: T(1), sourceEventId: 'evt-place' }, SESSION);
    await bridge.moveSpecimen(db, { sample: SAMPLE, toBox: BOX_2, toPosition: 'B2', at: T(2), sourceEventId: 'evt-move' }, SESSION);
    await bridge.releaseSpecimen(db, { sample: SAMPLE, at: T(3), sourceEventId: 'evt-release' }, SESSION);

    expect(db.writes.length).toBeGreaterThan(0);
    expect(db.writes.filter((write) => write.options?.session !== SESSION)).toEqual([]);
  });

  it('a specimen with no primaryContainer gets the container-not-identified type', async () => {
    const db = createFakeDb(topology());
    const sample = { ...SAMPLE, primaryContainer: undefined };
    await bridge.placeSpecimen(db, { sample, box: BOX_1, position: 'A1', at: T(1), sourceEventId: 'evt-place' }, SESSION);
    expect(db.collections.containers.docs[0].containerType).toBe('unidentified_container');
    expect(bridge.UNIDENTIFIED_CONTAINER_TYPE).toBe('unidentified_container');
  });

  it.each([
    ['the Equipment names no organization', { organizationId: null }],
    ['the Equipment names an organization that is not stored', { organizations: [] }],
  ])('without a resolvable organization (%s) the chain ends at the rack, with a log line', async (_case, options) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const db = createFakeDb(topology(options));

    await bridge.placeSpecimen(db, { sample: SAMPLE, box: BOX_1, position: 'A1', at: T(1), sourceEventId: 'evt-place' }, SESSION);

    expect(db.collections.containerPositionAssignments.docs).toHaveLength(1);
    expect(db.collections.storageLocations).toBeUndefined();
    expect(db.collections.rackLocationAssignments.docs).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('64b000000000000000000001'));
  });

  it('currentPlacement reads the chain first, the open legacy row as a fallback, and null with neither', async () => {
    const legacyRow = { storageAssignmentId: 'sa-1', specimenId: String(SAMPLE._id), boxId: String(BOX_2._id), positionCode: 'C4', placedAt: T(1), removedAt: null };
    const db = createFakeDb({ ...topology(), storageAssignments: [legacyRow] });

    expect(await bridge.currentPlacement(db, SAMPLE, SESSION)).toEqual({
      boxId: String(BOX_2._id), positionCode: 'C4', containerId: null, storagePositionId: null, storageRackId: null, storageLocationId: null,
      placedAt: T(1), source: 'legacy_storage_assignment',
    });

    await bridge.placeSpecimen(db, { sample: SAMPLE, box: BOX_1, position: 'A1', at: T(2), sourceEventId: 'evt-place' }, SESSION);
    const rackLocation = db.collections.rackLocationAssignments.docs[0];
    expect(await bridge.currentPlacement(db, SAMPLE, SESSION)).toEqual({
      boxId: String(BOX_1._id), positionCode: 'A1', containerId: db.collections.containers.docs[0].containerId,
      storagePositionId: '64b000000000000000000001:A01', storageRackId: '64b000000000000000000001', storageLocationId: rackLocation.storageLocationId,
      placedAt: T(2), source: 'physical_chain',
    });

    await bridge.releaseSpecimen(db, { sample: SAMPLE, at: T(3) }, SESSION);
    legacyRow.removedAt = T(3);
    expect(await bridge.currentPlacement(db, SAMPLE, SESSION)).toBeNull();
  });

  it('currentPlacement reads a loaded, released specimen as not placed, whatever its open legacy row says (#1374)', async () => {
    const legacyRow = { storageAssignmentId: 'sa-1', specimenId: String(SAMPLE._id), boxId: String(BOX_2._id), positionCode: 'C4', placedAt: T(1), removedAt: null };
    const db = createFakeDb({ ...topology(), storageAssignments: [legacyRow] });
    await bridge.placeSpecimen(db, { sample: SAMPLE, box: BOX_1, position: 'A1', at: T(2), sourceEventId: 'evt-place' }, SESSION);
    await bridge.releaseSpecimen(db, { sample: SAMPLE, at: T(3) }, SESSION);

    expect(await bridge.currentPlacement(db, SAMPLE, SESSION)).toBeNull();
    expect(legacyRow.removedAt).toBeNull();
  });

  it('releaseSpecimen adopts a legacy-only specimen first, then closes its position (#1374)', async () => {
    const legacyRow = { storageAssignmentId: 'sa-1', specimenId: String(SAMPLE._id), boxId: String(BOX_2._id), positionCode: 'B2', placedAt: T(1), removedAt: null };
    const db = createFakeDb({ ...topology(), storageAssignments: [legacyRow] });

    expect(await bridge.releaseSpecimen(db, { sample: SAMPLE, at: T(3) }, SESSION)).not.toBeNull();

    expect(db.collections.specimenContainerAssignments.docs).toEqual([
      expect.objectContaining({ specimenId: 'SPC-2026-0001', loadedAt: T(1), assignmentStatus: 'active', sourceEventId: 'legacy-storage-assignment:sa-1' }),
    ]);
    expect(db.collections.containerPositionAssignments.docs).toEqual([
      expect.objectContaining({ storagePositionId: '64b000000000000000000002:B02', placedAt: T(1), removedAt: T(3), assignmentStatus: 'ended' }),
    ]);
    expect(await bridge.currentPlacement(db, SAMPLE, SESSION)).toBeNull();
    expect(db.writes.filter((write) => write.collection === 'storageAssignments')).toEqual([]);
    expect(db.writes.filter((write) => write.options?.session !== SESSION)).toEqual([]);
  });

  it('releaseSpecimen returns null when nothing is placed, after adoption too', async () => {
    const closedRow = { storageAssignmentId: 'sa-1', specimenId: String(SAMPLE._id), boxId: String(BOX_2._id), positionCode: 'B2', placedAt: T(1), removedAt: T(2) };
    expect(await bridge.releaseSpecimen(createFakeDb(topology()), { sample: SAMPLE, at: T(3) }, SESSION)).toBeNull();
    expect(await bridge.releaseSpecimen(createFakeDb({ ...topology(), storageAssignments: [closedRow] }), { sample: SAMPLE, at: T(3) }, SESSION)).toBeNull();
  });

  it('moveSpecimen adopts a legacy-only specimen first, then moves its one container (#1374)', async () => {
    const legacyRow = { storageAssignmentId: 'sa-1', specimenId: String(SAMPLE._id), boxId: String(BOX_1._id), positionCode: 'A1', placedAt: T(1), removedAt: null };
    const db = createFakeDb({ ...topology(), storageAssignments: [legacyRow] });

    await bridge.moveSpecimen(db, { sample: SAMPLE, toBox: BOX_2, toPosition: 'B2', at: T(2), sourceEventId: 'evt-move' }, SESSION);

    const [container] = db.collections.containers.docs;
    expect(db.collections.containers.docs).toHaveLength(1);
    expect(db.collections.specimenContainerAssignments.docs).toEqual([
      expect.objectContaining({ specimenId: 'SPC-2026-0001', containerId: container.containerId, loadedAt: T(1), assignmentStatus: 'active', sourceEventId: 'legacy-storage-assignment:sa-1' }),
    ]);
    expect(db.collections.containerPositionAssignments.docs).toEqual([
      expect.objectContaining({ containerId: container.containerId, storagePositionId: '64b000000000000000000001:A01', placedAt: T(1), removedAt: T(2), assignmentStatus: 'ended' }),
      expect.objectContaining({ containerId: container.containerId, storagePositionId: '64b000000000000000000002:B02', placedAt: T(2), removedAt: null, assignmentStatus: 'active' }),
    ]);
    expect(await bridge.currentPlacement(db, SAMPLE, SESSION)).toMatchObject({ boxId: String(BOX_2._id), positionCode: 'B2', source: 'physical_chain' });
    expect(db.writes.filter((write) => write.collection === 'storageAssignments')).toEqual([]);
    expect(db.writes.filter((write) => write.options?.session !== SESSION)).toEqual([]);
  });

  it.each([
    ['an object', { code: 'x' }, 'unidentified_container'],
    ['a blank string', '  ', 'unidentified_container'],
    ['a number', 42, 'unidentified_container'],
    ['a plain code', 'cryogenic_vial', 'cryogenic_vial'],
  ])('primaryContainer given as %s reaches containerType as a plain code or the not-identified type (#1374)', async (_case, primaryContainer, containerType) => {
    const db = createFakeDb(topology());
    await bridge.placeSpecimen(db, { sample: { ...SAMPLE, primaryContainer }, box: BOX_1, position: 'A1', at: T(1), sourceEventId: 'evt-place' }, SESSION);
    expect(db.collections.containers.docs[0].containerType).toBe(containerType);
  });

  it('legacyWriteEventId names a legacy write by its operation, sample and instant (V2E-0683, V2E-0690)', () => {
    expect(bridge.legacyWriteEventId('allocate', SAMPLE, T(1))).toBe('legacy-storage-allocate:64a000000000000000000001:2026-10-01T00:00:00.000Z');
    expect(bridge.legacyWriteEventId('auto-assign', SAMPLE, '2026-10-02T03:04:05.000Z')).toBe('legacy-storage-auto-assign:64a000000000000000000001:2026-10-02T03:04:05.000Z');
    expect(bridge.legacyWriteEventId('move', { _id: 'smp-1' }, T(3))).toBe('legacy-storage-move:smp-1:2026-10-03T00:00:00.000Z');
  });

  it('adoptLegacyPlacement decomposes the legacy rows once, and a second run writes nothing', async () => {
    const rows = [
      { storageAssignmentId: 'sa-2', specimenId: String(SAMPLE._id), boxId: String(BOX_2._id), positionCode: 'B2', placedAt: T(3), removedAt: null },
      { storageAssignmentId: 'sa-1', specimenId: String(SAMPLE._id), boxId: String(BOX_1._id), positionCode: 'A1', placedAt: T(1), removedAt: T(3) },
    ];
    const db = createFakeDb({ ...topology(), storageAssignments: rows });

    expect(await bridge.adoptLegacyPlacement(db, SAMPLE, SESSION)).toMatchObject({ positionAssignments: 2, rackLocations: 2 });
    expect(db.collections.specimenContainerAssignments.docs).toEqual([
      expect.objectContaining({ specimenId: 'SPC-2026-0001', loadedAt: T(1), assignmentStatus: 'active', sourceEventId: 'legacy-storage-assignment:sa-1' }),
    ]);
    expect(db.collections.containerPositionAssignments.docs).toEqual([
      expect.objectContaining({ storagePositionId: '64b000000000000000000001:A01', placedAt: T(1), removedAt: T(3), assignmentStatus: 'ended' }),
      expect.objectContaining({ storagePositionId: '64b000000000000000000002:B02', placedAt: T(3), removedAt: null, assignmentStatus: 'active' }),
    ]);
    expect(db.collections.rackLocationAssignments.docs.map(({ storageRackId, sourceEventId }) => ({ storageRackId, sourceEventId }))).toEqual([
      { storageRackId: '64b000000000000000000001', sourceEventId: 'legacy-storage-assignment:sa-1' },
      { storageRackId: '64b000000000000000000002', sourceEventId: 'legacy-storage-assignment:sa-2' },
    ]);
    expect(db.writes.filter((write) => write.collection === 'storageAssignments')).toEqual([]);
    expect(db.writes.filter((write) => write.options?.session !== SESSION)).toEqual([]);

    const writesAfterFirst = db.writes.length;
    expect(await bridge.adoptLegacyPlacement(db, SAMPLE, SESSION)).toMatchObject({ positionAssignments: 0, rackLocations: 0 });
    expect(db.writes).toHaveLength(writesAfterFirst);
  });
});
