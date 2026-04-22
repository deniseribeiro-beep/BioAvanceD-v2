const crypto = require('crypto');

const PROTECTED_COLLECTIONS = new Set();
const INDEXED_COLLECTIONS = new Set();

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
    movementID: movement.movementID || null,
    sampleID: String(movement.sampleID || ''),
    barcode: movement.barcode || null,
    type: movement.type || null,
    quantity: movement.quantity ?? null,
    unit: movement.unit || null,
    timestamp: movement.timestamp ? new Date(movement.timestamp).toISOString() : null,
    previousQuantity: movement.previousQuantity ?? null,
    newQuantity: movement.newQuantity ?? null,
    previousHash: previousHash || null
  };
}

function computeMovementChainHash(movement, previousHash) {
  const payload = buildChainPayload(movement, previousHash);
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function appendMovementWithHashChain(collection, movement, options = {}) {
  const sampleID = String(movement?.sampleID || '').trim();
  if (!sampleID) {
    const error = new Error('sampleID é obrigatório para registrar evento de ledger');
    error.statusCode = 422;
    throw error;
  }

  const queryOptions = {};
  if (options.session) {
    queryOptions.session = options.session;
  }

  const previousMovement = await collection
    .find({ sampleID }, queryOptions)
    .sort({ timestamp: -1, _id: -1 })
    .limit(1)
    .next();

  const previousHash = previousMovement?.chainHash || null;
  const chainHash = computeMovementChainHash(movement, previousHash);

  const ledgerMovement = {
    ...movement,
    chainPrevHash: previousHash,
    chainHash,
    chainAlgorithm: 'sha256',
    chainVersion: 1,
    immutable: true,
    createdAt: movement.createdAt || new Date()
  };

  const insertOptions = options.session ? { session: options.session } : undefined;
  await collection.insertOne(ledgerMovement, insertOptions);

  return {
    movementID: ledgerMovement.movementID || null,
    chainHash: ledgerMovement.chainHash,
    chainPrevHash: ledgerMovement.chainPrevHash
  };
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

  const key = collection.collectionName || 'sample_movements';
  if (INDEXED_COLLECTIONS.has(key)) {
    return;
  }

  const indexDefinitions = [
    [{ movementID: 1 }, { name: 'sample_movements_movement_id_unique_v1', unique: true, partialFilterExpression: { movementID: { $exists: true, $type: 'number' } } }],
    [{ sampleID: 1, timestamp: -1 }, { name: 'sample_movements_sample_ts_idx_v1' }],
    [{ barcode: 1, timestamp: -1 }, { name: 'sample_movements_barcode_ts_idx_v1' }],
    [{ chainHash: 1 }, { name: 'sample_movements_chain_hash_unique_v1', unique: true, partialFilterExpression: { chainHash: { $exists: true, $type: 'string' } } }]
  ];

  for (const [keys, options] of indexDefinitions) {
    try {
      await collection.createIndex(keys, options);
    } catch (_) {}
  }

  INDEXED_COLLECTIONS.add(key);
}

module.exports = {
  appendMovementWithHashChain,
  enforceAppendOnlyCollection,
  ensureSampleMovementIndexes,
  computeMovementChainHash
};
