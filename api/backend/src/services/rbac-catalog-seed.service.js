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
      permissions: ['createSample', 'withdrawSample', 'viewTemperature', 'manageTemperature', 'manageTemperaturePolicy', 'manageSensor', 'recordTemperature', 'uploadFiles', 'viewReports', 'viewEquipment', 'viewStorageTopology', 'manageStorageAllocation'],
    },
    {
      accessType: 3,
      roleName: 'Coordenador',
      permissions: ['createSample', 'editSample', 'createPatient', 'requestConsent', 'withdrawSample', 'uploadFiles', 'uploadSampleFiles', 'deleteSampleFiles', 'viewTemperature', 'manageTemperature', 'manageTemperaturePolicy', 'manageSensor', 'recordTemperature', 'viewReports', 'createResult', 'editResult', 'deleteResult', 'manageReportTemplates', 'viewEquipment', 'viewStorageTopology', 'manageStorageAllocation', 'manageStorageTopology', 'manageCustody', 'manageAccessGrants'],
    },
    {
      accessType: 4,
      roleName: 'Administrador',
      permissions: ['createUser', 'readUser', 'updateUser', 'deleteUser', 'assignRole', 'createSample', 'editSample', 'deleteSample', 'createPatient', 'requestConsent', 'withdrawSample', 'uploadFiles', 'uploadSampleFiles', 'deleteSampleFiles', 'viewTemperature', 'manageTemperature', 'manageTemperaturePolicy', 'manageSensor', 'recordTemperature', 'viewReports', 'manageBackup', 'manageSystem', 'resetMFA', 'forcePasswordReset', 'disableMFA', 'revokeSessions', 'setUserPassword', 'manageOrganizations', 'createResult', 'editResult', 'deleteResult', 'reidentifyParticipant', 'manageAccessRequests', 'manageReportTemplates', 'viewEquipment', 'viewStorageTopology', 'manageStorageAllocation', 'manageStorageTopology', 'manageCustody', 'manageAccessGrants'],
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
  // #1229 (Dennis, 2026-10-29, lifting #1008's deferral of direction 2):
  // createUser gated every verb on a user account, and the Coordenador held
  // it. Requisitos v4.0.0 RF003 names the Administrador as the only actor of
  // user management, and the only screens calling these routes are
  // Administrador-only, so the account verbs split into four codes, each
  // with the one action its routes derive, all seeded on the Administrador
  // only. createUser is POST /register; readUser the GETs; updateUser
  // PUT /:id and the organization-scope grant and revoke (passed 'UPDATE',
  // since they change the account's scope); deleteUser DELETE /:id.
  // upsertPermission narrows createUser's allowedActions and inserts the
  // three new codes, and upsertRole drops createUser from the Coordenador,
  // at the next boot (#1341), so an already-seeded database needs no
  // migration.
  createUser: { resourceType: 'User', allowedActions: ['CREATE'], displayName: 'Criar usuário' },
  readUser: { resourceType: 'User', allowedActions: ['READ'], displayName: 'Visualizar usuários' },
  updateUser: { resourceType: 'User', allowedActions: ['UPDATE'], displayName: 'Editar usuário' },
  deleteUser: { resourceType: 'User', allowedActions: ['DELETE'], displayName: 'Excluir usuário' },
  // #1008 (Denise, 2026-09-25): RF003 names the Administrador as the actor
  // for role assignment (AC#3, "atribuir papel com vigência e escopo"), so
  // granting, changing or re-dating a role is its own permission, seeded on
  // the Administrador only. (#1229 later took the account verbs from the
  // Coordenador as well.) CREATE is POST /api/users/register, where every new account is
  // granted a role. UPDATE is PUT /api/users/:id, checked in the handler
  // only when a role actually changes.
  assignRole: { resourceType: 'UserRoleAssignment', allowedActions: ['CREATE', 'UPDATE'], displayName: 'Atribuir papel' },
  editSample: { resourceType: 'Sample', allowedActions: ['UPDATE'], displayName: 'Editar amostra' },
  deleteSample: { resourceType: 'Sample', allowedActions: ['DELETE'], displayName: 'Excluir amostra' },
  createPatient: { resourceType: 'Patient', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Criar paciente' },
  // #929, closing the last of #888's four createPatient borrowers. The other
  // three were storage routes and took manageStorageTopology; eConsent.js's
  // POST /generate-link is a Consent action and had no code to move to, so
  // #888 left it borrowing a Patient-domain authorization for the act of
  // inviting a participant to consent. The audit trail recorded every consent
  // invitation as an exercise of "Criar paciente".
  //
  // Same TIER, different code -- Dennis, 2026-09-22, answering the question
  // #888 left open and #929 carried as its check 2 ('whether any borrower
  // should be a different tier rather than a differently-named code at the
  // same tier'). So this is seeded to Coordenador + Administrador, exactly
  // where createPatient already resolved, and the swap is a no-op for every
  // real caller. Tecnico and UsuarioExterno could not reach the route before
  // and still cannot.
  //
  // resourceType 'Consent' is dict-02's own entity (ELM-0088..0113), following
  // the same rule viewEquipment and viewStorageTopology follow: resourceType is
  // a 1..1 Core field of Permission (P1X-0221), so it is load-bearing and not a
  // label (#1123).
  //
  // CREATE only, deliberately. The route is a POST and METHOD_TO_ACTION
  // (rbac.js:82) derives CREATE, so a wider set buys nothing today and would
  // let the code later gate a read or a delete the way viewTemperature was
  // reused before #1073. Widening it is a catalogue edit, which is the point.
  requestConsent: { resourceType: 'Consent', allowedActions: ['CREATE'], displayName: 'Solicitar consentimento' },
  // #888: the catalog had no storage-scoped code at all, so storage.routes.js
  // could only be gated by role, and its one requirePermission site borrowed
  // 'createPatient' -- a Patient-domain authorization recorded for a freezer
  // action. Two codes rather than one, because the router has two genuinely
  // different concerns: WHERE a specimen sits, and WHAT the container tree is.
  //
  // allowedActions is derived from METHOD_TO_ACTION (rbac.js:82), not from
  // taste: POST -> CREATE, PATCH -> UPDATE, DELETE -> DELETE. dict-02's
  // Permission vocabulary also offers RELEASE, which maps neatly onto
  // DELETE /release/:sampleId, but the verb map derives DELETE for that route
  // and requirePermission checks the derived action -- so RELEASE would deny
  // every release. Left out deliberately; it needs a METHOD_TO_ACTION change
  // or an explicit second argument, and neither belongs in this issue.
  manageStorageAllocation: { resourceType: 'StorageAssignment', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Gerenciar alocação de armazenamento' },
  // #929: broadened from ['READ', 'UPDATE']. #888 created this code with the
  // only two verbs storage.routes.js then used (PATCH /freezer/:id/room), but
  // equipment/facility/room .routes.js each gate POST, PUT and DELETE with it
  // as of #929. Since the derived action is the HTTP verb's and not chosen, a
  // READ/UPDATE-only set would 403 every create and every delete on those
  // three routers -- six of the nine sites -- while looking like a rename.
  manageStorageTopology: { resourceType: 'StorageContainer', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Gerenciar topologia de armazenamento' },
  // #1146: facility.routes.js and room.routes.js gated their writes on
  // manageStorageTopology above but left all four of their GETs on
  // `authenticate` alone, so any authenticated principal could enumerate the
  // facility and room topology -- UsuarioExterno included, whose only seeded
  // grant is viewReports. #1087 had already closed the same hole in the third
  // file of the family, equipment.routes.js.
  //
  // NOT a reuse of viewEquipment, and the reason is the catalog's own data
  // rather than taste: viewEquipment carries resourceType 'Device', which a
  // facility or a room is not, and dict-02 makes resourceType a 1..1 Core
  // field of Permission (P1X-0221) -- load-bearing, not a label (#1123). This
  // takes manageStorageTopology's resourceType so the pair matches.
  //
  // READ-only on purpose, for #1087's reason: the #631 derived-action check
  // passes for GET, and the code can never later be reused to gate a write
  // the way viewTemperature was before #1073.
  //
  // Granted to Tecnico + Coordenador + Administrador, viewEquipment's exact
  // population. Unlike #1074's and #1087's splits this is NOT seeded to a
  // pre-existing population -- that population is everyone authenticated, so
  // any gate narrows. It matches what the UI already admits
  // (rolePermissions.ts:133 gates /facility-management to STAFF), so the one
  // principal that loses access had no UI path to these routes.
  viewStorageTopology: { resourceType: 'StorageContainer', allowedActions: ['READ'], displayName: 'Visualizar topologia de armazenamento' },
  // #1316: RF021 names the Coordenador as custody's actor, so the code is
  // granted to Coordenador + Administrador. Its own code rather than
  // manageStorageTopology: custody is WHO answers for a specimen, not WHAT
  // the container tree is. CREATE only: both custody routes are POSTs (an
  // assignment is closed by POST .../end), and the read takes
  // viewStorageTopology.
  manageCustody: { resourceType: 'CustodianshipAssignment', allowedActions: ['CREATE'], displayName: 'Gerenciar custódia' },
  // #1229: access.routes.js borrowed createUser for a different resource,
  // the report-access grant (dict-02's AccessGrant). Its own code, seeded to
  // exactly createUser's population then (Coordenador + Administrador), so
  // the move is a no-op for every caller, as #929 did for requestConsent.
  // The split of createUser itself by verb followed (above). The four
  // actions are what the routes' GET, POST, PUT and DELETE derive through
  // METHOD_TO_ACTION. upsertPermission inserts the code and upsertRole sets
  // both roles to the seed's list at the next boot (#1341), so an
  // already-seeded database needs no migration.
  manageAccessGrants: { resourceType: 'AccessGrant', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Gerenciar concessões de acesso' },
  // #1087: the three equipment GETs carried no permission at all, so every
  // authenticated principal could list the inventory -- UsuarioExterno
  // included, whose only seeded grant is viewReports. The sibling route
  // family already gated its reads (sensor.routes.js, on viewTemperature),
  // so this was a divergence between files written alongside each other.
  //
  // NOT manageStorageTopology, and the reason is a requirement rather than a
  // preference: Tecnico does not hold that code, while RF025's primary actor
  // IS Tecnico and its AC#3 is "Registrar equipamentos utilizados". Reusing
  // the write code would have 403'd the role the requirement is written for
  // -- the same allowedActions/population trap #929 records, reached from the
  // population side instead of the actions side.
  //
  // READ-only on purpose: the #631 derived-action check passes for GET, and
  // the code can never later be reused to gate a write the way
  // viewTemperature was before #1073.
  //
  // resourceType 'Device' follows manageSensor's precedent of taking the
  // dictionary's own entity; #666 records dict-02's Device as the counterpart
  // of this repo's Equipment model.
  //
  // Granted to the three roles the frontend already admits: rolePermissions.ts
  // gates /equipment to STAFF (Administrador, Coordenador, Tecnico). This
  // narrows the BACKEND to what the UI already assumed, and the one principal
  // that loses access -- UsuarioExterno -- had no UI path to it.
  viewEquipment: { resourceType: 'Device', allowedActions: ['READ'], displayName: 'Visualizar equipamentos' },
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
  // #1020: RF003 AC#5 ("Revogar sessões") as an administrator's own act on
  // another user's sessions, not only a side effect of a password set or MFA
  // reset. Same shape as resetMFA.
  revokeSessions: { resourceType: 'User', allowedActions: ['UPDATE'], displayName: 'Revogar sessões' },
  // #1013: an administrator setting another user's password. It rode on
  // PUT /api/users/:id under createUser, with no reuse check, no history and
  // a generic audit row. Same shape as resetMFA.
  setUserPassword: { resourceType: 'User', allowedActions: ['UPDATE'], displayName: 'Definir senha de usuário' },
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
  // #1074, the write half, and the same defect as #1073 one resource over:
  // the three policy WRITES were gated on a READ code. Because that code's
  // allowedActions had already been widened to full CRUD, the #631 derived-
  // action check passed and nothing was broken -- what was broken is that
  // "may look at a threshold" and "may rewrite the threshold that decides
  // whether an excursion is detected at all" were one capability, and no
  // catalogue edit could separate them.
  //
  // manageTemperature is not the answer here either, for the reason recorded
  // above: ['UPDATE'] only, so it would 403 POST and DELETE.
  //
  // resourceType follows the precedent set for manageSensor -- the
  // dictionary's own entity, not a coinage. dict-02 P1X-0105..0112 is
  // ThresholdProfile, and contracts/canonical/v1 maps the temperaturePolicies
  // collection (#1089's surviving store) onto exactly that entity.
  //
  // GRANTS ARE DELIBERATELY UNCHANGED: seeded to the same three roles that
  // already held viewTemperature, so nobody gains or loses access today.
  // Whether a Tecnico should govern thresholds is #1074's open question and
  // Denise's to answer; this makes answering it a catalogue edit.
  manageTemperaturePolicy: { resourceType: 'ThresholdProfile', allowedActions: ['CREATE', 'READ', 'UPDATE', 'DELETE'], displayName: 'Gerenciar políticas de temperatura' },
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
  // Administrador-only (#662, Denise 2026-09-25): the committee decision is
  // at least as sensitive as reidentifyParticipant above, so it takes the
  // same posture until a real multi-approver committee workflow exists.
  // upsertRole sets each role to the seed's list, so the old Coordenador
  // grant comes off already-seeded databases at their next boot (#1341).
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
 * Readers: requirePermission takes `allowedActions` from the in-process
 * PERMISSION_CATALOG constant (infrastructure/middleware/rbac.js, #631);
 * userHasPermission (rbac-assignment.service.js) uses `permissionId`; and
 * GET /api/security/permissions shows `displayName` (#1341). The catalog is
 * the one source, and this row is its reconciled copy.
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
 * the first time this ran, so a later grant never reached it.
 *
 * #1341: a role's permission set is catalog-owned. The v4.0.0 requirements
 * make only the user-to-role link runtime-managed (RF003 AC3 and AC6), and
 * dict-02 gives UserRoleAssignment its grant and revoke audit fields while
 * Role.permissionIds (P1X-0214) has none. Nothing at runtime writes
 * permissionIds either. So the stored role is SET to the seed's list on
 * every boot, not merged with it. A merge let a grant added by hand stay
 * forever and brought a revoked one back, and it needed a list of retired
 * grants (#662) to withdraw one; setting it covers both directions.
 *
 * `roleId` and every other field on the existing document stay untouched,
 * and a boot that changes nothing issues no write.
 */
async function upsertRole(collection, doc) {
  const filter = { roleCode: doc.roleCode };
  const existing = await collection.findOne(filter);
  if (!existing) {
    await collection.insertOne(doc);
    return doc;
  }

  const existingIds = existing.permissionIds || [];
  const seededIds = Array.from(new Set(doc.permissionIds));
  const unchanged = seededIds.length === existingIds.length
    && seededIds.every((id) => existingIds.includes(id));
  if (unchanged) return existing;

  await collection.updateOne(filter, { $set: { permissionIds: seededIds, updatedAt: new Date() } });
  return { ...existing, permissionIds: seededIds };
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
