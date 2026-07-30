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

module.exports = { withMongoTransaction };
