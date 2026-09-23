/**
 * #936 item 1: the samples.barcode unique index, and its wiring.
 *
 * The wiring is as much the subject as the index. `Sample.js:35` has
 * declared `barcode: { type: String, index: true }` all along and that
 * declaration never reaches Mongo — the mongoose connection is opened with
 * `autoIndex: false` and nothing calls `syncIndexes()`/`createIndexes()`
 * anywhere in `api/`. So a schema-level `unique: true` would have been a
 * no-op that reads as a fix, which is the trap these cases exist to keep
 * shut.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { ensureSampleIndexes } = require('../../src/utils/sampleIndexes');
const logger = require('../../src/utils/logger');

function makeCollection(createIndexImpl) {
  return { createIndex: vi.fn(createIndexImpl || (async () => 'ok')) };
}

describe('#936 ensureSampleIndexes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a partial UNIQUE index on barcode', async () => {
    const collection = makeCollection();

    await ensureSampleIndexes(collection);

    const [keys, options] = collection.createIndex.mock.calls[0];
    expect(keys).toEqual({ barcode: 1 });
    expect(options.unique).toBe(true);
    expect(options.name).toBe('samples_barcode_unique_v1');
  });

  // The filter is the whole design decision, so it is pinned by value, not
  // by "is partial". SampleModel.create writes `barcode: data.barcode ||
  // null` — an explicit null on every barcodeless sample. `$exists: true`
  // (what the sibling sample_movements indexes use) and `sparse: true`
  // (what StorageBox.boxID uses) would both match those nulls, so the
  // second barcodeless sample ever created would collide with the first and
  // the insert would fail. `$type: 'string'` indexes only real barcodes.
  it('filters on $type string, not $exists or sparse, because barcode is written as an explicit null', async () => {
    const collection = makeCollection();

    await ensureSampleIndexes(collection);

    const [, options] = collection.createIndex.mock.calls[0];
    expect(options.partialFilterExpression).toEqual({ barcode: { $type: 'string' } });
    expect(options.sparse).toBeUndefined();
    expect(JSON.stringify(options.partialFilterExpression)).not.toContain('$exists');
  });

  // A failed index build must not take down sample reads -- but the failure
  // that matters (E11000 over already-duplicated barcodes) must be visible,
  // not swallowed.
  it('logs and does not throw when the index cannot be built', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = makeCollection(async (keys) => {
      if (keys.barcode) {
        throw new Error('E11000 duplicate key error collection: bio.samples index: samples_barcode_unique_v1');
      }
      return 'ok';
    });

    await expect(ensureSampleIndexes(collection)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('E11000');
    expect(warn.mock.calls[0][0]).toContain('#936');
  });

  // #941: the two lookup indexes `Sample.js` has always declared and never
  // built. Measured with explain('executionStats') on mongo:7 over 20k
  // samples: `findOne({ specimenId })` examined 12,346 docs as a COLLSCAN and
  // 1 with the index; the participantId list examined 20,000 and 5. Both
  // are non-unique -- the declaration never said unique, and making it so
  // would be a constraint decision, not an index build.
  it.each([
    [{ specimenId: 1 }, 'samples_specimenid_idx_v1'],
    [{ participantId: 1 }, 'samples_participantid_idx_v1'],
  ])('builds the non-unique %o lookup index', async (keys, name) => {
    const collection = makeCollection();

    await ensureSampleIndexes(collection);

    const call = collection.createIndex.mock.calls.find(([k]) => JSON.stringify(k) === JSON.stringify(keys));
    expect(call).toBeDefined();
    expect(call[1].name).toBe(name);
    expect(call[1].unique).toBeUndefined();
    expect(call[1].partialFilterExpression).toBeUndefined();
  });

  // Per-index catches (#1027's shape): a failed barcode build -- the E11000
  // case above -- must not cost the lookup builds after it.
  it('still builds both lookup indexes when the barcode build fails', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = makeCollection(async (keys) => {
      if (keys.barcode) throw new Error('E11000 duplicate key error');
      return 'ok';
    });

    await ensureSampleIndexes(collection);

    const built = collection.createIndex.mock.calls.map(([k]) => Object.keys(k)[0]);
    expect(built).toEqual(expect.arrayContaining(['specimenId', 'participantId']));
  });

  // A lookup build failing costs a query plan, never data integrity, so its
  // message must not borrow the unique index's duplicates wording.
  it('reports a lookup build failure as a performance loss, not as duplicates', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = makeCollection(async (keys) => {
      if (keys.specimenId) throw new Error('boom');
      return 'ok';
    });

    await ensureSampleIndexes(collection);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('samples_specimenid_idx_v1');
    expect(warn.mock.calls[0][0]).toContain('desempenho');
    expect(warn.mock.calls[0][0]).not.toContain('duplicados');
  });

  it('is a no-op for a collection handle that cannot create indexes', async () => {
    await expect(ensureSampleIndexes(null)).resolves.toBeUndefined();
    await expect(ensureSampleIndexes({})).resolves.toBeUndefined();
  });
});

describe('#936 collectionResolver wiring', () => {
  const resolverPath = require.resolve('../../src/utils/collectionResolver');

  function freshResolver() {
    delete require.cache[resolverPath];
    return require(resolverPath);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ensures the samples indexes on first resolution, and only once per process', async () => {
    const { getCollection } = freshResolver();
    const collection = makeCollection();
    const db = { collection: vi.fn(() => collection) };

    getCollection(db, 'samples');
    getCollection(db, 'samples');
    getCollection(db, 'samples');
    // The resolver fires the helper without awaiting it; let its sequential
    // builds settle before counting them.
    await new Promise((resolve) => setImmediate(resolve));

    expect(collection.createIndex).toHaveBeenCalledTimes(3);
  });

  // The resolver's own header explains why only sampleMovements returns a
  // promise: a caller chaining `getCollection(db, key).find(...)` without
  // `await` must fail loudly (#306). `samples` is the most-called key here,
  // so it must stay synchronous — a thenable would silently change what
  // every one of those call sites receives.
  it('still returns the samples collection synchronously, not a promise', () => {
    const { getCollection } = freshResolver();
    const collection = makeCollection();
    const db = { collection: vi.fn(() => collection) };

    const resolved = getCollection(db, 'samples');

    expect(resolved).toBe(collection);
    expect(typeof resolved.then).not.toBe('function');
  });

  it('does not build the samples index when some other collection is resolved', () => {
    const { getCollection } = freshResolver();
    const collection = makeCollection();
    const db = { collection: vi.fn(() => collection) };

    getCollection(db, 'patients');

    expect(collection.createIndex).not.toHaveBeenCalled();
  });
});
