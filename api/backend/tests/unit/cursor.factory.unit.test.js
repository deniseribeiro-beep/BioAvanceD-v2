/**
 * #781: tests for the shared cursor mock factory itself.
 *
 * The factory exists so a new test can assert what a handler ordered on
 * without re-deriving a stub. The 165 identity-form stubs it replaces
 * (`sort() { return chain; }`) could not fail no matter which key the
 * product code passed, which is how #769 (a sort on a field no document
 * carries) and #775 (a lexicographic sort picking the wrong "highest"
 * barcode) both stayed invisible.
 *
 * `reports.routes.gaps.test.js`'s migration exercises `capturedSorts`
 * only. These tests cover the rest of the factory's contract directly --
 * the capture of `limit`/`skip`, and the any-order chainability that the
 * comment in the factory says a real caller needed. A helper whose own
 * guarantees are untested is the same shape of blind spot it was built
 * to remove.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createCursorMock,
  createCursorCaptureStore,
} = require('../factories/cursor.factory');

const DOCS = [{ _id: 'a' }, { _id: 'b' }];

describe('cursor.factory (#781)', () => {
  describe('chainability in any order', () => {
    it('resolves through sort().limit().toArray()', async () => {
      const cursor = createCursorMock(DOCS);
      await expect(cursor.sort({ registeredAt: -1 }).limit(5).toArray()).resolves.toEqual(DOCS);
    });

    it('resolves through limit().sort().toArray() -- the reversed order', async () => {
      const cursor = createCursorMock(DOCS);
      await expect(cursor.limit(5).sort({ registeredAt: -1 }).toArray()).resolves.toEqual(DOCS);
    });

    it('resolves a bare toArray() with no chain call at all', async () => {
      const cursor = createCursorMock(DOCS);
      await expect(cursor.toArray()).resolves.toEqual(DOCS);
    });

    it('resolves through skip().limit().sort().toArray()', async () => {
      const cursor = createCursorMock(DOCS);
      await expect(cursor.skip(2).limit(5).sort({ _id: 1 }).toArray()).resolves.toEqual(DOCS);
    });

    it('defaults to an empty result when constructed with no documents', async () => {
      await expect(createCursorMock().toArray()).resolves.toEqual([]);
    });
  });

  describe('spec capture -- the whole point of the factory', () => {
    it('captures the sort spec against the collection key', () => {
      const store = createCursorCaptureStore();
      createCursorMock(DOCS, { ...store, key: 'samples' }).sort({ registeredAt: -1 });

      expect(store.capturedSorts.samples).toEqual({ registeredAt: -1 });
    });

    it('captures limit and skip, which the identity-form stubs also swallowed', () => {
      const store = createCursorCaptureStore();
      createCursorMock(DOCS, { ...store, key: 'samples' }).skip(10).limit(25);

      expect(store.capturedSkips.samples).toBe(10);
      expect(store.capturedLimits.samples).toBe(25);
    });

    it('keeps captures separate per collection key', () => {
      const store = createCursorCaptureStore();
      createCursorMock(DOCS, { ...store, key: 'samples' }).sort({ registeredAt: -1 });
      createCursorMock(DOCS, { ...store, key: 'equipment' }).sort({ createdAt: 1 });

      expect(store.capturedSorts.samples).toEqual({ registeredAt: -1 });
      expect(store.capturedSorts.equipment).toEqual({ createdAt: 1 });
    });

    it('records the last spec when a collection is queried more than once', () => {
      const store = createCursorCaptureStore();
      const key = 'samples';
      createCursorMock(DOCS, { ...store, key }).sort({ registeredAt: -1 });
      createCursorMock(DOCS, { ...store, key }).sort({ createdAt: 1 });

      // Documented behaviour, not an accident: the store is a
      // per-collection dictionary, so a second query overwrites the
      // first. A test asserting ordering across two queries of the same
      // collection has to read between them.
      expect(store.capturedSorts[key]).toEqual({ createdAt: 1 });
    });

    it('still works with no capture store wired, exposing calls via the vi.fn mocks', () => {
      const cursor = createCursorMock(DOCS);
      cursor.sort({ _id: 1 });

      expect(cursor.sort).toHaveBeenCalledWith({ _id: 1 });
    });
  });
});
