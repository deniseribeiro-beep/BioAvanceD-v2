const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { enforceAppendOnlyCollection, ensureSampleMovementIndexes } = require('./sampleMovementLedger');

function resolveCollectionName(db, key) {
  const preferred = CANONICAL_COLLECTIONS[key];
  if (!preferred) {
    throw new Error(`Collection key inválida: ${key}`);
  }

  return preferred;
}

// Deliberately not `async`: an invalid key must throw synchronously so a
// caller that chains `getCollection(db, key).find(...)` without `await`
// (#306) fails loud at the chained call, instead of leaving an unawaited
// rejected promise dangling that crashes the process later via
// unhandledRejection. Only the sampleMovements path does real async work,
// so it's the only branch that returns a promise; every other key resolves
// synchronously (which `await` on the caller side still handles fine).
function getCollection(db, key, requiredMethod) {
  const name = resolveCollectionName(db, key);
  const collection = db.collection(name);

  if (key === 'sampleMovements') {
    enforceAppendOnlyCollection(collection, name);
    return ensureSampleMovementIndexes(collection).then(() => collection);
  }

  return collection;
}

module.exports = {
  resolveCollectionName,
  getCollection
};
