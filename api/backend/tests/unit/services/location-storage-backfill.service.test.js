import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { backfillLocationsToStorage } = require('../../../src/services/location-storage-backfill.service');

/**
 * Real query-matching fake — exact-match on scalar fields, per build-loop's
 * native-only "real backend" proof bar (this repo has no live-Mongo tier).
 */
function createFakeCollection(name) {
  const docs = [];
  const matches = (doc, filter) =>
    Object.keys(filter).every((key) => {
      const filterValue = filter[key];
      const docValue = doc[key];
      if (filterValue && typeof filterValue === 'object' && '$in' in filterValue) {
        return filterValue.$in.some((v) => String(v) === String(docValue));
      }
      return String(docValue) === String(filterValue);
    });
  let autoId = 1;
  return {
    name,
    docs,
    async insertOne(doc) {
      const _id = doc._id || `${name}-${autoId++}`;
      const stored = { _id, ...doc };
      docs.push(stored);
      return { insertedId: _id };
    },
    async findOne(filter = {}) {
      return docs.find((d) => matches(d, filter)) || null;
    },
    find(filter = {}) {
      const current = docs.filter((d) => matches(d, filter));
      return { toArray: async () => current };
    },
  };
}

function createFakeDb(seed = {}) {
  const collections = {
    locations: createFakeCollection('locations'),
    equipment: createFakeCollection('equipment'),
    samples: createFakeCollection('samples'),
    storageContainers: createFakeCollection('storageContainers'),
    storageBoxes: createFakeCollection('storageBoxes'),
    storageAssignments: createFakeCollection('storageAssignments'),
  };
  for (const [key, docs] of Object.entries(seed)) {
    for (const doc of docs) collections[key].docs.push(doc);
  }
  return {
    collections,
    collection(collectionName) {
      if (!collections[collectionName]) throw new Error(`unexpected collection: ${collectionName}`);
      return collections[collectionName];
    },
  };
}

describe('location-storage-backfill.service', () => {
  it('materializes the FREEZER->SHELF->RACK->BOX chain and rewrites a Sample.locationID into a StorageAssignment', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 101, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
      ],
      equipment: [{ equipmentID: 5, equipmentDescription: 'Ultra-Freezer 05' }],
      samples: [{ _id: 'sample-1', locationID: 101, registeredAt: new Date('2026-01-01') }],
    });

    const { summary, locationIdToBoxId } = await backfillLocationsToStorage(db);

    expect(summary.freezersCreated).toBe(1);
    expect(summary.shelvesCreated).toBe(1);
    expect(summary.racksCreated).toBe(1);
    expect(summary.drawersCreated).toBe(0);
    expect(summary.boxesCreated).toBe(1);
    expect(summary.assignmentsCreated).toBe(1);

    const freezer = db.collections.storageContainers.docs.find((c) => c.containerType === 'FREEZER');
    const shelf = db.collections.storageContainers.docs.find((c) => c.containerType === 'SHELF');
    const rack = db.collections.storageContainers.docs.find((c) => c.containerType === 'RACK');
    const box = db.collections.storageBoxes.docs[0];

    expect(freezer.containerID).toBe(5);
    expect(freezer.parent_id).toBeNull();
    expect(shelf.parent_id).toBe(freezer._id);
    expect(rack.parent_id).toBe(shelf._id);
    expect(box.parent_id).toBe(rack._id);

    expect(locationIdToBoxId.get(101)).toBe(box._id);

    const assignment = db.collections.storageAssignments.docs[0];
    expect(assignment.specimenId).toBe('sample-1');
    expect(assignment.boxId).toBe(String(box._id));
    expect(assignment.positionCode).toBe('A1');
    expect(assignment.removedAt).toBeNull();
  });

  it('routes the box through a DRAWER when the legacy location has one', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 202, equipmentID: 5, block: 1, rack: 2, drawer: 7, box: 3, wellPosition: 'B2' },
      ],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.drawersCreated).toBe(1);
    expect(summary.boxesCreated).toBe(1);

    const drawer = db.collections.storageContainers.docs.find((c) => c.containerType === 'DRAWER');
    const rack = db.collections.storageContainers.docs.find((c) => c.containerType === 'RACK');
    const box = db.collections.storageBoxes.docs[0];

    expect(drawer.parent_id).toBe(rack._id);
    expect(box.parent_id).toBe(drawer._id);
  });

  it('backfills a single synthetic SHELF per freezer when block is null, without inventing a "no shelf" branch', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 301, equipmentID: 9, block: null, rack: 1, drawer: null, box: 1, wellPosition: 'A1' },
        { locationID: 302, equipmentID: 9, block: null, rack: 1, drawer: null, box: 2, wellPosition: 'A2' },
      ],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.freezersCreated).toBe(1);
    expect(summary.shelvesCreated).toBe(1); // both locations share the synthetic SHELF
    expect(summary.racksCreated).toBe(1);
    expect(summary.boxesCreated).toBe(2);
  });

  it('reuses existing containers/boxes across distinct locations sharing the same tuple prefix (idempotent chain materialization)', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 401, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
        { locationID: 402, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A2' },
      ],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.freezersCreated).toBe(1);
    expect(summary.shelvesCreated).toBe(1);
    expect(summary.racksCreated).toBe(1);
    expect(summary.boxesCreated).toBe(1);
    expect(db.collections.storageBoxes.docs).toHaveLength(1);
  });

  it('skips a location missing equipmentID or rack rather than inventing a fallback, and records the skip', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 501, equipmentID: null, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
        { locationID: 502, equipmentID: 5, block: 1, rack: null, drawer: null, box: 3, wellPosition: 'A1' },
      ],
    });

    const { summary, locationIdToBoxId } = await backfillLocationsToStorage(db);

    expect(summary.boxesCreated).toBe(0);
    expect(summary.skipped).toHaveLength(2);
    expect(locationIdToBoxId.has(501)).toBe(false);
    expect(locationIdToBoxId.has(502)).toBe(false);
  });

  it('does not touch the `locations` collection (read-only)', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 601, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
      ],
    });
    const before = JSON.stringify(db.collections.locations.docs);

    await backfillLocationsToStorage(db);

    expect(JSON.stringify(db.collections.locations.docs)).toBe(before);
  });

  it('is safe to run twice: does not duplicate an already-open StorageAssignment for the same specimen/box/position', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 701, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
      ],
      samples: [{ _id: 'sample-7', locationID: 701, registeredAt: new Date('2026-01-01') }],
    });

    await backfillLocationsToStorage(db);
    const secondRun = await backfillLocationsToStorage(db);

    expect(db.collections.storageAssignments.docs).toHaveLength(1);
    expect(secondRun.summary.assignmentsCreated).toBe(0);
  });
});
