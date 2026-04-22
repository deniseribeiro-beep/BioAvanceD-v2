function createCollectionMock(overrides = {}) {
  const v = globalThis.vi;
  if (!v) {
    throw new Error('Vitest global "vi" is not available in db factory context');
  }

  const createCursor = (docs = []) => {
    let current = Array.isArray(docs) ? [...docs] : [];
    return {
      sort: v.fn().mockImplementation((criteria = {}) => {
        const [[field, direction = 1]] = Object.entries(criteria);
        if (field) {
          current.sort((a, b) => {
            const left = a?.[field] ?? 0;
            const right = b?.[field] ?? 0;
            if (left === right) return 0;
            return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
          });
        }
        return createCursor(current);
      }),
      skip: v.fn().mockImplementation((n = 0) => createCursor(current.slice(Math.max(0, n)))),
      limit: v.fn().mockImplementation((n) => {
        if (typeof n !== 'number' || n < 0) return createCursor(current);
        return createCursor(current.slice(0, n));
      }),
      toArray: v.fn().mockResolvedValue(current),
    };
  };

  return {
    deleteOne: v.fn().mockResolvedValue({ deletedCount: 0 }),
    insertOne: v.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    updateOne: v.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    findOne: v.fn().mockResolvedValue(null),
    find: v.fn().mockImplementation(() => createCursor([])),
    ...overrides,
  };
}

function createDbMock(collections = {}) {
  return {
    collection: (name) => collections[name] || createCollectionMock(),
  };
}

module.exports = {
  createCollectionMock,
  createDbMock,
};
