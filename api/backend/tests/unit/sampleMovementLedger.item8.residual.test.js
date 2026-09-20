import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  appendMovementWithHashChain,
  ensureSampleMovementIndexes,
  computeMovementChainHash,
} = require('../../src/utils/sampleMovementLedger');

function makeCursor(previous) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    next: vi.fn().mockResolvedValue(previous),
  };
}

describe('sampleMovementLedger item 8 residual branches', () => {
  it('rejects append attempts without a specimenId before reading the ledger', async () => {
    const collection = {
      find: vi.fn(),
      insertOne: vi.fn(),
    };

    const error = await appendMovementWithHashChain(collection, { movementId: 'mv-1' }).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(422);
    expect(collection.find).not.toHaveBeenCalled();
    expect(collection.insertOne).not.toHaveBeenCalled();
  });

  it('chains from a previous chainHash fallback and passes the transaction session to both read and insert', async () => {
    const session = { id: 'session-1' };
    const previous = { chainHash: 'previous-chain-hash' };
    const cursor = makeCursor(previous);
    const collection = {
      find: vi.fn(() => cursor),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'row-2' }),
    };
    const movement = {
      movementId: 'mv-2',
      specimenId: ' specimen-2 ',
      barcode: 'BC-2',
      type: 'allocate',
      quantity: 1,
      unit: 'tube',
      createdAt: new Date('2026-09-19T12:00:00.000Z'),
    };

    const result = await appendMovementWithHashChain(collection, movement, { session });

    expect(collection.find).toHaveBeenCalledWith({ specimenId: 'specimen-2' }, { session });
    expect(collection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        movementId: 'mv-2',
        specimenId: ' specimen-2 ',
        previousHash: 'previous-chain-hash',
        hash: expect.any(String),
        updatedAt: expect.any(Date),
      }),
      { session }
    );
    expect(result).toEqual({
      movementId: 'mv-2',
      hash: computeMovementChainHash(movement, 'previous-chain-hash'),
      previousHash: 'previous-chain-hash',
    });
  });

  it('uses the previous hash field before chainHash and returns null movementId when absent', async () => {
    const previous = { hash: 'preferred-hash', chainHash: 'fallback-hash' };
    const collection = {
      find: vi.fn(() => makeCursor(previous)),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'row-3' }),
    };

    const result = await appendMovementWithHashChain(collection, {
      specimenId: 'specimen-3',
      type: 'release',
    });

    expect(result.previousHash).toBe('preferred-hash');
    expect(result.movementId).toBeNull();
    expect(collection.insertOne.mock.calls[0]).toHaveLength(2);
    expect(collection.insertOne.mock.calls[0][1]).toBeUndefined();
  });

  it('tolerates individual index creation failures while attempting every required ledger index', async () => {
    const createIndex = vi.fn()
      .mockRejectedValueOnce(new Error('movement index already incompatible'))
      .mockResolvedValueOnce('specimen-index')
      .mockRejectedValueOnce(new Error('barcode index unavailable'))
      .mockResolvedValueOnce('hash-index');

    await expect(ensureSampleMovementIndexes({ createIndex })).resolves.toBeUndefined();

    expect(createIndex).toHaveBeenCalledTimes(4);
    expect(createIndex).toHaveBeenNthCalledWith(
      1,
      { movementId: 1 },
      expect.objectContaining({ unique: true })
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      4,
      { hash: 1 },
      expect.objectContaining({ unique: true })
    );
  });

  it('is a no-op when index initialization receives no collection', async () => {
    await expect(ensureSampleMovementIndexes(null)).resolves.toBeUndefined();
  });
});
