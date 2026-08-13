const { getCollection } = require('../utils/collectionResolver');
const RoleModel = require('../models/Role');
const PermissionModel = require('../models/Permission');

/**
 * dict-02 P1X-0209..0224 (#420): one-time idempotent seed of the Role and
 * Permission catalogs. Originally seeded from roles.min.json's 4 hardcoded
 * roles; #428 retired that file as a runtime dependency, so the same 4
 * roles/permissions are now inlined here directly (byte-for-byte the same
 * roleName/accessType/permissions data roles.min.json held). dict-02 itself
 * only specifies permissionCode from this source — resourceType and
 * allowedActions aren't derivable from it, so PERMISSION_CATALOG below is
 * the seed's own best-effort mapping onto dict-02's
 * resourceType/allowedActions vocabulary, not a value copied from any
 * source document.
 */
const ROLE_CODE_BY_LEGACY_NAME = {
  UsuarioExterno: 'external_user',
  Tecnico: 'technician',
  Coordenador: 'coordinator',
  Administrador: 'administrator',
};

const ROLE_DISPLAY_NAMES = {
  external_user: 'Usuário externo',
  technician: 'Técnico',
  coordinator: 'Coordenador',
  administrator: 'Administrador',
};

const LEGACY_ROLES_SEED = {
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
      permissions: ['createUser', 'createSample', 'editSample', 'deleteSample', 'createPatient', 'withdrawSample', 'uploadFiles', 'uploadSampleFiles', 'deleteSampleFiles', 'viewTemperature', 'manageTemperature', 'viewReports', 'manageBackup', 'manageSystem', 'resetMFA', 'manageOrganizations', 'createResult', 'editResult', 'deleteResult', 'reidentifyParticipant'],
    },
  ],
};

/**
 * #429: roles not tied to any `accessType` slot — granted additively
 * alongside a user's primary (accessType-derived) role via
 * `grantAdditionalRole`, not as a replacement for it. `auditor` closes the
 * gap `logs.routes.js`'s `requireAuditReader` used to fill with an
 * unauthenticated-source `roleName` substring check (#426).
 */
const ADDITIONAL_ROLES_SEED = [
  {
    roleCode: 'auditor',
    displayName: 'Auditor',
    permissions: ['viewAuditLogs'],
  },
];

const PERMISSION_CATALOG = {
  viewReports: { resourceType: 'Report', allowedActions: ['READ'], displayName: 'Visualizar relatórios' },
  createSample: { resourceType: 'Sample', allowedActions: ['CREATE'], displayName: 'Criar amostra' },
  withdrawSample: { resourceType: 'Sample', allowedActions: ['UPDATE'], displayName: 'Retirar amostra' },
  viewTemperature: { resourceType: 'Temperature', allowedActions: ['READ'], displayName: 'Visualizar temperatura' },
  uploadFiles: { resourceType: 'SampleFile', allowedActions: ['CREATE'], displayName: 'Enviar arquivos' },
  createUser: { resourceType: 'User', allowedActions: ['CREATE'], displayName: 'Criar usuário' },
  editSample: { resourceType: 'Sample', allowedActions: ['UPDATE'], displayName: 'Editar amostra' },
  deleteSample: { resourceType: 'Sample', allowedActions: ['DELETE'], displayName: 'Excluir amostra' },
  createPatient: { resourceType: 'Patient', allowedActions: ['CREATE'], displayName: 'Criar paciente' },
  uploadSampleFiles: { resourceType: 'SampleFile', allowedActions: ['CREATE'], displayName: 'Enviar arquivos da amostra' },
  deleteSampleFiles: { resourceType: 'SampleFile', allowedActions: ['DELETE'], displayName: 'Excluir arquivos da amostra' },
  manageBackup: { resourceType: 'System', allowedActions: ['UPDATE'], displayName: 'Gerenciar backup' },
  manageSystem: { resourceType: 'System', allowedActions: ['UPDATE'], displayName: 'Gerenciar sistema' },
  resetMFA: { resourceType: 'User', allowedActions: ['UPDATE'], displayName: 'Redefinir MFA' },
  manageTemperature: { resourceType: 'Temperature', allowedActions: ['UPDATE'], displayName: 'Gerenciar incidentes de temperatura' },
  manageOrganizations: { resourceType: 'Organization', allowedActions: ['UPDATE'], displayName: 'Gerenciar organizações' },
  viewAuditLogs: { resourceType: 'AuditLog', allowedActions: ['READ'], displayName: 'Visualizar trilhas de auditoria' },
  createResult: { resourceType: 'Result', allowedActions: ['CREATE'], displayName: 'Criar arquivo de análise' },
  editResult: { resourceType: 'Result', allowedActions: ['UPDATE'], displayName: 'Editar arquivo de análise' },
  deleteResult: { resourceType: 'Result', allowedActions: ['DELETE'], displayName: 'Excluir arquivo de análise' },
  // RNF007 AC#5 (#560): reidentification must be gated to a legitimate,
  // defined need, not reachable via createPatient or any other broader
  // permission — Administrador-only until a narrower need surfaces.
  reidentifyParticipant: { resourceType: 'ParticipantIdentity', allowedActions: ['READ'], displayName: 'Reidentificar participante' },
};

function allSeedRoles() {
  return [...LEGACY_ROLES_SEED.roles, ...ADDITIONAL_ROLES_SEED];
}

function buildPermissionDocs() {
  const codes = new Set();
  for (const role of allSeedRoles()) {
    for (const code of role.permissions) codes.add(code);
  }
  return [...codes].map((permissionCode) => {
    const catalogEntry = PERMISSION_CATALOG[permissionCode];
    if (!catalogEntry) {
      throw new Error(`LEGACY_ROLES_SEED referencia permissão sem mapeamento no catálogo: ${permissionCode}`);
    }
    return PermissionModel.create({
      permissionCode,
      displayName: catalogEntry.displayName,
      resourceType: catalogEntry.resourceType,
      allowedActions: catalogEntry.allowedActions,
    });
  });
}

function buildRoleDocs(permissionIdByCode) {
  const legacyDocs = LEGACY_ROLES_SEED.roles.map((role) => {
    const roleCode = ROLE_CODE_BY_LEGACY_NAME[role.roleName];
    if (!roleCode) {
      throw new Error(`LEGACY_ROLES_SEED referencia papel sem mapeamento de roleCode: ${role.roleName}`);
    }
    return RoleModel.create({
      roleCode,
      displayName: ROLE_DISPLAY_NAMES[roleCode],
      hierarchyLevel: role.accessType,
      permissionIds: role.permissions.map((code) => permissionIdByCode[code]),
    });
  });

  // #429: additive roles have no `accessType` slot, so no hierarchyLevel —
  // they never replace a user's primary role, only stack alongside it.
  const additionalDocs = ADDITIONAL_ROLES_SEED.map((role) => RoleModel.create({
    roleCode: role.roleCode,
    displayName: role.displayName,
    hierarchyLevel: null,
    permissionIds: role.permissions.map((code) => permissionIdByCode[code]),
  }));

  return [...legacyDocs, ...additionalDocs];
}

/**
 * Upserts by the catalog's own stable business key (roleCode/permissionCode,
 * per dict-02's "índice único" note on both fields), not `_id` — running
 * this twice must not create duplicates or new permissionIds for an
 * already-seeded role/permission.
 */
async function upsertByKey(collection, doc, keyField) {
  const filter = { [keyField]: doc[keyField] };
  const existing = await collection.findOne(filter);
  if (existing) return existing;
  await collection.insertOne(doc);
  return doc;
}

async function seedRolesAndPermissions(db) {
  const permissionsCollection = await getCollection(db, 'permissions');
  const rolesCollection = await getCollection(db, 'roles');

  const permissionDocs = buildPermissionDocs();
  const storedPermissions = [];
  for (const doc of permissionDocs) {
    storedPermissions.push(await upsertByKey(permissionsCollection, doc, 'permissionCode'));
  }
  const permissionIdByCode = Object.fromEntries(storedPermissions.map((p) => [p.permissionCode, p.permissionId]));

  const roleDocs = buildRoleDocs(permissionIdByCode);
  const storedRoles = [];
  for (const doc of roleDocs) {
    storedRoles.push(await upsertByKey(rolesCollection, doc, 'roleCode'));
  }

  return { roles: storedRoles, permissions: storedPermissions };
}

module.exports = {
  seedRolesAndPermissions,
  ROLE_CODE_BY_LEGACY_NAME,
  PERMISSION_CATALOG,
  LEGACY_ROLES_SEED,
  ADDITIONAL_ROLES_SEED,
};
