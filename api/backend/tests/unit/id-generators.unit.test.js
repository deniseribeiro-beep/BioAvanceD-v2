import { describe, it, expect, vi } from 'vitest';
const { generateUniqueEquipmentID } = require('../../src/utils/equipmentIDGenerator');
const { generateUniqueOriginID } = require('../../src/utils/originIDGenerator');
const { generateUniqueProtocolID } = require('../../src/utils/protocolIDGenerator');
const { generateUniqueQualityID } = require('../../src/utils/qualityIDGenerator');
const { generateUniqueSampleTypeID } = require('../../src/utils/sampleTypeIDGenerator');
const { generateUniqueSpecimenId } = require('../../src/utils/sampleIDGenerator');

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

// ── generateUniqueProtocolID ───────────────────────────────

describe('generateUniqueProtocolID', () => {
  it('returns 1 when collection is empty', async () => {
    const db = makeDbMock([null, null]);
    const id = await generateUniqueProtocolID(db);
    expect(id).toBe(1);
  });

  it('returns lastID + 1 for populated collection', async () => {
    const db = makeDbMock([{ protocolID: 8 }, null]);
    const id = await generateUniqueProtocolID(db);
    expect(id).toBe(9);
  });

  it('increments again when next ID is taken', async () => {
    const db = makeDbMock([{ protocolID: 8 }, { protocolID: 9 }, null]);
    const id = await generateUniqueProtocolID(db);
    expect(id).toBe(10);
  });

  it('throws when two consecutive IDs are taken', async () => {
    const db = makeDbMock([{ protocolID: 1 }, { protocolID: 2 }, { protocolID: 3 }]);
    await expect(generateUniqueProtocolID(db)).rejects.toThrow('único');
  });

  it('uses custom collection name', async () => {
    let usedName;
    const db = {
      collection: (name) => {
        usedName = name;
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    };
    await generateUniqueProtocolID(db, 'custom_protocols');
    expect(usedName).toBe('custom_protocols');
  });
});

// ── generateUniqueQualityID ────────────────────────────────

describe('generateUniqueQualityID', () => {
  it('returns 1 when collection is empty', async () => {
    const db = makeDbMock([null, null]);
    const id = await generateUniqueQualityID(db);
    expect(id).toBe(1);
  });

  it('returns lastID + 1 for populated collection', async () => {
    const db = makeDbMock([{ qualityID: 4 }, null]);
    const id = await generateUniqueQualityID(db);
    expect(id).toBe(5);
  });

  it('increments again when next ID is taken', async () => {
    const db = makeDbMock([{ qualityID: 4 }, { qualityID: 5 }, null]);
    const id = await generateUniqueQualityID(db);
    expect(id).toBe(6);
  });

  it('throws when two consecutive IDs are taken', async () => {
    const db = makeDbMock([{ qualityID: 1 }, { qualityID: 2 }, { qualityID: 3 }]);
    await expect(generateUniqueQualityID(db)).rejects.toThrow('único');
  });
});

// ── generateUniqueSampleTypeID ─────────────────────────────

describe('generateUniqueSampleTypeID', () => {
  it('returns 1 when collection is empty', async () => {
    const db = makeDbMock([null, null]);
    const id = await generateUniqueSampleTypeID(db);
    expect(id).toBe(1);
  });

  it('returns lastID + 1 for populated collection', async () => {
    const db = makeDbMock([{ sampleTypeID: 6 }, null]);
    const id = await generateUniqueSampleTypeID(db);
    expect(id).toBe(7);
  });

  it('increments again when next ID is taken', async () => {
    const db = makeDbMock([{ sampleTypeID: 6 }, { sampleTypeID: 7 }, null]);
    const id = await generateUniqueSampleTypeID(db);
    expect(id).toBe(8);
  });

  it('throws when two consecutive IDs are taken', async () => {
    const db = makeDbMock([{ sampleTypeID: 1 }, { sampleTypeID: 2 }, { sampleTypeID: 3 }]);
    await expect(generateUniqueSampleTypeID(db)).rejects.toThrow('único');
  });
});

// ── generateUniqueSpecimenId ─────────────────────────────────
// Different shape: crypto.randomInt with collision-retry loop, not sequential.

describe('generateUniqueSpecimenId', () => {
  it('returns a 7-digit ID when no collision occurs', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: () => ({ findOne }) };
    const id = await generateUniqueSpecimenId(db);
    expect(id).toBeGreaterThanOrEqual(1000000);
    expect(id).toBeLessThan(9999999);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('retries when the generated ID already exists, then succeeds', async () => {
    const findOne = vi
      .fn()
      .mockResolvedValueOnce({ specimenId: 1234567 })
      .mockResolvedValueOnce(null);
    const db = { collection: () => ({ findOne }) };
    const id = await generateUniqueSpecimenId(db);
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(typeof id).toBe('number');
  });

  it('throws after exhausting max attempts on persistent collisions', async () => {
    const findOne = vi.fn().mockResolvedValue({ specimenId: 1234567 });
    const db = { collection: () => ({ findOne }) };
    await expect(generateUniqueSpecimenId(db)).rejects.toThrow('múltiplas tentativas');
    expect(findOne).toHaveBeenCalledTimes(100);
  });

  it('uses custom collection name', async () => {
    let usedName;
    const db = {
      collection: (name) => {
        usedName = name;
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    };
    await generateUniqueSpecimenId(db, 'custom_samples');
    expect(usedName).toBe('custom_samples');
  });
});
