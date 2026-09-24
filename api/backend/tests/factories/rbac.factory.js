const { createCollectionMock } = require('./db.factory');
const { ROLE_CODE_BY_LEGACY_NAME, PERMISSION_CATALOG, LEGACY_ROLES_SEED, ADDITIONAL_ROLES_SEED } = require('../../src/services/rbac-catalog-seed.service');

/**
 * #421: real query-matching mocks (findOne/find honor the actual filter) for
 * `roles`/`permissions`/`userRoleAssignments`, built from the real
 * LEGACY_ROLES_SEED (#436: previously a hand-copied duplicate here, now
 * imported directly so this fixture can't drift from the real seed). Test
 * files that build a mock DB for a route guarded by requireRole/
 * requirePermission need this since #421's cutover: enforcement resolves
 * via UserRoleAssignment -> Role -> Permission, not accessType/roleName
 * directly.
 *
 * Usage: `createDbMock({ ...yourCollections, ...buildRbacCollections([{ userAccountId: 'admin-test', accessType: 4 }]) })`
 */
const rolesSeed = LEGACY_ROLES_SEED;

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

function allPermissionDocs() {
  return Object.entries(PERMISSION_CATALOG).map(([permissionCode, entry]) => ({
    permissionId: `perm-${permissionCode}`,
    permissionCode,
    ...entry,
  }));
}

function allRoleDocs(extraRoles = []) {
  const permissionIdByCode = Object.fromEntries(
    Object.keys(PERMISSION_CATALOG).map((code) => [code, `perm-${code}`])
  );
  const legacyDocs = rolesSeed.roles.map((role) => {
    const roleCode = ROLE_CODE_BY_LEGACY_NAME[role.roleName];
    return {
      roleId: `role-${roleCode}`,
      roleCode,
      hierarchyLevel: role.accessType,
      roleStatus: 'active',
      permissionIds: role.permissions.map((code) => permissionIdByCode[code]),
    };
  });
  // #429: additive roles (e.g. `auditor`) have no accessType slot.
  const additionalDocs = ADDITIONAL_ROLES_SEED.map((role) => ({
    roleId: `role-${role.roleCode}`,
    roleCode: role.roleCode,
    hierarchyLevel: null,
    roleStatus: 'active',
    permissionIds: role.permissions.map((code) => permissionIdByCode[code]),
  }));
  // #1073: a role assembled by the test itself, for pinning that two
  // permission codes are genuinely SEPARABLE. Every seeded role grants the
  // codes it needs together, so a fixture built only from the seeds cannot
  // express "holds viewTemperature but not manageSensor" -- which is
  // precisely the property a permission split is supposed to create.
  const extraDocs = extraRoles.map((role) => ({
    roleId: `role-${role.roleCode}`,
    roleCode: role.roleCode,
    hierarchyLevel: role.hierarchyLevel ?? null,
    roleStatus: 'active',
    permissionIds: role.permissions.map((code) => permissionIdByCode[code]),
  }));
  return [...legacyDocs, ...additionalDocs, ...extraDocs];
}

const ROLE_ID_BY_ACCESS_TYPE = Object.fromEntries(
  rolesSeed.roles.map((role) => [role.accessType, `role-${ROLE_CODE_BY_LEGACY_NAME[role.roleName]}`])
);

/**
 * `users`: array of `{ userAccountId, accessType, roleCodes, organizationId }`
 * — one active UserRoleAssignment is synthesized per entry for the legacy
 * accessType-derived role, plus one more per entry in `roleCodes` (#429:
 * additive roles like `auditor`, granted alongside the accessType role, not
 * instead of it — omit `accessType` to grant only the additive role(s)).
 *
 * #340: the accessType-derived assignment also carries scopeType/scopeId
 * (dormant fields #615 wired up), mirroring rbac-assignment.service.js's
 * real resolveScopeForRole — hierarchyLevel-4 (accessType 4, Administrador)
 * gets 'global', every other accessType gets 'organization' with scopeId
 * defaulted to 'test-org-default' unless `organizationId` is given. The
 * default keeps every pre-existing call site (most of which don't care about
 * org-scope at all) resolving a *usable* scope through
 * requireOrganizationScope — callers testing org-scope enforcement itself
 * pass `organizationId` per user to control which organization each one
 * belongs to.
 *
 * #1073: `extraRoles` — `[{ roleCode, hierarchyLevel, permissions: [code] }]`
 * — appends roles the seeds do not contain, grantable through the same
 * `roleCodes` field. Needed to pin that two permission codes are separable
 * when every seeded role happens to grant both.
 */
function buildRbacCollections(users = [], extraRoles = []) {
  const assignments = users.flatMap(({ userAccountId, accessType, roleCodes = [], organizationId }) => {
    const docs = [];
    if (accessType != null) {
      const isBypass = Number(accessType) === 4;
      docs.push({
        userAccountId: String(userAccountId),
        roleId: ROLE_ID_BY_ACCESS_TYPE[Number(accessType)],
        assignmentStatus: 'active',
        validUntil: null,
        scopeType: isBypass ? 'global' : 'organization',
        scopeId: isBypass ? null : String(organizationId ?? 'test-org-default'),
      });
    }
    for (const roleCode of roleCodes) {
      docs.push({
        userAccountId: String(userAccountId),
        roleId: `role-${roleCode}`,
        assignmentStatus: 'active',
        validUntil: null,
        // #429 leaves an additive assignment scope-less on purpose: it rides
        // alongside a primary accessType assignment that carries the scope.
        // #1073: when the caller has NO accessType, that primary assignment
        // does not exist, so a scope-less additive role resolves as org-less
        // and requireOrganizationScope 403s before requirePermission is ever
        // consulted -- which silently turns a permission test into a scope
        // test. Only stamped when the call site asks for it, so the two
        // pre-existing scope-less `auditor` fixtures are untouched.
        ...(accessType == null && organizationId != null
          ? { scopeType: 'organization', scopeId: String(organizationId) }
          : {}),
      });
    }
    return docs;
  });

  const accountDocs = users.map(({ userAccountId, accessType, actorId: explicitActorId }) => {
    const id = String(userAccountId);
    // Prefer stable Stage 2E test Actor ids when the account id is one of the
    // well-known TEST_USER_ACCOUNT_IDS; otherwise use explicit actorId or a
    // deterministic sibling derived from the account UUID.
    const known = {
      '550e8400-e29b-41d4-a716-446655440001': '550e8400-e29b-41d4-a716-446655440011',
      '550e8400-e29b-41d4-a716-446655440002': '550e8400-e29b-41d4-a716-446655440012',
      '550e8400-e29b-41d4-a716-446655440003': '550e8400-e29b-41d4-a716-446655440013',
      '550e8400-e29b-41d4-a716-446655440004': '550e8400-e29b-41d4-a716-446655440014',
      '550e8400-e29b-41d4-a716-446655440099': '550e8400-e29b-41d4-a716-446655440019',
    };
    const actorId = explicitActorId || known[id] || id.replace(/[0-9a-f]$/i, (c) => (c === '0' ? '1' : '0'));
    return {
      userAccountId: id,
      actorId,
      accessType: Number(accessType) || 4,
      email: `${id}@example.test`,
      userStatus: 'active',
    };
  });
  const actorDocs = accountDocs.map((account) => ({
    actorId: account.actorId,
    actorType: 'user',
    actorStatus: 'active',
    displayName: `QA ${account.accessType}`,
  }));

  return {
    roles: queryableCollectionMock(allRoleDocs(extraRoles)),
    permissions: queryableCollectionMock(allPermissionDocs()),
    userRoleAssignments: queryableCollectionMock(assignments),
    // Stage 2E: authenticate() requires matching UserAccount + Actor UUID docs.
    userAccounts: queryableCollectionMock(accountDocs),
    actors: queryableCollectionMock(actorDocs),
  };
}

/**
 * Stateful variant (findOne/find read from a mutable array; insertOne
 * pushes; updateOne $sets in place) — for tests that exercise the real
 * seed/grant write path itself (`seedRolesAndPermissions`,
 * `grantRoleForAccessType`, `createFirstAdmin.js`, `registerUser`), not
 * just a route guarded by an existing, pre-seeded catalog.
 */
function mutableCollectionMock(seedDocs = []) {
  const { vi } = globalThis;
  const docs = [...seedDocs];
  return createCollectionMock({
    findOne: vi.fn(async (query = {}) => docs.find((d) => matchesQuery(d, query)) || null),
    find: vi.fn((query = {}) => ({
      toArray: vi.fn().mockResolvedValue(docs.filter((d) => matchesQuery(d, query))),
    })),
    insertOne: vi.fn(async (doc) => {
      docs.push(doc);
      return { insertedId: doc.roleId || doc.permissionId || doc.assignmentId };
    }),
    updateOne: vi.fn(async (filter, update) => {
      const doc = docs.find((d) => matchesQuery(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    }),
  });
}

function buildMutableRbacCollections() {
  return {
    roles: mutableCollectionMock([]),
    permissions: mutableCollectionMock([]),
    userRoleAssignments: mutableCollectionMock([]),
  };
}

module.exports = { buildRbacCollections, buildMutableRbacCollections };
