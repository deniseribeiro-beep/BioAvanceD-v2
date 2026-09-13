/**
 * @param {import('mongodb').Db} db
 * @param {(session: import('mongodb').ClientSession) => Promise<any>} handler
 * @returns {Promise<any>}
 */
async function withMongoTransaction(db, handler) {
  const client = db?.client || db?.s?.client;
  if (!client || typeof client.startSession !== 'function') {
    throw new Error('Cliente Mongo não suporta transação');
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

/**
 * Per-client cache of the transaction-capability probe below, so repeated
 * calls (e.g. one per request) don't re-run `hello` every time.
 */
const transactionCapabilityCache = new WeakMap();

/**
 * `typeof client.startSession === 'function'` is not sufficient to know a
 * transaction will succeed: a real `MongoClient` always exposes
 * `startSession`, including against a standalone mongod, where
 * `session.withTransaction` then throws. This runs `hello` against the
 * `admin` database and treats a replica set (`setName` present) or a mongos
 * (`msg === 'isdbgrid'`) as capable; anything else, including a thrown
 * error, is not.
 *
 * @param {import('mongodb').Db} db
 * @returns {Promise<boolean>}
 */
async function isTransactionCapable(db) {
  return (await probeTopology(db)) === 'transactional';
}

/**
 * #923: the mirror question, and it is NOT `!isTransactionCapable(db)`.
 *
 * The two callers want opposite defaults when the topology cannot be
 * determined:
 *
 *   - "may I USE a transaction?" (#918) — unknown must mean NO, so the
 *     caller takes its sequential fallback rather than throwing.
 *   - "should I REFUSE with a topology error?" (#923) — unknown must mean
 *     NO, so the caller proceeds and lets Mongo answer for itself.
 *
 * Collapsing them into one boolean makes every test fake that mocks a
 * client without mocking `hello` look like a standalone deployment, which
 * is exactly what it is not. So this returns true only on a POSITIVE
 * determination: `hello` answered, and named neither a replica set nor a
 * mongos.
 *
 * @param {import('mongodb').Db} db
 * @returns {Promise<boolean>}
 */
async function isKnownStandaloneDeployment(db) {
  return (await probeTopology(db)) === 'standalone';
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

module.exports = { withMongoTransaction, isTransactionCapable, isKnownStandaloneDeployment };
