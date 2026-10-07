/**
 * #941: the facilities and rooms lookup indexes.
 *
 * Both were declared on the mongoose schemas (`Facility.js`, `Room.js`) and
 * neither ever reached Mongo — the connection is opened with
 * `autoIndex: false` and nothing calls `syncIndexes()`/`createIndexes()`.
 * See `storageIndexes.unit.test.js` for the sibling this is modelled on.
 *
 * Both are BUILD decisions taken from the planner rather than by inference.
 * Measured on mongo:7 (40 facilities / 1000 rooms), on the query shapes in
 * `facility.routes.js` and `room.routes.js`:
 *
 *   facilities  find({deletedAt:null}).sort({name:1})
 *               -> {name:1} wins, and the in-memory SORT stage disappears.
 *   rooms       find({deletedAt:null,facilityId}).sort({name:1})
 *               -> {facilityId:1,name:1} wins; examined 25 vs 1000 on a scan.
 *
 * Note this is the OPPOSITE verdict to the two standalone {name:1}
 * declarations deleted from StorageContainer.js and StorageBox.js, and the
 * difference is selectivity: those sorts follow a selective filter, so the
 * compound index wins and the small result sorts in memory. Here the filter
 * is `deletedAt: null`, which nearly every row matches, so the sort is the
 * dominant cost and the index that serves it wins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const modulePath = require.resolve('../../src/utils/facilityIndexes');

function freshFacilityIndexes() {
  delete require.cache[modulePath];
  return require(modulePath);
}

function makeCollection(collectionName, createIndexImpl) {
  return {
    collectionName,
    createIndex: vi.fn(createIndexImpl || (async () => 'ok'))
  };
}

describe('#941 ensureFacilityIndexes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the { name: 1 } index that serves the list sort', async () => {
    const { ensureFacilityIndexes } = freshFacilityIndexes();
    const collection = makeCollection('facilities');

    await ensureFacilityIndexes(collection);

    const call = collection.createIndex.mock.calls.find(
      ([k]) => Object.keys(k).length === 1 && k.name === 1
    );
    expect(call).toBeDefined();
    expect(call[1].unique).toBeUndefined();
    expect(call[1].name).toBe('facilities_name_idx_v1');
  });

  it('logs and does not throw when the index cannot be built', async () => {
    const { ensureFacilityIndexes } = freshFacilityIndexes();
    const logger = require('../../src/utils/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = makeCollection('facilities', async () => {
      throw new Error('boom');
    });

    await expect(ensureFacilityIndexes(collection)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('#941');
    // A lookup-index failure costs a query plan and nothing else.
    expect(warn.mock.calls[0][0]).toContain('desempenho');
  });

  it('is a no-op for a collection handle that cannot create indexes', async () => {
    const { ensureFacilityIndexes } = freshFacilityIndexes();
    await expect(ensureFacilityIndexes(null)).resolves.toBeUndefined();
    await expect(ensureFacilityIndexes({})).resolves.toBeUndefined();
  });

  it('latches per resolved collection name', async () => {
    const { ensureFacilityIndexes } = freshFacilityIndexes();
    const collection = makeCollection('facilities');

    await ensureFacilityIndexes(collection);
    await ensureFacilityIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledTimes(1);
  });
});

describe('#941 ensureRoomIndexes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the compound { facilityId, name } index, in that key order', async () => {
    const { ensureRoomIndexes } = freshFacilityIndexes();
    const collection = makeCollection('rooms');

    await ensureRoomIndexes(collection);

    const call = collection.createIndex.mock.calls.find(
      ([k]) => k.facilityId === 1 && k.name === 1
    );
    expect(call).toBeDefined();
    expect(call[1].unique).toBeUndefined();
    expect(call[1].name).toBe('rooms_facility_name_idx_v1');

    // Key ORDER is the whole design: the equality field must precede the sort
    // field, or the index cannot serve filter-then-sort in one pass.
    expect(Object.keys(call[0])).toEqual(['facilityId', 'name']);
  });

  it('is a no-op for a collection handle that cannot create indexes', async () => {
    const { ensureRoomIndexes } = freshFacilityIndexes();
    await expect(ensureRoomIndexes(null)).resolves.toBeUndefined();
    await expect(ensureRoomIndexes({})).resolves.toBeUndefined();
  });

  it('latches per resolved collection name', async () => {
    const { ensureRoomIndexes } = freshFacilityIndexes();
    const collection = makeCollection('rooms');

    await ensureRoomIndexes(collection);
    await ensureRoomIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledTimes(1);
  });

  it('does not let the facilities latch and the rooms latch shadow each other', async () => {
    const { ensureFacilityIndexes, ensureRoomIndexes } = freshFacilityIndexes();
    const facilities = makeCollection('facilities');
    const rooms = makeCollection('rooms');

    await ensureFacilityIndexes(facilities);
    await ensureRoomIndexes(rooms);

    expect(facilities.createIndex).toHaveBeenCalledTimes(1);
    expect(rooms.createIndex).toHaveBeenCalledTimes(1);
  });
});
