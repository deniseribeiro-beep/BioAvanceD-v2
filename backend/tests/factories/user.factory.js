function buildUser(overrides = {}) {
  return {
    _id: 'qa-user-id-1',
    userID: 'qa-user-id-1',
    name: 'Usuario QA',
    email: 'qa@example.com',
    username: 'qa.user',
    accessType: 2,
    roleName: 'Tecnico',
    status: 'Ativo',
    ...overrides,
  };
}

function buildUserRegistrationPayload(overrides = {}) {
  return {
    name: 'Usuario QA',
    email: 'qa@example.com',
    username: 'qa.user',
    password: 'SenhaForte@123',
    accessType: 2,
    status: 'Ativo',
    ...overrides,
  };
}

module.exports = {
  buildUser,
  buildUserRegistrationPayload,
};
