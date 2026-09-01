const { CANONICAL_COLLECTIONS } = require('../config/collections');
const { enforceAppendOnlyCollection, ensureSampleMovementIndexes } = require('./sampleMovementLedger');
const { ensureSampleIndexes } = require('./sampleIndexes');

// #936: collection names whose indexes have already been ensured this
// process. Keyed by resolved name, so a COLL_SAMPLES override gets its own
// entry rather than being shadowed by the default.
const samplesIndexed = new Set();

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

  // #936: the barcode unique index, once per process per resolved name.
  //
  // Deliberately NOT returned as a promise the way sampleMovements is. The
  // comment above is the reason: `samples` is this module's most-called key
  // and several call sites chain off the result, so turning it into a
  // thenable would convert a documented loud-failure design into a silent
  // one across a much larger surface. `ensureSampleIndexes` never rejects
  // (it logs instead), so nothing is lost by not awaiting it here, and
  // index creation is idempotent — the first insert may race the build, but
  // the application-level uniqueness check is still the primary guard and
  // the index is the backstop, not the mechanism.
  if (key === 'samples' && !samplesIndexed.has(name)) {
    samplesIndexed.add(name);
    ensureSampleIndexes(collection);
  }

  return collection;
}

module.exports = {
  resolveCollectionName,
  getCollection
};
