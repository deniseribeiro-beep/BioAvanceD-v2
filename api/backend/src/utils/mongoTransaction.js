/**
 * @param {import('mongodb').Db} db
 * @param {(session: import('mongodb').ClientSession) => Promise<any>} handler
 * @returns {Promise<any>}
 */
async function withMongoTransaction(db, handler) {
  await assertTransactionCapable(db);

  const client = db?.client || db?.s?.client;
  if (!client || typeof client.startSession !== 'function') {
    throw transactionCapabilityError('unknown');
  }

  const session = client.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await handler(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

const transactionCapabilityCache = new WeakMap();

function transactionCapabilityError(topology) {
  const error = new Error(
    `Transação Mongo indisponível: topologia ${topology}. ` +
    'Operações de custódia exigem replica set ou mongos; nenhuma escrita parcial será executada.'
  );
  error.code = 'MONGO_TRANSACTIONS_REQUIRED';
  error.topology = topology;
  return error;
}

/**
 * Returns true only after Mongo positively reports a replica set or mongos.
 * Unknown is deliberately false: absence of proof of transaction capability
 * is not sufficient for custody/audit/outbox writes.
 */
async function isTransactionCapable(db) {
  return (await probeTopology(db)) === 'transactional';
}

/**
 * Fail-closed preflight for custody-grade operations (#923).
 * Standalone and unknown are both refused before startSession()/first write.
 */
async function assertTransactionCapable(db) {
  const topology = await probeTopology(db);
  if (topology !== 'transactional') {
    throw transactionCapabilityError(topology);
  }
  return true;
}

/**
 * Historical compatibility export used only by the storage custody layer.
 * After #923 its operational question is "must this custody operation refuse
 * this deployment?" rather than merely "did hello positively identify a
 * standalone?". Thus unknown is intentionally fail-closed as well.
 *
 * Keeping the export avoids duplicating topology probes in StorageService and
 * MongoStorageRepository while preserving their pre-write refusal boundary.
 */
async function isKnownStandaloneDeployment(db) {
  return (await probeTopology(db)) !== 'transactional';
}

/**
 * @param {import('mongodb').Db} db
 * @returns {Promise<'transactional'|'standalone'|'unknown'>}
 */
async function probeTopology(db) {
  const client = db?.client || db?.s?.client;
  if (!client || typeof client.db !== 'function') {
    return 'unknown';
  }

  if (transactionCapabilityCache.has(client)) {
    return transactionCapabilityCache.get(client);
  }

  const topology = await (async () => {
    try {
      const hello = await client.db('admin').command({ hello: 1 });
      if (!hello) return 'unknown';
      if (hello.setName || hello.msg === 'isdbgrid') return 'transactional';
      return 'standalone';
    } catch {
      return 'unknown';
    }
  })();

  transactionCapabilityCache.set(client, topology);
  return topology;
}

module.exports = {
  withMongoTransaction,
  isTransactionCapable,
  assertTransactionCapable,
  isKnownStandaloneDeployment,
  probeTopology,
  transactionCapabilityError,
};
