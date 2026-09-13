const { randomUUID } = require('crypto');

function buildUser(overrides = {}) {
  const uniqueToken = randomUUID().slice(0, 8);
  return {
    _id: uniqueToken,
    userID: uniqueToken,
    name: `Usuario-${uniqueToken}`,
    email: `${uniqueToken}@example.com`,
    username: `qa.${uniqueToken}`,
    accessType: 2,
    roleName: 'Tecnico',
    status: 'Ativo',
    ...overrides,
  };
}

function buildUserRegistrationPayload(overrides = {}) {
  const uniqueToken = randomUUID().slice(0, 8);
  return {
    name: `Usuario-${uniqueToken}`,
    email: `${uniqueToken}@example.com`,
    username: `qa.${uniqueToken}`,
    password: `SenhaForte@${uniqueToken}`,
    accessType: 2,
    status: 'Ativo',
    ...overrides,
  };
}

module.exports = {
  buildUser,
  buildUserRegistrationPayload,
};
