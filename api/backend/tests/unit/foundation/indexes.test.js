import { describe, it, expect } from 'vitest';
const { INDEX_TARGETS, buildFoundationIndexes, verifyFoundationIndexes } = require('../../../src/foundation/indexes');
const { ensureSessionIndexes } = require('../../../src/utils/sessionIndexes');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('./helpers/fake-db');

/**
 * RF022 AC2: the Foundation job builds every model index before the APIs
 * start and learns which builds failed, although each helper swallows its
 * own errors so its request path keeps serving.
 *
 * The helpers latch per process by collection name, so the full-target
 * build runs first in this file, and the failure case uses a collection
 * name no other test has latched.
 */
describe('Foundation index builds', () => {
  it('builds an index on every target collection, and every build reads back', async () => {
    const db = createFakeDb();
    const builds = await buildFoundationIndexes(db);

    for (const { collection } of INDEX_TARGETS) {
      expect(db.collection(collection).indexes.length, collection).toBeGreaterThan(1);
      expect(builds.some((build) => build.collection === collection), collection).toBe(true);
    }
    expect(builds.every((build) => build.ok === true)).toBe(true);
    expect(builds.some((build) => build.unique)).toBe(true);
    expect(await verifyFoundationIndexes(db, builds)).toEqual([]);
  });

  // #1374: a chain write inside a caller's session builds no index, so the
  // Foundation job builds the chain's and StorageLocation's partial unique
  // indexes beforehand.
  it('builds the physical chain and StorageLocation indexes by name', async () => {
    const chainCollections = [
      CANONICAL_COLLECTIONS.containers,
      CANONICAL_COLLECTIONS.specimenContainerAssignments,
      CANONICAL_COLLECTIONS.containerPositionAssignments,
      CANONICAL_COLLECTIONS.rackLocationAssignments,
      CANONICAL_COLLECTIONS.storageLocations,
    ];
    const targeted = INDEX_TARGETS.map((target) => target.collection);
    for (const collection of chainCollections) expect(targeted, collection).toContain(collection);

    const builds = await buildFoundationIndexes(createFakeDb());
    const named = (name) => builds.find((build) => build.name === name);
    for (const [name, collection] of [
      ['uniq_containerId', CANONICAL_COLLECTIONS.containers],
      ['uniq_open_specimen', CANONICAL_COLLECTIONS.specimenContainerAssignments],
      ['uniq_open_container', CANONICAL_COLLECTIONS.containerPositionAssignments],
      ['uniq_open_position', CANONICAL_COLLECTIONS.containerPositionAssignments],
      ['uniq_open_rack', CANONICAL_COLLECTIONS.rackLocationAssignments],
      ['uniq_storageLocationId', CANONICAL_COLLECTIONS.storageLocations],
      ['uniq_active_label_value', CANONICAL_COLLECTIONS.labelIdentifiers],
    ]) {
      expect(named(name), name).toMatchObject({ collection, unique: true, ok: true });
    }
  });

  it('reports a build whose index is gone on read-back', async () => {
    const db = createFakeDb();
    const builds = [{ collection: 'facilities', keys: { name: 1 }, name: 'facilities_name_idx_v1', unique: false, ok: true }];
    await db.collection('facilities').createIndex({ name: 1 }, { name: 'facilities_name_idx_v1' });
    expect(await verifyFoundationIndexes(db, builds)).toEqual([]);

    await db.collection('facilities').dropIndex('facilities_name_idx_v1');
    expect(await verifyFoundationIndexes(db, builds)).toEqual(builds);
  });

  it('records a failed build that the helper itself swallows', async () => {
    const db = createFakeDb({
      'sessions-failing': () => ({
        createIndex: async () => {
          throw new Error('index build interrupted');
        },
      }),
    });
    const builds = await buildFoundationIndexes(db, [{ collection: 'sessions-failing', ensure: ensureSessionIndexes }]);

    expect(builds.length).toBeGreaterThan(0);
    expect(builds.every((build) => build.ok === false && build.error === 'index build interrupted')).toBe(true);
    expect(await verifyFoundationIndexes(db, builds)).toHaveLength(builds.length);
  });
});
