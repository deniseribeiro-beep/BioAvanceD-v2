const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { enforceAppendOnlyCollection, ensureSampleMovementIndexes } = require('./sampleMovementLedger');

async function resolveCollectionName(db, key) {
  const preferred = CANONICAL_COLLECTIONS[key];
  if (!preferred) {
    throw new Error(`Collection key inválida: ${key}`);
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

  return collection;
}

module.exports = {
  resolveCollectionName,
  getCollection
};
