import { describe, it, expect, vi } from 'vitest';

const sampleMovementLedger = require('../../src/utils/sampleMovementLedger');
const MongoAuditRepository = require('../../src/infrastructure/persistence/mongo/MongoAuditRepository');

/**
 * appendImmutableAudit builds its isolated collection view internally and
 * never returns it, so these tests capture it via a mocked
 * enforceAppendOnlyCollection call arg to exercise createIsolatedCollectionView's
 * defineProperty/deleteProperty Proxy traps and the overrides.has() branch in
 * get(), none of which the main suite's real-implementation calls happen to hit
 * (that suite only exercises the `set` trap, via plain assignment).
 */

function makeCountersCollection(seqValue) {
  return {
    collectionName: 'counters',
    findOneAndUpdate: vi.fn().mockResolvedValue({ value: { _id: 'sample_movements', seq: seqValue } })
  };
}

describe('MongoAuditRepository createIsolatedCollectionView (proxy traps)', () => {
  it('honors defineProperty overrides (get returns the defined value) and deleteProperty removal (get falls back to the target)', async () => {
    let capturedView;
    const enforceSpy = vi
      .spyOn(sampleMovementLedger, 'enforceAppendOnlyCollection')
      .mockImplementation((collection) => {
        capturedView = collection;
      });
    const ensureSpy = vi
      .spyOn(sampleMovementLedger, 'ensureSampleMovementIndexes')
      .mockResolvedValue(undefined);
    const appendSpy = vi
      .spyOn(sampleMovementLedger, 'appendMovementWithHashChain')
      .mockResolvedValue({ movementId: 1, hash: 'h', previousHash: null });

    try {
      const rawInsertOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const rawCollection = { collectionName: 'sampleMovements', insertOne: rawInsertOne };
      const counters = makeCountersCollection(10);
      const db = {
        collection: vi.fn((name) => (name === 'sampleMovements' ? rawCollection : counters))
      };
      const repo = new MongoAuditRepository(db);

      await repo.appendImmutableAudit(
        {
          specimenId: 'S-1',
          eventType: 'MOVE',
          before: {},
          after: {},
          timestamp: new Date()
        },
        undefined
      );

      expect(capturedView).toBeDefined();

      // defineProperty trap: value stored in overrides, get() returns it as-is
      // (not bound), independent of the target's own insertOne.
      const overrideFn = () => 'overridden';
      Object.defineProperty(capturedView, 'insertOne', { value: overrideFn });
      expect(capturedView.insertOne).toBe(overrideFn);

      // deleteProperty trap: removing the override falls back through to the
      // target's own (bound) method again.
      delete capturedView.insertOne;
      expect(capturedView.insertOne).not.toBe(overrideFn);
      await capturedView.insertOne({ some: 'doc' });
      expect(rawInsertOne).toHaveBeenCalledWith({ some: 'doc' });

      // get() with a plain (non-function) target property, once no override
      // is set, is returned as-is rather than bound.
      expect(capturedView.collectionName).toBe('sampleMovements');
    } finally {
      enforceSpy.mockRestore();
      ensureSpy.mockRestore();
      appendSpy.mockRestore();
    }
  });
});
