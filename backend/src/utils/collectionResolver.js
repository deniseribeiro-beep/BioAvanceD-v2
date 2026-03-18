const { CANONICAL_COLLECTIONS, COLLECTION_ALIASES } = require('../config/collections');
const { enforceAppendOnlyCollection, ensureSampleMovementIndexes } = require('./sampleMovementLedger');

async function resolveCollectionName(db, key) {
  const preferred = CANONICAL_COLLECTIONS[key];
  if (!preferred) {
    throw new Error(`Collection key inválida: ${key}`);
  }

  if (!db || typeof db.listCollections !== 'function') {
    return preferred;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const existingNames = new Set(collections.map((item) => item.name));

  if (existingNames.has(preferred)) {
    return preferred;
  }

  const aliases = COLLECTION_ALIASES[key] || [];
  for (const alias of aliases) {
    if (existingNames.has(alias)) {
      return alias;
    }
  }

  return preferred;
}

async function getCollection(db, key, requiredMethod) {
  const name = await resolveCollectionName(db, key);
  let collection = db.collection(name);

  if (key === 'sampleMovements') {
    enforceAppendOnlyCollection(collection, name);
    await ensureSampleMovementIndexes(collection);
  }

  if (!requiredMethod || typeof collection?.[requiredMethod] === 'function') {
    return collection;
  }

  const candidates = [
    ...(COLLECTION_ALIASES[key] || []),
    CANONICAL_COLLECTIONS[key]
  ].filter((candidate, index, arr) => candidate && arr.indexOf(candidate) === index);

  for (const candidate of candidates) {
    const aliasCollection = db.collection(candidate);
    if (key === 'sampleMovements') {
      enforceAppendOnlyCollection(aliasCollection, candidate);
      await ensureSampleMovementIndexes(aliasCollection);
    }
    if (typeof aliasCollection?.[requiredMethod] === 'function') {
      return aliasCollection;
    }
  }

  return collection;
}

async function resolveSourceCollectionName(db, key) {
  const preferred = CANONICAL_COLLECTIONS[key];
  if (!preferred) {
    throw new Error(`Collection key inválida: ${key}`);
  }

  if (!db || typeof db.listCollections !== 'function') {
    return preferred;
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const existingNames = new Set(collections.map((item) => item.name));
  const candidates = [preferred, ...(COLLECTION_ALIASES[key] || [])].filter((name) => existingNames.has(name));

  if (candidates.length === 0) {
    return preferred;
  }

  let best = candidates[0];
  let bestCount = -1;

  for (const candidate of candidates) {
    const count = await db.collection(candidate).estimatedDocumentCount();
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

module.exports = {
  resolveCollectionName,
  resolveSourceCollectionName,
  getCollection
};
