import { describe, it, expect, vi } from 'vitest';
const { generateUniqueEquipmentID } = require('../../src/utils/equipmentIDGenerator');
const { generateUniqueLocationID } = require('../../src/utils/locationIDGenerator');
const { generateUniqueOriginID } = require('../../src/utils/originIDGenerator');

function makeDbMock(findOneResults) {
  let callCount = 0;
  return {
    collection: () => ({
      findOne: vi.fn().mockImplementation(() => {
        const result = findOneResults[callCount] ?? null;
        callCount++;
        return Promise.resolve(result);
      }),
    }),
  };
}

// ── generateUniqueEquipmentID ──────────────────────────────

describe('generateUniqueEquipmentID', () => {
  it('returns 1 when collection is empty', async () => {
    const db = makeDbMock([null, null]);
    const id = await generateUniqueEquipmentID(db);
    expect(id).toBe(1);
  });

  it('returns lastID + 1 when last equipment has equipmentID', async () => {
    // first findOne: lastItem; second findOne: existing (null = not taken)
    const db = makeDbMock([{ equipmentID: 5 }, null]);
    const id = await generateUniqueEquipmentID(db);
    expect(id).toBe(6);
  });

  it('increments again when next ID is also taken', async () => {
    // last=3, id=4 is taken, id=5 is free
    const db = makeDbMock([{ equipmentID: 3 }, { equipmentID: 4 }, null]);
    const id = await generateUniqueEquipmentID(db);
    expect(id).toBe(5);
  });

  it('throws when two consecutive IDs are taken', async () => {
    const db = makeDbMock([{ equipmentID: 3 }, { equipmentID: 4 }, { equipmentID: 5 }]);
    await expect(generateUniqueEquipmentID(db)).rejects.toThrow('único');
  });

  it('uses custom collection name', async () => {
    let usedName;
    const db = {
      collection: (name) => {
        usedName = name;
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    };
    await generateUniqueEquipmentID(db, 'custom_equipment');
    expect(usedName).toBe('custom_equipment');
  });
});

// ── generateUniqueLocationID ───────────────────────────────

describe('generateUniqueLocationID', () => {
  it('returns 1 when collection is empty', async () => {
    const db = makeDbMock([null, null]);
    const id = await generateUniqueLocationID(db);
    expect(id).toBe(1);
  });

  it('returns lastID + 1 for populated collection', async () => {
    const db = makeDbMock([{ locationID: 10 }, null]);
    const id = await generateUniqueLocationID(db);
    expect(id).toBe(11);
  });

  it('increments again when next ID is taken', async () => {
    const db = makeDbMock([{ locationID: 7 }, { locationID: 8 }, null]);
    const id = await generateUniqueLocationID(db);
    expect(id).toBe(9);
  });

  it('throws when two consecutive IDs are taken', async () => {
    const db = makeDbMock([{ locationID: 1 }, { locationID: 2 }, { locationID: 3 }]);
    await expect(generateUniqueLocationID(db)).rejects.toThrow('único');
  });
});

// ── generateUniqueOriginID ─────────────────────────────────

describe('generateUniqueOriginID', () => {
  it('returns 1 when collection is empty', async () => {
    const db = makeDbMock([null, null]);
    const id = await generateUniqueOriginID(db);
    expect(id).toBe(1);
  });

  it('returns lastID + 1 for populated collection', async () => {
    const db = makeDbMock([{ originID: 3 }, null]);
    const id = await generateUniqueOriginID(db);
    expect(id).toBe(4);
  });

  it('increments again when next ID is taken', async () => {
    const db = makeDbMock([{ originID: 2 }, { originID: 3 }, null]);
    const id = await generateUniqueOriginID(db);
    expect(id).toBe(4);
  });

  it('throws when two consecutive IDs are taken', async () => {
    const db = makeDbMock([{ originID: 1 }, { originID: 2 }, { originID: 3 }]);
    await expect(generateUniqueOriginID(db)).rejects.toThrow('único');
  });
});
