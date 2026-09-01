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
  const client = db?.client || db?.s?.client;
  if (!client || typeof client.db !== 'function') {
    return false;
  }

  if (transactionCapabilityCache.has(client)) {
    return transactionCapabilityCache.get(client);
  }

  const capable = await (async () => {
    try {
      const hello = await client.db('admin').command({ hello: 1 });
      return Boolean(hello?.setName) || hello?.msg === 'isdbgrid';
    } catch {
      return false;
    }
  })();

  transactionCapabilityCache.set(client, capable);
  return capable;
}

module.exports = { withMongoTransaction, isTransactionCapable };
