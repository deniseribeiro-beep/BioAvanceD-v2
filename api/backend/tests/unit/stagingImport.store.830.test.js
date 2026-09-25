import { describe, it, expect, vi, afterEach } from 'vitest';

const store = require('../../src/services/stagingImport.store');
const mongo = require('../../src/database/mongo');
const stagingImportIndexes = require('../../src/utils/stagingImportIndexes');

// #830: StagingImport moved from a Mongoose model onto the native driver, so
// the import path has one connection concept. These pin what the schema used
// to do (defaults, timestamps, required fields, the status enum) and the
// #941 index wiring, which moved from createStagingImport into the store.

function fakeDb() {
  const coll = {
    collectionName: 'stagingImports',
    insertOne: vi.fn(async () => ({ insertedId: 'oid-1' })),
    findOne: vi.fn(async () => null),
    updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
  };
  const db = { collection: vi.fn(() => coll) };
  return { db, coll };
}

describe('stagingImport.store (#830)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildDocument', () => {
    it('applies the defaults and timestamps the schema used to', () => {
      const doc = store.buildDocument({ jobId: '  j1  ', fileName: ' f.csv ', rawData: {} });
      expect(doc).toMatchObject({
        jobId: 'j1',
        fileName: 'f.csv',
        status: 'staged',
        totalRows: 0,
        processedRows: 0,
        importErrors: [],
      });
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.updatedAt).toBe(doc.createdAt);
    });

    it.each([
      [{ fileName: 'f', rawData: {} }, /jobId/],
      [{ jobId: 'j', rawData: {} }, /fileName/],
      [{ jobId: 'j', fileName: 'f' }, /rawData/],
      [{ jobId: 'j', fileName: 'f', rawData: {}, status: 'retrying' }, /status/],
      [{ jobId: 'j', fileName: 'f', rawData: {}, totalRows: -1 }, /totalRows/],
      [{ jobId: 'j', fileName: 'f', rawData: {}, errors: [] }, /não declarado/],
    ])('refuses %o', (input, message) => {
      expect(() => store.buildDocument(input)).toThrow(message);
    });
  });

  describe('create', () => {
    it('inserts the built document on stagingImports and returns it with its _id', async () => {
      const { db, coll } = fakeDb();
      const created = await store.create({ jobId: 'j1', fileName: 'f.csv', rawData: { p: 1 } }, db);

      expect(db.collection).toHaveBeenCalledWith('stagingImports');
      expect(coll.insertOne).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'j1', status: 'staged' }));
      expect(created).toMatchObject({ _id: 'oid-1', jobId: 'j1' });
    });

    // #941: jobId is the key every reader looks up by. The ensure call used to
    // sit in createStagingImport; it now runs wherever the collection is
    // resolved, so no reader can reach it without the index being requested.
    it('ensures the jobId index on the collection it writes to (#941)', async () => {
      const ensureSpy = vi.spyOn(stagingImportIndexes, 'ensureStagingImportIndexes').mockResolvedValue(undefined);
      const { db, coll } = fakeDb();

      await store.create({ jobId: 'j1', fileName: 'f.csv', rawData: {} }, db);

      expect(ensureSpy).toHaveBeenCalledWith(coll);
    });
  });

  describe('updateOne', () => {
    it('stamps updatedAt like the schema timestamps did, keeping other operators', async () => {
      const { db, coll } = fakeDb();
      await store.updateOne({ jobId: 'j1' }, { $push: { importErrors: { m: 1 } } }, db);

      const [filter, update] = coll.updateOne.mock.calls[0];
      expect(filter).toEqual({ jobId: 'j1' });
      expect(update.$push).toEqual({ importErrors: { m: 1 } });
      expect(update.$set.updatedAt).toBeInstanceOf(Date);
    });

    it('refuses a status outside the enum before touching the database', async () => {
      const { db, coll } = fakeDb();
      await expect(store.updateOne({ jobId: 'j1' }, { $set: { status: 'retrying' } }, db)).rejects.toThrow(/status/);
      expect(coll.updateOne).not.toHaveBeenCalled();
    });
  });

  it('uses the shared native connection when no db is passed', async () => {
    const { db, coll } = fakeDb();
    const connectSpy = vi.spyOn(mongo, 'connectDB').mockResolvedValue(db);

    await store.findOne({ jobId: 'j1' });

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(coll.findOne).toHaveBeenCalledWith({ jobId: 'j1' });
  });
});
