import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../../src/services/storageRack.service');

// #1513 (RF016 AC2): a query-matching fake whose unique indexes refuse a
// duplicate key the way Mongo does, row by row for insertMany too.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((branch) => matches(doc, branch));
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.includes(doc[key]);
    return doc[key] === value;
  });
}

function createFakeCollection() {
  const docs = [];
  const indexes = [];
  function assertUnique(doc) {
    for (const { keys, options } of indexes) {
      if (!options.unique) continue;
      const [field] = Object.keys(keys);
      const inScope = (row) => !options.partialFilterExpression || matches(row, options.partialFilterExpression);
      if (inScope(doc) && docs.some((row) => inScope(row) && row[field] === doc[field])) {
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      }
    }
  }
  return {
    docs,
    indexes,
    async createIndex(keys, options = {}) { indexes.push({ keys, options }); },
    async insertOne(doc) {
      assertUnique(doc);
      docs.push({ ...doc, _id: `oid-${docs.length}` });
      return { insertedId: docs.length };
    },
    async insertMany(rows) {
      for (const doc of rows) {
        assertUnique(doc);
        docs.push({ ...doc, _id: `oid-${docs.length}` });
      }
      return { insertedCount: rows.length };
    },
    async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
    find(filter = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }; },
  };
}

function createFakeDb() {
  const collections = {};
  return {
    collections,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection();
      return collections[name];
    },
  };
}

async function expectRefusal(promise, code, statusCode) {
  await expect(promise).rejects.toMatchObject({ name: 'StorageRackError', code, statusCode });
}

describe('storageRack.service (#1513, RF016 AC2)', () => {
  it('writes the approved fixture as one rack and 96 unique positions, read back in top_left_origin order', async () => {
    const db = createFakeDb();
    const rack = await service.createRack(db, { storageRackId: 'rack-96-001' });
    expect(rack).toMatchObject({ storageRackId: 'rack-96-001', rackType: 'cryogenic_rack', rowCount: 8, columnCount: 12, positionCount: 96 });
    expect(rack).not.toHaveProperty('_id');
    expect(db.collections.storageRacks.docs).toHaveLength(1);
    expect(db.collections.storagePositions.docs).toHaveLength(96);
    expect(new Set(db.collections.storagePositions.docs.map((p) => p.storagePositionId)).size).toBe(96);

    const positions = await service.listRackPositions(db, 'rack-96-001');
    expect(positions).toHaveLength(96);
    expect(positions[0]).toEqual({ storagePositionId: 'rack-96-001:A01', storageRackId: 'rack-96-001', rowIndex: 1, columnIndex: 1, positionCode: 'A01', status: 'available' });
    expect(positions[11].storagePositionId).toBe('rack-96-001:A12');
    expect(positions[12].storagePositionId).toBe('rack-96-001:B01');
    expect(positions[95].storagePositionId).toBe('rack-96-001:H12');
  });

  it('refuses a second rack with the same id and leaves its 96 positions as they were', async () => {
    const db = createFakeDb();
    await service.createRack(db, { storageRackId: 'rack-96-001' });
    await expectRefusal(service.createRack(db, { storageRackId: 'rack-96-001' }), 'RACK_EXISTS', 409);
    expect(db.collections.storageRacks.docs).toHaveLength(1);
    expect(db.collections.storagePositions.docs).toHaveLength(96);
  });

  it('refuses an invalid grid as a 422 and writes nothing', async () => {
    const db = createFakeDb();
    await expectRefusal(service.createRack(db, { storageRackId: 'rack-bad', rowCount: 0 }), 'VALIDATION_ERROR', 422);
    expect(db.collections.storageRacks.docs).toHaveLength(0);
    expect(db.collections.storagePositions.docs).toHaveLength(0);
  });

  it('refuses a storageRackId that is not a non-empty string as a 422 and writes nothing', async () => {
    const db = createFakeDb();
    for (const storageRackId of [42, { $ne: null }, '']) {
      await expectRefusal(service.createRack(db, { storageRackId }), 'VALIDATION_ERROR', 422);
    }
    expect(db.collections.storageRacks?.docs ?? []).toHaveLength(0);
    expect(db.collections.storagePositions?.docs ?? []).toHaveLength(0);
  });

  it('keeps the fixture for a grid field given as undefined or null', async () => {
    const db = createFakeDb();
    const rack = await service.createRack(db, { storageRackId: 'r', rowCount: undefined, columnCount: null });
    expect(rack).toMatchObject({ rowCount: 8, columnCount: 12, positionCount: 96 });
    expect(db.collections.storagePositions.docs).toHaveLength(96);
  });

  it('derives a 2x3 grid row by row', async () => {
    const db = createFakeDb();
    const rack = await service.createRack(db, { storageRackId: 'rack-2x3', rowCount: 2, columnCount: 3 });
    expect(rack.positionCount).toBe(6);
    const positions = await service.listRackPositions(db, 'rack-2x3');
    expect(positions.map((p) => p.positionCode)).toEqual(['A01', 'A02', 'A03', 'B01', 'B02', 'B03']);
  });

  it('answers an unknown rack with 404 RACK_NOT_FOUND', async () => {
    await expectRefusal(service.findRack(createFakeDb(), 'nope'), 'RACK_NOT_FOUND', 404);
  });

  it('builds the rack and position indexes once per db', async () => {
    const db = createFakeDb();
    await service.ensureRackIndexes(db);
    await service.ensureRackIndexes(db);
    expect(db.collections.storageRacks.indexes).toEqual([{ keys: { storageRackId: 1 }, options: { unique: true, name: 'uniq_storageRackId' } }]);
    expect(db.collections.storagePositions.indexes).toEqual([
      { keys: { storagePositionId: 1 }, options: { unique: true, name: 'uniq_storagePositionId' } },
      { keys: { storageRackId: 1 }, options: {} },
    ]);
  });
});
