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

    expect(collection.createIndex).toHaveBeenCalledTimes(1);
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
    const collection = makeCollection(async () => {
      throw new Error('E11000 duplicate key error collection: bio.samples index: samples_barcode_unique_v1');
    });

    await expect(ensureSampleIndexes(collection)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('E11000');
    expect(warn.mock.calls[0][0]).toContain('#936');
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

  it('ensures the samples indexes on first resolution, and only once per process', () => {
    const { getCollection } = freshResolver();
    const collection = makeCollection();
    const db = { collection: vi.fn(() => collection) };

    getCollection(db, 'samples');
    getCollection(db, 'samples');
    getCollection(db, 'samples');

    expect(collection.createIndex).toHaveBeenCalledTimes(1);
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
