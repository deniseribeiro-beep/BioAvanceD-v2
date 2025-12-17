require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

async function createCollection() {
  const db = await connectDB();
  try {
    const coll = db.collection('audit_roots');
    await coll.createIndex({ date: 1 }, { unique: true });
    await coll.createIndex({ chainIndex: 1 });
    await coll.createIndex({ previousRootHash: 1 });
    logger.info('✅ audit_roots collection and indexes created/verified');
  } catch (err) {
    logger.error('Error creating audit_roots collection/indexes:', err.message || err);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}

createCollection();
