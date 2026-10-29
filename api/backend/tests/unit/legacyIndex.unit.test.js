/**
 * #1164: dropLegacyIndex, the shared drop for an index superseded by a new
 * versioned name.
 *
 * A changed partialFilterExpression makes a DIFFERENT index even over the
 * same keys, so the old one lingers beside its replacement unless something
 * drops it. `[ran it]` on mongo:7: v2 builds alongside v1 on the same key
 * pattern, v1 then drops by name, and dropping a name that is not there
 * fails with IndexNotFound (code 27) -- the normal case on any collection
 * that never held the old index, which must stay silent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { dropLegacyIndex } = require('../../src/utils/legacyIndex');
const logger = require('../../src/utils/logger');

describe('#1164 dropLegacyIndex', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('drops the named index', async () => {
    const collection = { dropIndex: vi.fn(async () => {}) };

    await dropLegacyIndex(collection, 'samples_barcode_unique_v1', 'SAMPLES');

    expect(collection.dropIndex).toHaveBeenCalledWith('samples_barcode_unique_v1');
  });

  // The never-held case: every fresh collection, every test stack.
  it.each([
    ['codeName', Object.assign(new Error('index not found'), { codeName: 'IndexNotFound' })],
    ['numeric code 27', Object.assign(new Error('index not found'), { code: 27 })],
  ])('stays silent on IndexNotFound (%s)', async (_label, error) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = { dropIndex: vi.fn(async () => { throw error; }) };

    await expect(dropLegacyIndex(collection, 'x_v1', 'SAMPLES')).resolves.toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
  });

  it('logs any other failure, naming the index, and does not throw', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const collection = { dropIndex: vi.fn(async () => { throw new Error('not authorized'); }) };

    await expect(dropLegacyIndex(collection, 'samples_barcode_unique_v1', 'SAMPLES')).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('samples_barcode_unique_v1');
    expect(warn.mock.calls[0][0]).toContain('#1164');
  });

  // Most unit mocks in this suite are `{ createIndex }` only.
  it('is a no-op for a handle without dropIndex', async () => {
    await expect(dropLegacyIndex(null, 'x_v1', 'T')).resolves.toBeUndefined();
    await expect(dropLegacyIndex({ createIndex: vi.fn() }, 'x_v1', 'T')).resolves.toBeUndefined();
  });
});
