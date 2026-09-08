/**
 * #941: the stagingImports.jobId unique index, and its (self-contained)
 * latching.
 *
 * `StagingImport.js` has declared `jobId: { unique: true }` all along and that
 * declaration never reaches Mongo -- the mongoose connection is opened with
 * `autoIndex: false` and nothing calls `syncIndexes()`/`createIndexes()`
 * anywhere in `api/`. So a schema-level `unique: true` is a no-op that reads
 * as a fix, which is the trap these cases exist to keep shut. Modelled on
 * `tests/unit/storageIndexes.unit.test.js`, which is modelled on
 * `tests/unit/sampleIndexes.unit.test.js` (#936).
 *
 * The wiring -- that `createStagingImport` actually calls this -- is pinned
 * separately in `tests/unit/staging-import.service.test.js`. A helper nothing
 * invokes is #941's own defect one level up, and the two sibling helpers in
 * `utils/storageIndexes.js` have never had that half pinned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const modulePath = require.resolve('../../src/utils/stagingImportIndexes');

function freshStagingImportIndexes() {
  delete require.cache[modulePath];
  return require(modulePath);
}

function makeCollection(collectionName, createIndexImpl) {
  return {
    collectionName,
    createIndex: vi.fn(createIndexImpl || (async () => 'ok'))
  };
}

describe('#941 ensureStagingImportIndexes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a UNIQUE index on jobId', async () => {
    const { ensureStagingImportIndexes } = freshStagingImportIndexes();
    const collection = makeCollection('stagingImports');

    await ensureStagingImportIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledTimes(1);
    const [keys, options] = collection.createIndex.mock.calls[0];
    expect(keys).toEqual({ jobId: 1 });
    expect(options.unique).toBe(true);
    expect(options.name).toBe('staging_imports_jobid_unique_v1');
  });

  // The absence of a partial filter is the design decision here, so it is
  // pinned by value rather than left implicit. `jobId` is `required: true` on
  // the schema and is always set by createStagingImport, the collection's only
  // writer -- so every row carries one and a plain unique index is correct.
  // This is the sensorMetadata.sensorId case, NOT the samples.barcode /
  // storageContainers.containerID one, where a `$type` filter is load-bearing
  // because some rows legitimately omit the field.
  it('uses no partial filter, because every row carries a jobId', async () => {
    const { ensureStagingImportIndexes } = freshStagingImportIndexes();
    const collection = makeCollection('stagingImports');

    await ensureStagingImportIndexes(collection);

    const [, options] = collection.createIndex.mock.calls[0];
    expect(options.partialFilterExpression).toBeUndefined();
  });

  it('logs and does not throw when the index cannot be built', async () => {
    const { ensureStagingImportIndexes } = freshStagingImportIndexes();
    const logger = require('../../src/utils/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = makeCollection('stagingImports', async () => {
      throw new Error('E11000 duplicate key error collection: bio.stagingImports index: staging_imports_jobid_unique_v1');
    });

    await expect(ensureStagingImportIndexes(collection)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('E11000');
    expect(warn.mock.calls[0][0]).toContain('#941');
  });

  it('is a no-op for a collection handle that cannot create indexes', async () => {
    const { ensureStagingImportIndexes } = freshStagingImportIndexes();
    await expect(ensureStagingImportIndexes(null)).resolves.toBeUndefined();
    await expect(ensureStagingImportIndexes({})).resolves.toBeUndefined();
  });

  it('latches per resolved collection name -- calling it twice for the same collection issues createIndex once', async () => {
    const { ensureStagingImportIndexes } = freshStagingImportIndexes();
    const collection = makeCollection('stagingImports');

    await ensureStagingImportIndexes(collection);
    await ensureStagingImportIndexes(collection);
    await ensureStagingImportIndexes(collection);

    expect(collection.createIndex).toHaveBeenCalledTimes(1);
  });

  // The latch is keyed by resolved name rather than being a module-level
  // boolean, so a differently-named collection still gets its index built.
  it('does not let one collection name latch out another', async () => {
    const { ensureStagingImportIndexes } = freshStagingImportIndexes();
    const defaultCollection = makeCollection('stagingImports');
    const overriddenCollection = makeCollection('stagingImports_test');

    await ensureStagingImportIndexes(defaultCollection);
    await ensureStagingImportIndexes(overriddenCollection);

    expect(defaultCollection.createIndex).toHaveBeenCalledTimes(1);
    expect(overriddenCollection.createIndex).toHaveBeenCalledTimes(1);
  });
});
