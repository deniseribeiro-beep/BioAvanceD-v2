const { createCollectionMock } = require('./db.factory');
const { ROLE_CODE_BY_LEGACY_NAME, PERMISSION_CATALOG, ADDITIONAL_ROLES_SEED } = require('../../src/services/rbac-catalog-seed.service');

/**
 * #421: real query-matching mocks (findOne/find honor the actual filter) for
 * `roles`/`permissions`/`userRoleAssignments`, built from the legacy
 * accessType->permission mapping below (formerly `roles.min.json`, retired
 * as a runtime file by #432 — this fixture is now its only consumer). Test
 * files that build a mock DB for a route guarded by requireRole/
 * requirePermission need this since #421's cutover: enforcement resolves
 * via UserRoleAssignment -> Role -> Permission, not accessType/roleName
 * directly.
 *
 * Usage: `createDbMock({ ...yourCollections, ...buildRbacCollections([{ userAccountId: 'admin-test', accessType: 4 }]) })`
 */
const rolesSeed = {
  roles: [
    {
      accessType: 1,
      roleName: 'UsuarioExterno',
      permissions: ['viewReports'],
    },
    {
      accessType: 2,
      roleName: 'Tecnico',
      permissions: ['createSample', 'withdrawSample', 'viewTemperature', 'manageTemperature', 'uploadFiles', 'viewReports'],
    },
    {
      accessType: 3,
      roleName: 'Coordenador',
      permissions: ['createUser', 'createSample', 'editSample', 'createPatient', 'withdrawSample', 'uploadFiles', 'uploadSampleFiles', 'deleteSampleFiles', 'viewTemperature', 'manageTemperature', 'viewReports', 'createResult', 'editResult', 'deleteResult'],
    },
    {
      accessType: 4,
      roleName: 'Administrador',
      permissions: ['createUser', 'createSample', 'editSample', 'deleteSample', 'createPatient', 'withdrawSample', 'uploadFiles', 'uploadSampleFiles', 'deleteSampleFiles', 'viewTemperature', 'manageTemperature', 'viewReports', 'manageBackup', 'manageSystem', 'resetMFA', 'manageOrganizations', 'createResult', 'editResult', 'deleteResult'],
    },
  ],
};

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

function allRoleDocs() {
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
  return [...legacyDocs, ...additionalDocs];
}

const ROLE_ID_BY_ACCESS_TYPE = Object.fromEntries(
  rolesSeed.roles.map((role) => [role.accessType, `role-${ROLE_CODE_BY_LEGACY_NAME[role.roleName]}`])
);

/**
 * `users`: array of `{ userAccountId, accessType, roleCodes }` — one active
 * UserRoleAssignment is synthesized per entry for the legacy
 * accessType-derived role, plus one more per entry in `roleCodes` (#429:
 * additive roles like `auditor`, granted alongside the accessType role, not
 * instead of it — omit `accessType` to grant only the additive role(s)).
 */
function buildRbacCollections(users = []) {
  const assignments = users.flatMap(({ userAccountId, accessType, roleCodes = [] }) => {
    const docs = [];
    if (accessType != null) {
      docs.push({
        userAccountId: String(userAccountId),
        roleId: ROLE_ID_BY_ACCESS_TYPE[Number(accessType)],
        assignmentStatus: 'active',
        validUntil: null,
      });
    }
    for (const roleCode of roleCodes) {
      docs.push({
        userAccountId: String(userAccountId),
        roleId: `role-${roleCode}`,
        assignmentStatus: 'active',
        validUntil: null,
      });
    }
    return docs;
  });

  return {
    roles: queryableCollectionMock(allRoleDocs()),
    permissions: queryableCollectionMock(allPermissionDocs()),
    userRoleAssignments: queryableCollectionMock(assignments),
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
