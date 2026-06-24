const logger = require('../utils/logger');

async function ensureInitialAdmin(db) {
  void db;
  logger.info('[BOOTSTRAP] Bootstrap automatico de admin desativado. Use npm run admin:create-first.');
}

module.exports = {
  ensureInitialAdmin
};
