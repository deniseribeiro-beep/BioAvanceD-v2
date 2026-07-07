const { randomUUID } = require('crypto');

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
      project: v.fn().mockImplementation((proj = {}) => {
        if (!proj || Object.keys(proj).length === 0) return createCursor(current);
        const projected = current.map((doc) => {
          const out = {};
          for (const k of Object.keys(proj)) {
            if (proj[k]) out[k] = doc?.[k];
          }
          return out;
        });
        return createCursor(projected);
      }),
      toArray: v.fn().mockResolvedValue(current),
    };
  };

  return {
    deleteOne: v.fn().mockResolvedValue({ deletedCount: 0 }),
    insertOne: v.fn().mockResolvedValue({ insertedId: randomUUID() }),
    updateOne: v.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    findOne: v.fn().mockResolvedValue(null),
    find: v.fn().mockImplementation(() => createCursor([])),
    countDocuments: v.fn().mockResolvedValue(0),
    createIndex: v.fn().mockResolvedValue(null),
    collectionName: 'mock_collection',
    ...overrides,
  };
}

function createDbMock(collections = {}) {
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedMap = {};
  Object.keys(collections).forEach((k) => {
    normalizedMap[normalize(k)] = collections[k];
  });

  const aliasFallback = {
    pacientes: 'patients',
    amostras: 'samples',
    consent_templates: 'consentTemplates',
    consenttemplates: 'consentTemplates',
    biomarkerobservations: 'biomarker_observations',
    observations: 'observations',
  };

  return {
    collection: (name) => {
      const n = normalize(name);
      if (normalizedMap[n]) return normalizedMap[n];
      const alias = aliasFallback[n];
      if (alias && normalizedMap[normalize(alias)]) return normalizedMap[normalize(alias)];
      // try to find by substring match
      const foundKey = Object.keys(normalizedMap).find((k) => k === n || k.includes(n) || n.includes(k));
      if (foundKey) return normalizedMap[foundKey];
      return createCollectionMock();
    },
  };
}

module.exports = {
  createCollectionMock,
  createDbMock,
};
