import { describe, it, expect } from 'vitest';
const { computeMovementChainHash, enforceAppendOnlyCollection } = require('../../src/utils/sampleMovementLedger');

describe('computeMovementChainHash', () => {
  const baseMovement = {
    movementID: 1,
    sampleID: 'SMP-001',
    barcode: 'BAR-001',
    type: 'INTAKE',
    quantity: 5,
    unit: 'mL',
    timestamp: '2026-01-01T00:00:00.000Z',
    previousQuantity: 0,
    newQuantity: 5,
  };

  it('returns a 64-char hex hash', () => {
    const hash = computeMovementChainHash(baseMovement, null);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it('is deterministic for same movement and previousHash', () => {
    const h1 = computeMovementChainHash(baseMovement, null);
    const h2 = computeMovementChainHash(baseMovement, null);
    expect(h1).toBe(h2);
  });

  it('differs when previousHash changes', () => {
    const h1 = computeMovementChainHash(baseMovement, null);
    const h2 = computeMovementChainHash(baseMovement, 'abc123');
    expect(h1).not.toBe(h2);
  });

  it('differs for different sampleIDs', () => {
    const mov2 = { ...baseMovement, sampleID: 'SMP-002' };
    expect(computeMovementChainHash(baseMovement, null)).not.toBe(computeMovementChainHash(mov2, null));
  });

  it('handles missing fields gracefully', () => {
    const minimal = { sampleID: 'SMP-999' };
    const hash = computeMovementChainHash(minimal, null);
    expect(hash).toHaveLength(64);
  });

  it('chains correctly: hash of movement2 depends on hash of movement1', () => {
    const h1 = computeMovementChainHash(baseMovement, null);
    const movement2 = { ...baseMovement, movementID: 2, quantity: 3, newQuantity: 8 };
    const h2 = computeMovementChainHash(movement2, h1);
    expect(h2).not.toBe(h1);
    expect(h2).toHaveLength(64);
  });
});

describe('enforceAppendOnlyCollection', () => {
  function makeMockCollection(name = 'sample_movements') {
    return {
      collectionName: name,
      updateOne: () => Promise.resolve({ modifiedCount: 1 }),
      updateMany: () => Promise.resolve({ modifiedCount: 1 }),
      deleteOne: () => Promise.resolve({ deletedCount: 1 }),
      deleteMany: () => Promise.resolve({ deletedCount: 1 }),
      findOneAndUpdate: () => Promise.resolve(null),
      findOneAndDelete: () => Promise.resolve(null),
      findOneAndReplace: () => Promise.resolve(null),
      replaceOne: () => Promise.resolve({ modifiedCount: 1 }),
      bulkWrite: (ops, options) => Promise.resolve({ ok: 1 }),
      insertOne: () => Promise.resolve({ insertedId: 'mock' }),
    };
  }

  it('returns the collection unchanged for null/non-object input', () => {
    expect(enforceAppendOnlyCollection(null)).toBeNull();
    expect(enforceAppendOnlyCollection(undefined)).toBeUndefined();
  });

  it('overrides updateOne to throw POLICY_APPEND_ONLY', async () => {
    const coll = makeMockCollection();
    enforceAppendOnlyCollection(coll, 'sample_movements_test_a');
    await expect(coll.updateOne({})).rejects.toThrow('POLICY_APPEND_ONLY');
  });

  it('overrides deleteOne to throw POLICY_APPEND_ONLY', async () => {
    const coll = makeMockCollection();
    enforceAppendOnlyCollection(coll, 'sample_movements_test_b');
    await expect(coll.deleteOne({})).rejects.toThrow('POLICY_APPEND_ONLY');
  });

  it('overrides deleteMany to throw POLICY_APPEND_ONLY', async () => {
    const coll = makeMockCollection();
    enforceAppendOnlyCollection(coll, 'sample_movements_test_c');
    await expect(coll.deleteMany({})).rejects.toThrow('POLICY_APPEND_ONLY');
  });

  it('overrides findOneAndUpdate to throw POLICY_APPEND_ONLY', async () => {
    const coll = makeMockCollection();
    enforceAppendOnlyCollection(coll, 'sample_movements_test_d');
    await expect(coll.findOneAndUpdate({})).rejects.toThrow('POLICY_APPEND_ONLY');
  });

  it('allows insertOne to proceed normally', async () => {
    const coll = makeMockCollection();
    enforceAppendOnlyCollection(coll, 'sample_movements_test_e');
    const result = await coll.insertOne({ sampleID: 'SMP-001' });
    expect(result.insertedId).toBe('mock');
  });

  it('bulkWrite throws when containing updateOne operations', async () => {
    const coll = makeMockCollection();
    enforceAppendOnlyCollection(coll, 'sample_movements_test_f');
    const ops = [{ updateOne: { filter: {}, update: { $set: { x: 1 } } } }];
    await expect(coll.bulkWrite(ops)).rejects.toThrow('POLICY_APPEND_ONLY');
  });

  it('bulkWrite allows insertOne-only operations', async () => {
    const coll = makeMockCollection();
    enforceAppendOnlyCollection(coll, 'sample_movements_test_g');
    const ops = [{ insertOne: { document: { sampleID: 'SMP-001' } } }];
    await expect(coll.bulkWrite(ops)).resolves.toBeDefined();
  });
});
