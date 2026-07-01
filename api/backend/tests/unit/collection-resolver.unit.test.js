import { describe, it, expect, vi } from 'vitest';
const { resolveCollectionName, resolveSourceCollectionName, getCollection } = require('../../src/utils/collectionResolver');

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
  it('throws for invalid key', async () => {
    const db = makeDb();
    await expect(resolveCollectionName(db, 'nonExistentKey')).rejects.toThrow('inválida');
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

  it('falls back to alias when preferred collection not found but alias is', async () => {
    const db = makeDb(['pacientes']); // alias for 'patients'
    const name = await resolveCollectionName(db, 'patients');
    expect(name).toBe('pacientes');
  });

  it('returns preferred name when neither preferred nor alias found', async () => {
    const db = makeDb([]); // empty db
    const name = await resolveCollectionName(db, 'patients');
    expect(name).toBe('patients');
  });
});

describe('resolveSourceCollectionName', () => {
  it('throws for invalid key', async () => {
    const db = makeDb();
    await expect(resolveSourceCollectionName(db, 'nonExistentKey')).rejects.toThrow('inválida');
  });

  it('returns preferred name when db has no listCollections', async () => {
    const db = { collection: vi.fn() };
    const name = await resolveSourceCollectionName(db, 'patients');
    expect(name).toBe('patients');
  });

  it('returns preferred when it has the most documents', async () => {
    const db = makeDb(['patients', 'pacientes'], { patients: 100, pacientes: 5 });
    const name = await resolveSourceCollectionName(db, 'patients');
    expect(name).toBe('patients');
  });

  it('returns alias when alias has the most documents', async () => {
    const db = makeDb(['patients', 'pacientes'], { patients: 2, pacientes: 99 });
    const name = await resolveSourceCollectionName(db, 'patients');
    expect(name).toBe('pacientes');
  });

  it('returns preferred when no collection exists (fallback)', async () => {
    const db = makeDb([]); // nothing in db
    const name = await resolveSourceCollectionName(db, 'patients');
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
