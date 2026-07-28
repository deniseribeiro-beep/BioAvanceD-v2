import { describe, it, expect, vi } from 'vitest';
const { resolveCollectionName, getCollection } = require('../../src/utils/collectionResolver');

function makeDb(existingCollections = [], countMap = {}) {
  return {
    listCollections: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(existingCollections.map((name) => ({ name })))
    }),
    collection: vi.fn().mockImplementation((name) => ({
      collectionName: name,
      createIndex: vi.fn().mockResolvedValue(null),
      estimatedDocumentCount: vi.fn().mockResolvedValue(countMap[name] || 0),
      updateOne: vi.fn(),
      deleteOne: vi.fn(),
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue(null) }) }) }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock' }),
    }))
  };
}

describe('resolveCollectionName', () => {
  it('throws for invalid key', () => {
    const db = makeDb();
    expect(() => resolveCollectionName(db, 'nonExistentKey')).toThrow('inválida');
  });

  it('returns preferred name when collection exists in DB', async () => {
    const db = makeDb(['patients']);
    const name = await resolveCollectionName(db, 'patients');
    expect(name).toBe('patients');
  });

  it('returns preferred name when db has no listCollections method', async () => {
    const db = { collection: vi.fn() }; // no listCollections
    const name = await resolveCollectionName(db, 'patients');
    expect(name).toBe('patients');
  });

  it('returns preferred name even when only an alias-like collection exists (no alias fallback)', async () => {
    const db = makeDb(['pacientes']); // legacy alias name; alias subsystem was removed
    const name = await resolveCollectionName(db, 'patients');
    expect(name).toBe('patients');
  });

  it('returns preferred name when neither preferred nor any other collection is found', async () => {
    const db = makeDb([]); // empty db
    const name = await resolveCollectionName(db, 'patients');
    expect(name).toBe('patients');
  });
});

describe('getCollection', () => {
  it('returns collection for valid key', async () => {
    const db = makeDb(['patients']);
    const coll = await getCollection(db, 'patients');
    expect(coll).toBeDefined();
  });

  it('returns collection for sampleMovements with append-only enforcement', async () => {
    const db = makeDb(['sample_movements']);
    const coll = await getCollection(db, 'sampleMovements');
    expect(coll).toBeDefined();
    // append-only: updateOne should throw
    await expect(coll.updateOne({})).rejects.toThrow('POLICY_APPEND_ONLY');
  });

  it('throws synchronously for an invalid key, so an unawaited chained call fails loud and clean (#306)', () => {
    // The original trap: getCollection(db, key).find(...) without `await`
    // threw a *different*, misleading TypeError ("...find is not a
    // function") at the chained call, while the real "Collection key
    // inválida" rejection from the still-pending async getCollection()
    // promise went unhandled and crashed the process later. Now that
    // getCollection() throws synchronously for an invalid key (no promise
    // is ever created), the chained call raises the real error immediately
    // and there is nothing left to reject asynchronously.
    const db = makeDb();
    expect(() => getCollection(db, 'nonExistentKey').find({})).toThrow('inválida');
  });

  it('returns collection even when no listCollections available on db', async () => {
    const db = {
      collection: vi.fn().mockReturnValue({
        collectionName: 'patients',
        createIndex: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn(),
        deleteOne: vi.fn(),
        find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue(null) }) }) }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'mock' }),
      })
    };
    const coll = await getCollection(db, 'patients');
    expect(coll).toBeDefined();
  });
});
