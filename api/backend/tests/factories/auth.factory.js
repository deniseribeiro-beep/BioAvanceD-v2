/**
 * Stage 2E auth fixtures: JWT + UserAccount + Actor must carry canonical UUIDs.
 * authenticate() rejects non-UUID userID/actorId before RBAC runs.
 */
const jwt = require('jsonwebtoken');
const { createCollectionMock } = require('./db.factory');
const { buildRbacCollections } = require('./rbac.factory');

const TEST_ACTOR_IDS = Object.freeze({
  1: '550e8400-e29b-41d4-a716-446655440011',
  2: '550e8400-e29b-41d4-a716-446655440012',
  3: '550e8400-e29b-41d4-a716-446655440013',
  4: '550e8400-e29b-41d4-a716-446655440014',
  legacy: '550e8400-e29b-41d4-a716-446655440019',
});

const TEST_USER_ACCOUNT_IDS = Object.freeze({
  1: '550e8400-e29b-41d4-a716-446655440001',
  2: '550e8400-e29b-41d4-a716-446655440002',
  3: '550e8400-e29b-41d4-a716-446655440003',
  4: '550e8400-e29b-41d4-a716-446655440004',
  legacy: '550e8400-e29b-41d4-a716-446655440099',
});

function matchesQuery(doc, query = {}) {
  return Object.entries(query).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in cond) {
      return cond.$in.includes(doc[key]);
    }
    return doc[key] === cond;
  });
}

function queryableCollectionMock(docs) {
  const { vi } = globalThis;
  return createCollectionMock({
    findOne: vi.fn(async (query = {}) => docs.find((d) => matchesQuery(d, query)) || null),
    find: vi.fn((query = {}) => ({
      toArray: vi.fn().mockResolvedValue(docs.filter((d) => matchesQuery(d, query))),
    })),
  });
}

function userForAccessType(accessType = 4) {
  const key = TEST_USER_ACCOUNT_IDS[accessType] ? accessType : 4;
  return {
    userAccountId: TEST_USER_ACCOUNT_IDS[key],
    actorId: TEST_ACTOR_IDS[key],
    accessType: Number(key) || 4,
  };
}

function makeAuthToken(accessType = 4, overrides = {}) {
  const user = userForAccessType(accessType);
  const secret = process.env.JWT_SECRET || 'vitest-secret-key';
  return jwt.sign(
    {
      userID: user.userAccountId,
      actorId: user.actorId,
      accessType: user.accessType,
      roleName: user.accessType >= 3 ? 'Coordenador' : 'Técnico',
      name: 'QA',
      mfaVerified: true,
      ...overrides,
    },
    secret,
    { expiresIn: '1h' },
  );
}

function makeLegacyClaimsToken(accessType = 4) {
  const user = {
    userAccountId: TEST_USER_ACCOUNT_IDS.legacy,
    actorId: TEST_ACTOR_IDS.legacy,
    accessType,
  };
  const secret = process.env.JWT_SECRET || 'vitest-secret-key';
  return jwt.sign(
    {
      userID: user.userAccountId,
      actorId: user.actorId,
      accessType,
      role: 'Coordenador',
      userName: 'legacyUser',
      mfaVerified: true,
    },
    secret,
    { expiresIn: '1h' },
  );
}

/**
 * Seed UserAccount + Actor docs for the given accessType slots (and optional extras).
 * Merge into createDbMock alongside buildRbacCollections.
 */
function buildAuthIdentityCollections(accessTypes = [2, 3, 4], extraUsers = []) {
  const users = [
    ...accessTypes.map((accessType) => userForAccessType(accessType)),
    ...extraUsers,
  ];
  if (!users.some((u) => u.userAccountId === TEST_USER_ACCOUNT_IDS.legacy)) {
    users.push({
      userAccountId: TEST_USER_ACCOUNT_IDS.legacy,
      actorId: TEST_ACTOR_IDS.legacy,
      accessType: 4,
    });
  }

  const accountDocs = users.map((u) => ({
    userAccountId: u.userAccountId,
    actorId: u.actorId,
    accessType: u.accessType,
    email: `${u.userAccountId}@example.test`,
    userStatus: 'active',
  }));
  const actorDocs = users.map((u) => ({
    actorId: u.actorId,
    actorType: 'user',
    actorStatus: 'active',
    displayName: `QA ${u.accessType}`,
  }));

  return {
    userAccounts: queryableCollectionMock(accountDocs),
    actors: queryableCollectionMock(actorDocs),
  };
}

/**
 * Full auth+RBAC seed for the common integration pattern.
 */
function buildAuthenticatedCollections(accessTypes = [2, 3, 4], rbacUsers) {
  const users = rbacUsers || accessTypes.map((accessType) => {
    const u = userForAccessType(accessType);
    return { userAccountId: u.userAccountId, accessType: u.accessType };
  });
  // Always include legacy slot used by makeLegacyClaimsToken
  if (!users.some((u) => u.userAccountId === TEST_USER_ACCOUNT_IDS.legacy)) {
    users.push({ userAccountId: TEST_USER_ACCOUNT_IDS.legacy, accessType: 4 });
  }
  return {
    ...buildRbacCollections(users),
    ...buildAuthIdentityCollections(accessTypes, users.map((u) => ({
      userAccountId: u.userAccountId,
      actorId: (Object.entries(TEST_USER_ACCOUNT_IDS).find(([, id]) => id === u.userAccountId)
        ? TEST_ACTOR_IDS[Object.entries(TEST_USER_ACCOUNT_IDS).find(([, id]) => id === u.userAccountId)[0]]
        : TEST_ACTOR_IDS[4]),
      accessType: u.accessType,
    }))),
  };
}

module.exports = {
  TEST_ACTOR_IDS,
  TEST_USER_ACCOUNT_IDS,
  userForAccessType,
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthIdentityCollections,
  buildAuthenticatedCollections,
};
