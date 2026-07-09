import { describe, it, expect, vi, beforeEach } from 'vitest';

const sampleMovementLedger = require('../../src/utils/sampleMovementLedger');
const MongoAuditRepository = require('../../src/infrastructure/persistence/mongo/MongoAuditRepository');

function makeSharedCollection() {
  return {
    createIndex: vi.fn().mockResolvedValue('idx'),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      next: vi.fn().mockResolvedValue(null),
    }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'movement-id' }),
    findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 7 } }),
  };
}

describe('MongoAuditRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sampleMovementLedger.enforceAppendOnlyCollection = vi.fn((collection) => {
      collection.findOneAndUpdate = vi.fn(() => Promise.reject(new Error('POLICY_APPEND_ONLY')));
    });
    sampleMovementLedger.ensureSampleMovementIndexes = vi.fn().mockResolvedValue(undefined);
    sampleMovementLedger.appendMovementWithHashChain = vi.fn().mockResolvedValue({ movementId: 123, hash: 'hash', previousHash: null });
  });

  it('isola a protecao append-only do ledger e preserva o contador', async () => {
    const sharedCollection = makeSharedCollection();
    const db = {
      collection: vi.fn(() => sharedCollection),
    };
    const repository = new MongoAuditRepository(db);

    const result = await repository.appendImmutableAudit({
      specimenId: 'spec-001',
      eventType: 'audit',
      before: { a: 1 },
      after: { a: 2 },
      context: { actor: { userName: 'tester', userId: 'u1' } },
      timestamp: new Date('2026-07-02T10:00:00.000Z'),
    });

    expect(result).toEqual({ movementID: 7 });
    expect(db.collection).toHaveBeenNthCalledWith(1, 'sample_movements');
    expect(db.collection).toHaveBeenNthCalledWith(2, 'counters');
    expect(sampleMovementLedger.enforceAppendOnlyCollection).toHaveBeenCalledTimes(1);
    expect(sampleMovementLedger.enforceAppendOnlyCollection).toHaveBeenCalledWith(expect.any(Object), 'sample_movements');
    expect(sharedCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(sharedCollection.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'sample_movements' },
      expect.objectContaining({
        $inc: { seq: 1 },
      }),
      expect.objectContaining({
        upsert: true,
        returnDocument: 'after',
      })
    );
    expect(sampleMovementLedger.appendMovementWithHashChain).toHaveBeenCalledTimes(1);
    expect(sampleMovementLedger.ensureSampleMovementIndexes).toHaveBeenCalledTimes(1);
  });
});
