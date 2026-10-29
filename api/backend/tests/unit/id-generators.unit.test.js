import { describe, it, expect, vi } from 'vitest';
const { generateUniqueEquipmentID } = require('../../src/utils/equipmentIDGenerator');
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

// #736: makeDbMock above ignores its query filter entirely -- it returns
// canned results in call order no matter what was asked for -- which is
// exactly why the existing tests could not see this bug. This fake honours
// the filter and reproduces MongoDB's BSON sort order, in which every string
// sorts above every number, so `sort: { equipmentID: -1 }` returns a
// string-typed row ahead of any numeric one.
// #756: generalized over the id field name, to also cover four sibling
// generators keyed on originID/protocolID/qualityID/sampleTypeID; #776
// later deleted those siblings, leaving equipmentID as the only caller.
// The field stays a parameter rather than reverting to a hardcoded one,
// and makeEquipmentDbMock stays below as a thin wrapper so #736's own
// tests read unchanged.
//
// Deliberately NOT makeDbMock (above): that one ignores its query filter
// entirely and returns canned results in call order, which is precisely
// why the pre-existing tests could not see this class of bug.
function makeIdDbMock(field, docs) {
  const typeRank = (value) => (typeof value === 'number' ? 1 : 2);

  const matches = (doc, filter) => Object.entries(filter).every(([f, condition]) => {
    if (condition && typeof condition === 'object' && '$type' in condition) {
      return condition.$type === 'number' && typeof doc[f] === 'number';
    }
    return doc[f] === condition;
  });

  const queries = [];
  const collection = {
    queries,
    findOne: vi.fn(async (filter = {}, options = {}) => {
      queries.push(filter);
      let found = docs.filter((doc) => matches(doc, filter));

      // MongoDB's BSON sort order: every string sorts above every number.
      const direction = options.sort && options.sort[field];
      if (direction) {
        found = [...found].sort((a, b) => {
          const byType = typeRank(a[field]) - typeRank(b[field]);
          if (byType !== 0) return direction === -1 ? -byType : byType;
          if (a[field] === b[field]) return 0;
          const byValue = a[field] < b[field] ? -1 : 1;
          return direction === -1 ? -byValue : byValue;
        });
      }

      return found[0] ?? null;
    })
  };

  return { db: { collection: () => collection }, collection };
}

function makeEquipmentDbMock(docs) {
  return makeIdDbMock('equipmentID', docs);
}

describe('generateUniqueEquipmentID with string-typed debris (#736)', () => {
  // The original source was seedStorageBoxLocation() in
  // tests/e2e/helpers/seedParticipant.ts, which inserted equipment fixtures
  // with `equipmentID: containerID`, a string. Reproduced live against a
  // compose.test.yml stack: POST /api/equipment with no explicit equipmentID
  // came back with 'RF004-e2e-EQ-17876028463111' -- the string concatenated
  // with 1, not a number incremented by 1.
  //
  // #757 has since fixed that fixture to write a numeric id, so it is no
  // longer a live producer of this debris. These tests stay regardless: the
  // numeric filter guards the generator against a string equipmentID from
  // *any* source, and nothing stops a raw insertOne from bypassing
  // Equipment.js's own "equipmentID deve ser um número" check the way that
  // fixture did.
  const stringDebris = 'RF004-e2e-EQ-1787602846311';

  it('returns a numeric next id, not a concatenated string, when string debris is present', async () => {
    const { db } = makeEquipmentDbMock([{ equipmentID: 3 }, { equipmentID: stringDebris }]);

    const id = await generateUniqueEquipmentID(db);

    expect(id).toBe(4);
    expect(typeof id).toBe('number');
  });

  it('restricts the last-id lookup to numeric equipmentID values', async () => {
    const { db, collection } = makeEquipmentDbMock([{ equipmentID: 3 }, { equipmentID: stringDebris }]);

    await generateUniqueEquipmentID(db);

    expect(collection.queries[0]).toEqual({ equipmentID: { $type: 'number' } });
  });

  it('starts at 1 when the collection holds nothing but string debris', async () => {
    const { db } = makeEquipmentDbMock([{ equipmentID: stringDebris }]);

    const id = await generateUniqueEquipmentID(db);

    expect(id).toBe(1);
  });

  it('still increments past a taken id when debris is present', async () => {
    const { db } = makeEquipmentDbMock([
      { equipmentID: 3 },
      { equipmentID: 4 },
      { equipmentID: stringDebris }
    ]);

    const id = await generateUniqueEquipmentID(db);

    expect(id).toBe(5);
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

  it('checks for a collision against the stored string form of the id (#1220)', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: () => ({ findOne }) };
    const id = await generateUniqueSpecimenId(db);
    expect(findOne).toHaveBeenCalledWith({ specimenId: String(id) });
    expect(findOne.mock.calls[0][0].specimenId).toMatch(/^\d{7}$/);
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

// #756/#776: this file used to also cover four sibling generators
// (originIDGenerator, protocolIDGenerator, qualityIDGenerator,
// sampleTypeIDGenerator) that carried #736's bug latently -- same
// findOne/sort/`+ 1` shape, no numeric filter. #736 fixed only
// equipmentIDGenerator, because that was the one with a proven live
// writer (the e2e fixture, since fixed in #757); the other four were
// never imported anywhere under src/, so #776 deleted them along with
// their coverage here. equipmentIDGenerator remains this file's only
// subject, still exercised above for the same string-debris class of bug.
