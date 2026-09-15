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
      permissions: ['createSample', 'withdrawSample', 'viewTemperature', 'manageTemperature', 'manageSensor', 'recordTemperature', 'uploadFiles', 'viewReports', 'manageStorageAllocation'],
    },
    {
      accessType: 3,
      roleName: 'Coordenador',
      permissions: ['createUser', 'createSample', 'editSample', 'createPatient', 'withdrawSample', 'uploadFiles', 'uploadSampleFiles', 'deleteSampleFiles', 'viewTemperature', 'manageTemperature', 'manageSensor', 'recordTemperature', 'viewReports', 'createResult', 'editResult', 'deleteResult', 'manageAccessRequests', 'manageReportTemplates', 'manageStorageAllocation', 'manageStorageTopology'],
    },
    {
      accessType: 4,
      roleName: 'Administrador',
      permissions: ['createUser', 'createSample', 'editSample', 'deleteSample', 'createPatient', 'withdrawSample', 'uploadFiles', 'uploadSampleFiles', 'deleteSampleFiles', 'viewTemperature', 'manageTemperature', 'manageSensor', 'recordTemperature', 'viewReports', 'manageBackup', 'manageSystem', 'resetMFA', 'forcePasswordReset', 'disableMFA', 'manageOrganizations', 'createResult', 'editResult', 'deleteResult', 'reidentifyParticipant', 'manageAccessRequests', 'manageReportTemplates', 'manageStorageAllocation', 'manageStorageTopology'],
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

/**
 * #630: `allowedActions` below was audited against every real
 * `requirePermission(code)` call site (22 distinct codes in use, 125 call
 * sites total — 116 in `src/interface/routes/` plus 9 in `src/routes/`, a
 * second, separate routes directory the original 17-codes/107-call-sites
 * count appears to have missed; re-measured by grepping for
 * requirePermission( occurrences and their literal string argument across
 * both directories, then counting occurrences for the call-site total and
 * distinct values for the code count) rather than trusted as-is — several
 * codes were
 * badly stale (e.g. `manageOrganizations` claimed only `UPDATE` while
 * `organization.routes.js` has gated `POST`/`DELETE` under it since
 * #576). Per-call-site action was derived from HTTP verb (GET->READ,
 * POST->CREATE, PUT/PATCH->UPDATE, DELETE->DELETE), with two overrides
 * where that default is plainly wrong: an `/export*` path segment maps
 * to EXPORT regardless of verb, and a POST to `/:id/<verb>` (an action
 * on an existing resource, not a new one) maps to UPDATE unless the verb
 * is itself clearly generative of a new sub-resource (e.g. adding a
 * note/observation/reading), which stays CREATE. No behavior change —
 * `requirePermission()` still ignores `allowedActions`; see #631.
 */
const PERMISSION_CATALOG = {
  viewReports: { resourceType: 'Report', allowedActions: ['CREATE', 'READ', 'DELETE', 'EXPORT'], displayName: 'Visualizar relatórios' },
  createSample: { resourceType: 'Sample', allowedActions: ['CREATE', 'READ'], displayName: 'Criar amostra' },
  withdrawSample: { resourceType: 'Sample', allowedActions: ['UPDATE'], displayName: 'Retirar amostra' },
  viewTemperature: { resourceType: 'Temperature', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Visualizar temperatura' },
  uploadFiles: { resourceType: 'SampleFile', allowedActions: ['CREATE', 'READ', 'UPDATE'], displayName: 'Enviar arquivos' },
  createUser: { resourceType: 'User', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Criar usuário' },
  editSample: { resourceType: 'Sample', allowedActions: ['UPDATE'], displayName: 'Editar amostra' },
  deleteSample: { resourceType: 'Sample', allowedActions: ['DELETE'], displayName: 'Excluir amostra' },
  createPatient: { resourceType: 'Patient', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Criar paciente' },
  // Storage allocation governs the canonical specimen-to-container custody
  // relationship. Position/rack relationships remain implementation details
  // of the same command, while SpecimenContainerAssignment is the aggregate
  // boundary exposed to authorization and audit.
  manageStorageAllocation: { resourceType: 'SpecimenContainerAssignment', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Gerenciar alocação de armazenamento' },
  // #929: broadened from ['READ', 'UPDATE']. #888 created this code with the
  // only two verbs storage.routes.js then used (PATCH /freezer/:id/room), but
  // equipment/facility/room .routes.js each gate POST, PUT and DELETE with it
  // as of #929. Since the derived action is the HTTP verb's and not chosen, a
  // READ/UPDATE-only set would 403 every create and every delete on those
  // three routers -- six of the nine sites -- while looking like a rename.
  manageStorageTopology: { resourceType: 'StorageContainer', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Gerenciar topologia de armazenamento' },
  uploadSampleFiles: { resourceType: 'SampleFile', allowedActions: ['CREATE'], displayName: 'Enviar arquivos da amostra' },
  deleteSampleFiles: { resourceType: 'SampleFile', allowedActions: ['DELETE'], displayName: 'Excluir arquivos da amostra' },
  // #632: broadened from ['UPDATE'] to cover backup.routes.js's real
  // operations (POST /perform -> CREATE, GET /list -> READ, POST
  // /restore/:fileName -> UPDATE) now that the route enforces this code
  // directly instead of a hardcoded requireRole(4).
  manageBackup: { resourceType: 'System', allowedActions: ['CREATE', 'READ', 'UPDATE'], displayName: 'Gerenciar backup' },
  manageSystem: { resourceType: 'System', allowedActions: ['UPDATE'], displayName: 'Gerenciar sistema' },
  resetMFA: { resourceType: 'User', allowedActions: ['UPDATE'], displayName: 'Redefinir MFA' },
  // RF014 AC#4 (#648): admin-initiated -- flags a target user's account so
  // their next login requires setting a new password, mirroring resetMFA's
  // shape (same resourceType/action, same "act on another user" concern).
  forcePasswordReset: { resourceType: 'User', allowedActions: ['UPDATE'], displayName: 'Forçar redefinição de senha' },
  // #1010: POST /users/:id/disable-mfa was gated by an in-handler
  // isAdministrator check only, so it appeared in no permission audit.
  // Same shape as resetMFA -- acts on another user's second factor.
  disableMFA: { resourceType: 'User', allowedActions: ['UPDATE'], displayName: 'Desativar MFA' },
  manageTemperature: { resourceType: 'Temperature', allowedActions: ['UPDATE'], displayName: 'Gerenciar incidentes de temperatura' },
  // #1073: every sensor and temperature WRITE route was gated on
  // 'viewTemperature' -- a read permission whose allowedActions had been
  // widened to the full CRUD set so the writes would pass. So "may look at
  // cold-chain data" and "may delete a sensor" were one capability, and no
  // catalogue edit could separate them.
  //
  // manageTemperature is NOT the answer despite the name: it is
  // ['UPDATE'] only and displayName-scoped to incidents, so swapping the
  // writes onto it would 403 every CREATE and DELETE -- the trap #929
  // records verbatim for manageStorageTopology. Two codes rather than one,
  // on #888's reasoning, because the routers have two genuinely different
  // concerns: the device's LIFECYCLE, and the ingestion of a READING.
  //
  // resourceType 'Device' is the dictionary's own entity for a sensor
  // (dict-02 ELM-0305..0309; ELM-0306 deviceType enumerates "sensor"
  // explicitly). Permission codes themselves are "Vocabulário interno
  // BioAvanceD" per P1X-0221, so the code name is ours to choose.
  //
  // allowedActions is derived from METHOD_TO_ACTION (rbac.js), not taste.
  manageSensor: { resourceType: 'Device', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Gerenciar sensores' },
  recordTemperature: { resourceType: 'Temperature', allowedActions: ['CREATE'], displayName: 'Registrar leitura de temperatura' },
  manageOrganizations: { resourceType: 'Organization', allowedActions: ['CREATE', 'UPDATE', 'DELETE'], displayName: 'Gerenciar organizações' },
  viewAuditLogs: { resourceType: 'AuditLog', allowedActions: ['READ'], displayName: 'Visualizar trilhas de auditoria' },
  createResult: { resourceType: 'Result', allowedActions: ['CREATE'], displayName: 'Criar arquivo de análise' },
  editResult: { resourceType: 'Result', allowedActions: ['UPDATE'], displayName: 'Editar arquivo de análise' },
  deleteResult: { resourceType: 'Result', allowedActions: ['DELETE'], displayName: 'Excluir arquivo de análise' },
  // RNF007 AC#5 (#560): reidentification must be gated to a legitimate,
  // defined need, not reachable via createPatient or any other broader
  // permission — Administrador-only until a narrower need surfaces.
  reidentifyParticipant: { resourceType: 'ParticipantIdentity', allowedActions: ['READ'], displayName: 'Reidentificar participante' },
  // RF024 (#646 Wave 3): create/evaluate/decide/distribute/revoke all live
  // behind this one code — see accessRequest.js's own comment for why no
  // dedicated researcher/committee role exists to split it across.
  manageAccessRequests: { resourceType: 'AccessRequest', allowedActions: ['CREATE', 'READ', 'UPDATE'], displayName: 'Gerenciar solicitações de acesso' },
  // RF008 AC#6 (#726): Coordenador/Administrador-only -- lets a report
  // template be created/edited without a code change to reports.routes.js.
  manageReportTemplates: { resourceType: 'ReportTemplate', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Gerenciar modelos de relatório' },
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
 * #1075: `permissions` was the last collection seeded through a bare
 * "already exists? skip" upsert -- the shape #646 Wave 3 replaced for
 * `roles` (upsertRole, below) and #1064 for `reportTemplates`
 * (report-template-seed.service.js's upsertByCode), and the one both of
 * those docblocks cite as their negative example. `existing` was returned
 * as-is, so a later PERMISSION_CATALOG correction never reached an
 * already-seeded database, on any re-run or process restart, silently.
 *
 * That is a change shape this repo performs routinely rather than a
 * contrived one: #929 widened `manageStorageTopology`'s allowedActions and
 * #632 did the same for `manageBackup`. A NEW permissionCode inserts
 * normally, so the skip only ever bit an EXISTING code being corrected --
 * exactly the case nothing was watching.
 *
 * Mirrors upsertByCode's shape: reconcile ONLY the fields that went stale,
 * and return the existing document untouched -- issuing no updateOne at
 * all -- when none of them differ, so a no-op boot performs no write.
 *
 * `displayName`, `resourceType` and `allowedActions` are catalog-owned:
 * buildPermissionDocs derives all three from PERMISSION_CATALOG, the code's
 * own source of truth, and dict-02 declares each Core (P1X-0219 /
 * P1X-0221 / P1X-0222). Everything else on the existing document is
 * preserved -- `permissionId` above all, since Role.permissionIds
 * references it and re-minting would orphan every role document, and also
 * `description` (P1X-0220), `conditionExpression` (P1X-0223) and
 * `permissionStatus` (P1X-0224), which are operator-owned in the same
 * sense reportTemplates' `name`/`templateStatus` are.
 *
 * `allowedActions` is compared with JSON.stringify, which for an array is
 * ORDER-sensitive. Both sides originate from the same catalog literal, so
 * a reorder there is a genuine change and one reconciling write is the
 * correct response -- it settles on the next boot rather than churning.
 *
 * NOTE the enforcing path does NOT read this row: requirePermission takes
 * `allowedActions` from the in-process PERMISSION_CATALOG constant
 * (infrastructure/middleware/rbac.js, #631), and the only database reader
 * of this collection is rbac-assignment.service.js's userHasPermission,
 * which uses `permissionId` alone. So a stale row does not currently cause
 * a wrong 403 -- it makes the persisted catalog disagree with the enforced
 * one, with nothing reconciling them. #1123 carries that larger question.
 */
async function upsertPermission(collection, doc) {
  const filter = { permissionCode: doc.permissionCode };
  const existing = await collection.findOne(filter);
  if (!existing) {
    await collection.insertOne(doc);
    return doc;
  }

  const displayNameChanged = existing.displayName !== doc.displayName;
  const resourceTypeChanged = existing.resourceType !== doc.resourceType;
  const allowedActionsChanged =
    JSON.stringify(existing.allowedActions || []) !== JSON.stringify(doc.allowedActions || []);
  if (!displayNameChanged && !resourceTypeChanged && !allowedActionsChanged) return existing;

  const reconciled = {
    displayName: doc.displayName,
    resourceType: doc.resourceType,
    allowedActions: doc.allowedActions,
    updatedAt: new Date(),
  };
  await collection.updateOne(filter, { $set: reconciled });
  return { ...existing, ...reconciled };
}

/**
 * RF024 (#646 Wave 3): a plain skip-on-existing upsert on `roles` left an
 * already-seeded role's permissionIds frozen forever at whatever they were
 * the first time this ran — `existing` was returned as-is, so a later
 * PERMISSION_CATALOG/LEGACY_ROLES_SEED addition (a new permission granted
 * to an existing role, e.g. this slice's own `manageAccessRequests`) never
 * reached a role document seeded before the addition, on any later re-run
 * or process restart. Roles now merge freshly-computed permissionIds into
 * whatever the role already has, instead of skipping existing docs
 * outright — `roleId` (and everything else `existing` already carries)
 * stays untouched, preserving the idempotency contract
 * rbac-catalog-seed.service.test.js already asserts on it.
 */
async function upsertRole(collection, doc) {
  const filter = { roleCode: doc.roleCode };
  const existing = await collection.findOne(filter);
  if (!existing) {
    await collection.insertOne(doc);
    return doc;
  }

  const mergedPermissionIds = Array.from(new Set([...(existing.permissionIds || []), ...doc.permissionIds]));
  const gainedNewPermissions = mergedPermissionIds.length !== (existing.permissionIds || []).length;
  if (!gainedNewPermissions) return existing;

  await collection.updateOne(filter, { $set: { permissionIds: mergedPermissionIds, updatedAt: new Date() } });
  return { ...existing, permissionIds: mergedPermissionIds };
}

async function seedRolesAndPermissions(db) {
  const permissionsCollection = await getCollection(db, 'permissions');
  const rolesCollection = await getCollection(db, 'roles');

  const permissionDocs = buildPermissionDocs();
  const storedPermissions = [];
  for (const doc of permissionDocs) {
    storedPermissions.push(await upsertPermission(permissionsCollection, doc));
  }
  const permissionIdByCode = Object.fromEntries(storedPermissions.map((p) => [p.permissionCode, p.permissionId]));

  const roleDocs = buildRoleDocs(permissionIdByCode);
  const storedRoles = [];
  for (const doc of roleDocs) {
    storedRoles.push(await upsertRole(rolesCollection, doc));
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
