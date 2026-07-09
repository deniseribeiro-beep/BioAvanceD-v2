const crypto = require('crypto');

const PROTECTED_COLLECTIONS = new Set();

const MUTATING_METHODS = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace'
];

function buildChainPayload(movement, previousHash) {
  return {
    movementId: movement.movementId || movement.movementID || null,
    specimenId: String(movement.specimenId || ''),
    barcode: movement.barcode || null,
    type: movement.type || null,
    quantity: movement.quantity ?? null,
    unit: movement.unit || null,
    createdAt: movement.createdAt ? new Date(movement.createdAt).toISOString() : null,
    previousQuantity: movement.previousQuantity ?? null,
    newQuantity: movement.newQuantity ?? null,
    previousHash: previousHash || null
  };
}

function computeMovementChainHash(movement, previousHash) {
  return crypto.createHash('sha256').update(JSON.stringify(buildChainPayload(movement, previousHash))).digest('hex');
}

async function appendMovementWithHashChain(collection, movement, options = {}) {
  const specimenId = String(movement?.specimenId || '').trim();
  if (!specimenId) {
    const error = new Error('specimenId é obrigatório para registrar evento de ledger');
    error.statusCode = 422;
    throw error;
  }

  const queryOptions = options.session ? { session: options.session } : {};
  const previousMovement = await collection.find({ specimenId }, queryOptions).sort({ createdAt: -1, _id: -1 }).limit(1).next();
  const previousHash = previousMovement?.hash || previousMovement?.chainHash || null;
  const hash = computeMovementChainHash(movement, previousHash);
  const ledgerMovement = {
    ...movement,
    hash,
    previousHash,
    createdAt: movement.createdAt || new Date(),
    updatedAt: movement.updatedAt || new Date()
  };

  await collection.insertOne(ledgerMovement, options.session ? { session: options.session } : undefined);
  return { movementId: ledgerMovement.movementId || null, hash, previousHash };
}

function guardBulkWrite(operationList = []) {
  const hasMutation = operationList.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;

    return Boolean(
      entry.updateOne ||
      entry.updateMany ||
      entry.replaceOne ||
      entry.deleteOne ||
      entry.deleteMany
    );
  });

  if (hasMutation) {
    const error = new Error('POLICY_APPEND_ONLY: sample_movements é append-only e não permite update/delete/replace em bulkWrite');
    error.statusCode = 409;
    throw error;
  }
}

function enforceAppendOnlyCollection(collection, collectionName = 'sample_movements') {
  if (!collection || typeof collection !== 'object') {
    return collection;
  }

  const uniqueKey = `${collectionName}:${collection.collectionName || 'unknown'}`;
  if (PROTECTED_COLLECTIONS.has(uniqueKey)) {
    return collection;
  }

  MUTATING_METHODS.forEach((methodName) => {
    if (typeof collection[methodName] !== 'function') {
      return;
    }

    collection[methodName] = async () => {
      const error = new Error(`POLICY_APPEND_ONLY: coleção ${collectionName} é append-only e não permite ${methodName}`);
      error.statusCode = 409;
      throw error;
    };
  });

  if (typeof collection.bulkWrite === 'function') {
    const originalBulkWrite = collection.bulkWrite.bind(collection);
    collection.bulkWrite = async (operations = [], options = {}) => {
      guardBulkWrite(operations);
      return originalBulkWrite(operations, options);
    };
  }

  PROTECTED_COLLECTIONS.add(uniqueKey);
  return collection;
}

async function ensureSampleMovementIndexes(collection) {
  if (!collection) return;
  await collection.createIndex({ movementId: 1 }, { name: 'sample_movements_movement_id_unique_v1', unique: true, partialFilterExpression: { movementId: { $exists: true } } }).catch(() => {});
  await collection.createIndex({ specimenId: 1, createdAt: -1 }, { name: 'sample_movements_specimen_ts_idx_v1' }).catch(() => {});
  await collection.createIndex({ barcode: 1, createdAt: -1 }, { name: 'sample_movements_barcode_ts_idx_v1' }).catch(() => {});
  await collection.createIndex({ hash: 1 }, { name: 'sample_movements_hash_unique_v1', unique: true, partialFilterExpression: { hash: { $exists: true } } }).catch(() => {});
}

module.exports = {
  appendMovementWithHashChain,
  enforceAppendOnlyCollection,
  ensureSampleMovementIndexes,
  computeMovementChainHash
};
