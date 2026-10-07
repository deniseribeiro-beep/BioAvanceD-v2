import { describe, it, expect } from 'vitest';
const { INDEX_TARGETS, buildFoundationIndexes, verifyFoundationIndexes } = require('../../../src/foundation/indexes');
const { ensureSessionIndexes } = require('../../../src/utils/sessionIndexes');
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
