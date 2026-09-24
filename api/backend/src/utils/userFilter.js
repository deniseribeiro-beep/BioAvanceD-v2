const { isUuid } = require('../foundation/userAccountIdentityMigrationV2');

function buildUserFilterById(id) {
  const userAccountId = typeof id === 'string' ? id.trim() : '';
  return isUuid(userAccountId)
    ? { userAccountId }
    : { userAccountId: { $in: [] } };
}

module.exports = { buildUserFilterById };
