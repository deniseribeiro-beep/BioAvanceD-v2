const { getCollection } = require('../utils/collectionResolver');
const UserRoleAssignmentModel = require('../models/UserRoleAssignment');
const { seedRolesAndPermissions } = require('./rbac-catalog-seed.service');

/**
 * #421: atomic cutover of `requirePermission`/`requireRole` from
 * accessType/roleName to UserRoleAssignment -> Role -> Permission. This
 * module is the one place that resolves a user's active roles/permissions
 * from the new model, and the one place that grants a UserRoleAssignment —
 * every user-creation path (registration, first-admin bootstrap, the
 * backfill script) must call `grantRoleForAccessType` so no user ever ends
 * up with an accessType but no corresponding assignment.
 */
const ROLE_CODE_BY_ACCESS_TYPE = {
  1: 'external_user',
  2: 'technician',
  3: 'coordinator',
  4: 'administrator',
};

async function getActiveAssignments(db, userAccountId) {
  const assignments = await getCollection(db, 'userRoleAssignments');
  const now = new Date();
  const docs = await assignments.find({
    userAccountId: String(userAccountId),
    assignmentStatus: 'active',
  }).toArray();
  return docs.filter((doc) => !doc.validUntil || new Date(doc.validUntil) > now);
}

async function getActiveRoles(db, userAccountId) {
  const assignmentDocs = await getActiveAssignments(db, userAccountId);
  if (!assignmentDocs.length) return [];

  const roles = await getCollection(db, 'roles');
  const roleIds = [...new Set(assignmentDocs.map((doc) => doc.roleId))];
  return roles.find({ roleId: { $in: roleIds }, roleStatus: 'active' }).toArray();
}

async function resolveUserHierarchyLevel(db, userAccountId) {
  const roleDocs = await getActiveRoles(db, userAccountId);
  if (!roleDocs.length) return null;
  return Math.max(...roleDocs.map((role) => Number(role.hierarchyLevel) || 0));
}

async function userHasPermission(db, userAccountId, permissionCode) {
  const roleDocs = await getActiveRoles(db, userAccountId);
  if (!roleDocs.length) return false;

  const permissions = await getCollection(db, 'permissions');
  const permissionDoc = await permissions.findOne({ permissionCode });
  if (!permissionDoc) return false;

  return roleDocs.some(
    (role) => Array.isArray(role.permissionIds) && role.permissionIds.includes(permissionDoc.permissionId)
  );
}

/**
 * #426: roleCodes of a user's currently active roles, for callers that need
 * to gate on role identity (admin checks, notification-recipient queries)
 * without reading `accessType`/`roleName` off the User document directly.
 */
async function getActiveRoleCodes(db, userAccountId) {
  const roleDocs = await getActiveRoles(db, userAccountId);
  return roleDocs.map((role) => role.roleCode);
}

async function isAdministrator(db, userAccountId) {
  const roleCodes = await getActiveRoleCodes(db, userAccountId);
  return roleCodes.includes('administrator');
}

/**
 * #1056: who may read the RNF009 audit trail (the `logs` collection).
 *
 * This lived only inside logs.routes.js's requireAuditReader middleware,
 * while reports.routes.js reached the same collection through
 * handleAccessLogs behind `viewReports` alone -- which is UsuarioExterno's
 * entire permission set. Two routers, one collection, opposite answers.
 * Hoisted here so there is one definition and the two cannot drift: the
 * middleware keeps its own HTTP shaping, reports.routes.js applies it by
 * `handlerKey` inside buildPreviewData.
 *
 * Deliberately the same admission rule the middleware already had (#426,
 * #429) -- administrator, or a real `auditor` roleCode -- not a widened or
 * narrowed one. Broadening it is a separate decision and does not belong in
 * a fix whose whole point is that the two surfaces should agree.
 */
async function isAuditReader(db, userAccountId) {
  const roleCodes = await getActiveRoleCodes(db, userAccountId);
  return roleCodes.includes('administrator') || roleCodes.includes('auditor');
}

const ROLE_CODE_DISPLAY_NAME = {
  external_user: 'Usuário Externo',
  technician: 'Técnico',
  coordinator: 'Coordenador',
  administrator: 'Administrador',
};

/**
 * #427: display roleName resolved from a user's active RBAC assignment, for
 * response/list shaping that used to read the `roleName` written directly
 * onto the User document — write paths stopped populating that field this
 * slice, so it can no longer be trusted as a source for display either.
 */
async function resolveRoleDisplayName(db, userAccountId) {
  const roleCodes = await getActiveRoleCodes(db, userAccountId);
  const primary = roleCodes.find((code) => ROLE_CODE_DISPLAY_NAME[code]);
  return primary ? ROLE_CODE_DISPLAY_NAME[primary] : 'Técnico';
}

/**
 * #426: userAccountIds of every user with a currently active assignment to
 * any of `roleCodes` — replaces `User.find({ accessType: { $in: [...] } })`
 * for notification-recipient-style queries.
 */
async function findUserAccountIdsByRoleCodes(db, roleCodes) {
  const roles = await getCollection(db, 'roles');
  const roleDocs = await roles.find({ roleCode: { $in: roleCodes }, roleStatus: 'active' }).toArray();
  const roleIds = roleDocs.map((role) => role.roleId);
  if (!roleIds.length) return [];

  const assignments = await getCollection(db, 'userRoleAssignments');
  const now = new Date();
  const docs = await assignments.find({
    roleId: { $in: roleIds },
    assignmentStatus: 'active',
  }).toArray();
  const active = docs.filter((doc) => !doc.validUntil || new Date(doc.validUntil) > now);
  return [...new Set(active.map((doc) => doc.userAccountId))];
}

/**
 * #622: shared organizationId referential check for every RBAC path that
 * writes a UserRoleAssignment.scopeId — mirrors #617's route-level check
 * (user.routes.js) but applied here so ops-script callers that bypass those
 * routes (createFirstAdmin.js, backfillUserRoleAssignments) can't write an
 * unvalidated scopeId either. Normalizes the same way the routes do (trim,
 * empty string -> null) before validating a truthy value against the
 * `organizations` collection.
 */
async function validateOrganizationId(db, organizationId) {
  const normalized = organizationId == null ? null : (String(organizationId).trim() || null);
  if (normalized == null) return null;

  const organizations = await getCollection(db, 'organizations');
  const organization = await organizations.findOne({ organizationId: normalized });
  if (!organization) {
    throw new Error(`organizationId ${normalized} não encontrado`);
  }
  return normalized;
}

/**
 * #615: resolves the scopeType/scopeId a new assignment should carry —
 * Administrador (hierarchyLevel 4) is the only bypass role and always gets
 * `global`; every other role (including additive ones like `auditor`, whose
 * roleDoc has no hierarchyLevel) is scoped to the given organizationId. The
 * single place this rule lives, so grant paths can't drift from each other.
 */
async function resolveScopeForRole(db, roleDoc, organizationId) {
  if (Number(roleDoc.hierarchyLevel) === 4) {
    return { scopeType: 'global', scopeId: null };
  }
  const scopeId = await validateOrganizationId(db, organizationId);
  return { scopeType: 'organization', scopeId };
}

/**
 * #1028: the pre-write half of grantRoleForAccessType's own guards, callable
 * BEFORE a caller's insertOne.
 *
 * registerUser inserts the User document and THEN grants the assignment, with
 * no transaction and no rollback, so a throw from grantRoleForAccessType
 * leaves a User able to authenticate with every permission check returning
 * false and nothing explaining why. #435 closed the accessType trigger by
 * checking it before the write; this closes the other two the same way --
 * the unseeded RBAC catalogue and an unknown organizationId.
 *
 * Deliberately fail-fast rather than atomic. A Mongo transaction is not
 * available: only compose.test.yml runs a replica set, so wrapping the pair
 * in withMongoTransaction would break user creation on dev and prod while the
 * test gate stayed green. A compensating delete would work but is best-effort
 * and needs the users collection threaded down here.
 *
 * Reuses resolveScopeForRole rather than re-implementing the rule, so this
 * cannot drift from the grant it is guarding -- including the Administrador
 * (hierarchyLevel 4) bypass, which is scoped `global` and therefore must NOT
 * have its organizationId validated.
 *
 * Returns the roleDoc it looked up, so a caller that wants it need not repeat
 * the query.
 */
async function assertGrantPreconditions(db, { accessType, organizationId = null }) {
  const roleCode = ROLE_CODE_BY_ACCESS_TYPE[Number(accessType)];
  if (!roleCode) {
    throw new Error(`accessType sem roleCode correspondente: ${accessType}`);
  }

  const roles = await getCollection(db, 'roles');
  const roleDoc = await roles.findOne({ roleCode });
  if (!roleDoc) {
    throw new Error(`Role não encontrado para roleCode: ${roleCode} (catálogo RBAC não semeado?)`);
  }

  await resolveScopeForRole(db, roleDoc, organizationId);

  return roleDoc;
}

/**
 * Grants the legacy role matching `accessType` to `userAccountId`, upserting
 * by (userAccountId, roleId) so calling this more than once for the same
 * user/role is a no-op — required for the backfill script to be idempotent
 * and safe to also call from every user-creation path.
 */
async function grantRoleForAccessType(db, { userAccountId, accessType, grantedBy, organizationId = null }) {
  const roleCode = ROLE_CODE_BY_ACCESS_TYPE[Number(accessType)];
  if (!roleCode) {
    throw new Error(`accessType sem roleCode correspondente: ${accessType}`);
  }

  const roles = await getCollection(db, 'roles');
  const roleDoc = await roles.findOne({ roleCode });
  if (!roleDoc) {
    throw new Error(`Role não encontrado para roleCode: ${roleCode} (catálogo RBAC não semeado?)`);
  }

  const assignments = await getCollection(db, 'userRoleAssignments');
  const existing = await assignments.findOne({
    userAccountId: String(userAccountId),
    roleId: roleDoc.roleId,
    assignmentStatus: 'active',
  });
  // Note: does NOT resync scope on a repeat call for an already-active
  // assignment — only `updateAssignmentScope`/`changeUserRole` change scope
  // post-grant. A future caller passing a different organizationId here for
  // an already-assigned user/role would have it silently discarded.
  if (existing) return existing;

  const { scopeType, scopeId } = await resolveScopeForRole(db, roleDoc, organizationId);
  const doc = UserRoleAssignmentModel.create({
    userAccountId: String(userAccountId),
    roleId: roleDoc.roleId,
    scopeType,
    scopeId,
    grantedBy: String(grantedBy || 'system'),
  });
  await assignments.insertOne(doc);
  return doc;
}

/**
 * One-time idempotent backfill: grants every existing `users` document its
 * UserRoleAssignment from its current accessType, since UserRoleAssignment
 * didn't exist before #420 and roles.min.json has no per-user data.
 *
 * #437: ensures the RBAC catalog is seeded before granting, mirroring
 * `createFirstAdmin.js` (#421) — a shared/dev stack with pre-existing users
 * never reaches `createFirstAdmin`'s own seed call (it aborts early when
 * users already exist), so this is the only remaining path that grants a
 * role and must be self-sufficient rather than assuming the catalog exists.
 */
async function backfillUserRoleAssignments(db) {
  await seedRolesAndPermissions(db);
  const users = db.collection('users');
  const userDocs = await users.find({}).toArray();

  const granted = [];
  const skipped = [];
  for (const user of userDocs) {
    const userAccountId = user._id.toString();
    if (!user.accessType) {
      // Can't guess a role for a user with no accessType: roleName was
      // dropped from the User document in the same #427 change that
      // dropped accessType, so there's no display hint to fall back to
      // either. `authService.getAccessTypeForRole` defaults unknown input
      // to Técnico, which would invent a grant, and
      // `resolveUserHierarchyLevel` is circular here -- it reads the very
      // assignment this function would be creating. So instead of
      // silently skipping (the old behaviour), record why: benign if the
      // user already has an active assignment from some other path,
      // otherwise an orphan that needs manual attention.
      const activeAssignments = await getActiveAssignments(db, userAccountId);
      skipped.push({
        userAccountId,
        reason: activeAssignments.length
          ? 'no-access-type-already-assigned'
          : 'orphan-no-access-type-no-assignment',
      });
      continue;
    }
    const organizationId = user.organizationId
      || (Array.isArray(user.organizationIds) ? user.organizationIds[0] : null)
      || null;
    const assignment = await grantRoleForAccessType(db, {
      userAccountId,
      accessType: user.accessType,
      grantedBy: 'system-backfill',
      organizationId,
    });
    granted.push(assignment);
    // #1358: a legacy user in several organizations keeps each of them, one
    // assignment per organization, not only the first.
    if (assignment.scopeType === 'organization' && Array.isArray(user.organizationIds)) {
      for (const extraId of user.organizationIds) {
        if (!extraId || extraId === assignment.scopeId) continue;
        const extra = await grantOrganizationScope(db, { userAccountId, organizationId: extraId, grantedBy: 'system-backfill' });
        if (extra.created) granted.push(extra.assignment);
      }
    }
  }
  return { granted, skipped };
}

/**
 * Revokes `userAccountId`'s active accessType-derived (primary) assignment
 * and grants the one matching the new `accessType` — used when an admin
 * edits a user's accessType (`PUT /api/users/:id`), since enforcement now
 * reads UserRoleAssignment exclusively and a stale active assignment would
 * keep the user's old permissions in effect.
 *
 * #616: only revokes assignments whose roleCode is one of
 * `ROLE_CODE_BY_ACCESS_TYPE`'s values — an additive role (e.g. `auditor`,
 * #429) is left untouched, since it isn't accessType-derived and this
 * caller has no basis to decide it should be dropped just because
 * accessType changed.
 */
async function changeUserRole(db, { userAccountId, accessType, changedBy, organizationId = null }) {
  const assignments = await getCollection(db, 'userRoleAssignments');
  const activeDocs = await getActiveAssignments(db, userAccountId);

  const roles = await getCollection(db, 'roles');
  const primaryRoleCodes = new Set(Object.values(ROLE_CODE_BY_ACCESS_TYPE));
  const roleIds = [...new Set(activeDocs.map((doc) => doc.roleId))];
  const roleDocs = roleIds.length ? await roles.find({ roleId: { $in: roleIds } }).toArray() : [];
  const primaryRoleIds = new Set(
    roleDocs.filter((role) => primaryRoleCodes.has(role.roleCode)).map((role) => role.roleId)
  );
  const docsToRevoke = activeDocs.filter((doc) => primaryRoleIds.has(doc.roleId));

  const now = new Date();
  for (const doc of docsToRevoke) {
    await assignments.updateOne(
      { assignmentId: doc.assignmentId },
      { $set: { assignmentStatus: 'revoked', revokedBy: String(changedBy || 'system'), revokedAt: now, revocationReason: 'role_changed' } }
    );
  }

  const granted = await grantRoleForAccessType(db, { userAccountId, accessType, grantedBy: changedBy, organizationId });

  // #1358: the new role keeps every organization the old one was scoped to,
  // not only `organizationId`. A global (Administrador) grant needs none.
  if (granted.scopeType === 'organization') {
    const otherScopeIds = [...new Set(docsToRevoke
      .filter((doc) => doc.scopeType === 'organization' && doc.scopeId && doc.scopeId !== granted.scopeId)
      .map((doc) => doc.scopeId))];
    for (const scopeId of otherScopeIds) {
      await assignments.insertOne(UserRoleAssignmentModel.create({
        userAccountId: String(userAccountId),
        roleId: granted.roleId,
        scopeType: 'organization',
        scopeId,
        grantedBy: String(changedBy || 'system'),
      }));
    }
  }

  return granted;
}

/**
 * #429: grants an additive role (one with no `accessType` slot, e.g.
 * `auditor`) alongside whatever role(s) `userAccountId` already holds —
 * unlike `grantRoleForAccessType`/`changeUserRole`, this never revokes an
 * existing assignment. Idempotent: an existing active assignment for the
 * same (userAccountId, roleCode) is returned as-is.
 */
async function grantAdditionalRole(db, { userAccountId, roleCode, grantedBy, organizationId = null }) {
  const roles = await getCollection(db, 'roles');
  const roleDoc = await roles.findOne({ roleCode });
  if (!roleDoc) {
    throw new Error(`Role não encontrado para roleCode: ${roleCode} (catálogo RBAC não semeado?)`);
  }

  const assignments = await getCollection(db, 'userRoleAssignments');
  const existing = await assignments.findOne({
    userAccountId: String(userAccountId),
    roleId: roleDoc.roleId,
    assignmentStatus: 'active',
  });
  if (existing) return existing;

  const { scopeType, scopeId } = await resolveScopeForRole(db, roleDoc, organizationId);
  const doc = UserRoleAssignmentModel.create({
    userAccountId: String(userAccountId),
    roleId: roleDoc.roleId,
    scopeType,
    scopeId,
    grantedBy: String(grantedBy || 'system'),
  });
  await assignments.insertOne(doc);
  return doc;
}

/**
 * #429: revokes `userAccountId`'s active assignment(s) for the given
 * additive `roleCode`, if any. No-op (returns an empty array) if the user
 * doesn't currently hold that role.
 */
async function revokeAdditionalRole(db, { userAccountId, roleCode, revokedBy }) {
  const roles = await getCollection(db, 'roles');
  const roleDoc = await roles.findOne({ roleCode });
  if (!roleDoc) return [];

  const assignments = await getCollection(db, 'userRoleAssignments');
  const activeDocs = await getActiveAssignments(db, userAccountId);
  const toRevoke = activeDocs.filter((doc) => doc.roleId === roleDoc.roleId);

  const now = new Date();
  for (const doc of toRevoke) {
    await assignments.updateOne(
      { assignmentId: doc.assignmentId },
      { $set: { assignmentStatus: 'revoked', revokedBy: String(revokedBy || 'system'), revokedAt: now, revocationReason: 'role_changed' } }
    );
  }
  return toRevoke;
}

/**
 * #615: updates the scopeId on userAccountId's active organization-scoped
 * assignment(s) without a revoke/re-grant cycle — for the "organizationId
 * changed, role didn't" case. Deliberately not built on changeUserRole:
 * that revokes ALL active assignments (including an additive `auditor`
 * grant) and only re-grants the primary role, which would silently drop
 * auditor for a pure org edit and write spurious revoked/active audit rows
 * for an assignment that didn't actually change hands. Never touches
 * `global`-scoped (Administrador) assignments.
 */
//
// #1358: given `previousOrganizationId`, only the assignments scoped to it (or
// to no organization) follow the home organization; a scope granted through
// grantOrganizationScope stays. One that would duplicate a scope the role
// already holds in the new organization is revoked instead.
async function updateAssignmentScope(db, { userAccountId, organizationId, previousOrganizationId, updatedBy }) {
  const assignments = await getCollection(db, 'userRoleAssignments');
  const activeDocs = await getActiveAssignments(db, userAccountId);
  const scopeId = await validateOrganizationId(db, organizationId);
  const followsHome = (doc) => previousOrganizationId === undefined
    || doc.scopeId == null
    || doc.scopeId === previousOrganizationId;

  const updatedAssignmentIds = [];
  for (const doc of activeDocs) {
    if (doc.scopeType !== 'organization' || !followsHome(doc)) continue;
    const duplicate = scopeId != null && activeDocs.some((other) => other !== doc
      && other.roleId === doc.roleId && other.scopeType === 'organization' && other.scopeId === scopeId);
    if (duplicate) {
      await assignments.updateOne(
        { assignmentId: doc.assignmentId },
        { $set: { assignmentStatus: 'revoked', revokedBy: String(updatedBy || 'system'), revokedAt: new Date(), revocationReason: 'scope_merged' } }
      );
    } else {
      await assignments.updateOne({ assignmentId: doc.assignmentId }, { $set: { scopeId } });
    }
    updatedAssignmentIds.push(doc.assignmentId);
  }
  return updatedAssignmentIds;
}

function scopeError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * #1358: the user's active primary (accessType-derived) assignments, each
 * with its role. An additive role such as `auditor` is not among them.
 */
async function getPrimaryAssignments(db, userAccountId) {
  const activeDocs = await getActiveAssignments(db, userAccountId);
  if (!activeDocs.length) return [];
  const roles = await getCollection(db, 'roles');
  const roleIds = [...new Set(activeDocs.map((doc) => doc.roleId))];
  const roleDocs = await roles.find({ roleId: { $in: roleIds } }).toArray();
  const roleById = new Map(roleDocs.map((role) => [role.roleId, role]));
  const primaryRoleCodes = new Set(Object.values(ROLE_CODE_BY_ACCESS_TYPE));
  return activeDocs
    .map((doc) => ({ doc, role: roleById.get(doc.roleId) }))
    .filter(({ role }) => role && primaryRoleCodes.has(role.roleCode));
}

/**
 * #1358: the organizations the user's primary role is scoped to, one per
 * active organization-scoped assignment (dict-02 UserRoleAssignment
 * P1X-0225..0237: one row per scope, beside the account's single home
 * organization, UserAccount.organizationId P1X-0187, 0..1).
 */
async function listOrganizationScopes(db, userAccountId) {
  const primary = await getPrimaryAssignments(db, userAccountId);
  const global = primary.some(({ role }) => Number(role.hierarchyLevel) === 4);
  const organizationIds = [...new Set(primary
    .filter(({ doc }) => doc.scopeType === 'organization' && doc.scopeId)
    .map(({ doc }) => doc.scopeId))];
  return { global, organizationIds };
}

/**
 * #1358: scopes the user's primary role to one more organization, as its own
 * assignment. Idempotent: an organization already held returns its
 * assignment with `created: false`. An Administrador is global and gets
 * none; a user with no organization-scoped primary role has none to extend.
 */
async function grantOrganizationScope(db, { userAccountId, organizationId, grantedBy }) {
  const scopeId = await validateOrganizationId(db, organizationId);
  if (!scopeId) throw scopeError('organizationId é obrigatório', 422);

  const primary = await getPrimaryAssignments(db, userAccountId);
  if (primary.some(({ role }) => Number(role.hierarchyLevel) === 4)) {
    throw scopeError('Administrador tem escopo global e não recebe organização adicional', 409);
  }
  const scoped = primary.filter(({ doc }) => doc.scopeType === 'organization');
  if (!scoped.length) {
    throw scopeError('Usuário sem papel com escopo de organização', 409);
  }
  const held = scoped.find(({ doc }) => doc.scopeId === scopeId);
  if (held) return { assignment: held.doc, created: false };

  const doc = UserRoleAssignmentModel.create({
    userAccountId: String(userAccountId),
    roleId: scoped[0].doc.roleId,
    scopeType: 'organization',
    scopeId,
    grantedBy: String(grantedBy || 'system'),
  });
  await (await getCollection(db, 'userRoleAssignments')).insertOne(doc);
  return { assignment: doc, created: true };
}

/**
 * #1358: revokes the user's primary-role assignments scoped to
 * `organizationId`. Refuses the last one, which would leave the user with no
 * organization (a hard 403 on every scoped route). Returns the revoked
 * assignments, none when the organization was not held.
 */
async function revokeOrganizationScope(db, { userAccountId, organizationId, revokedBy }) {
  const primary = await getPrimaryAssignments(db, userAccountId);
  const scoped = primary.filter(({ doc }) => doc.scopeType === 'organization' && doc.scopeId);
  const toRevoke = scoped.filter(({ doc }) => doc.scopeId === String(organizationId));
  if (!toRevoke.length) return [];
  if (toRevoke.length === scoped.length) {
    throw scopeError('A última organização do usuário não pode ser removida', 409);
  }

  const assignments = await getCollection(db, 'userRoleAssignments');
  const now = new Date();
  for (const { doc } of toRevoke) {
    await assignments.updateOne(
      { assignmentId: doc.assignmentId },
      { $set: { assignmentStatus: 'revoked', revokedBy: String(revokedBy || 'system'), revokedAt: now, revocationReason: 'scope_removed' } }
    );
  }
  return toRevoke.map(({ doc }) => doc);
}

/**
 * #615: the resolver #340/#341's org-scope enforcement consumes. Returns
 * `{ scope, organizationIds }`:
 * - 'global' — userAccountId holds an active hierarchyLevel-4 (Administrador)
 *   assignment: bypass, sees every organization, organizationIds is ignored.
 * - 'organization' — scoped to the distinct non-null scopeIds across active
 *   scopeType:'organization' assignments.
 * - 'unassigned' — has an active organization-scoped assignment but every
 *   scopeId on it is null (no org ever assigned, or cleared back to null).
 * - 'none' — no active assignments at all.
 * Callers should hard-fail (403 "no organization assigned") on anything
 * other than 'global'/'organization'.
 */
async function resolveUserOrganizationScope(db, userAccountId) {
  const assignmentDocs = await getActiveAssignments(db, userAccountId);
  if (!assignmentDocs.length) return { scope: 'none', organizationIds: [] };

  const roles = await getCollection(db, 'roles');
  const roleIds = [...new Set(assignmentDocs.map((doc) => doc.roleId))];
  const roleDocs = await roles.find({ roleId: { $in: roleIds } }).toArray();
  const roleById = new Map(roleDocs.map((role) => [role.roleId, role]));

  const hasBypassRole = assignmentDocs.some((doc) => {
    const role = roleById.get(doc.roleId);
    return role && Number(role.hierarchyLevel) === 4;
  });
  if (hasBypassRole) return { scope: 'global', organizationIds: [] };

  const orgAssignments = assignmentDocs.filter((doc) => doc.scopeType === 'organization');
  if (!orgAssignments.length) return { scope: 'none', organizationIds: [] };

  const organizationIds = [...new Set(orgAssignments.map((doc) => doc.scopeId).filter(Boolean))];
  if (!organizationIds.length) return { scope: 'unassigned', organizationIds: [] };

  return { scope: 'organization', organizationIds };
}

/**
 * #340: true when scopeResult (from resolveUserOrganizationScope) lets the
 * caller proceed at all. 'none'/'unassigned' must become a hard 403 ("no
 * organization assigned") per the product decision confirmed 2026-08-18 —
 * callers check this before querying/filtering anything.
 */
function isOrganizationScopeUsable(scopeResult) {
  return scopeResult.scope === 'global' || scopeResult.scope === 'organization';
}

/**
 * #340: merges scopeResult into a Mongo list query, restricting fieldName
 * (e.g. Sample.collectionSite, Patient.clinicalUnitId) to the caller's
 * scoped organizations. No-op for 'global' scope (Administrador bypass —
 * every organization is visible). Caller must have already rejected an
 * unusable scope via isOrganizationScopeUsable.
 */
function applyOrganizationScopeFilter(query, scopeResult, fieldName) {
  if (scopeResult.scope === 'organization') {
    query[fieldName] = { $in: scopeResult.organizationIds };
  }
  return query;
}

/**
 * #340: true when an already-fetched record's organization reference field
 * is within scopeResult's allowed organizations (or scope is 'global').
 * For detail/get-by-id endpoints, which check post-fetch rather than filter
 * a query — an out-of-scope existing record 403s rather than 404s, matching
 * sample-file.controller.js's existing precedent. A record with no value in
 * fieldName (never assigned an organization) is out of scope for anyone
 * who isn't 'global'.
 *
 * #637: fieldName can also be an array field (e.g. Report.organizationIds —
 * a single report can span multiple scoped organizations, unlike every
 * other entity's single-org field) — checked as an overlap against
 * scopeResult.organizationIds rather than membership of a scalar. An empty
 * array (unstamped/legacy) behaves the same as a missing scalar: out of
 * scope for anyone who isn't 'global'.
 */
function isRecordInOrganizationScope(record, scopeResult, fieldName) {
  if (scopeResult.scope === 'global') return true;
  const value = record && record[fieldName];
  if (Array.isArray(value)) {
    return value.some((v) => scopeResult.organizationIds.includes(v));
  }
  return Boolean(value) && scopeResult.organizationIds.includes(value);
}

/**
 * #1071 (RF008 AC#7): decides which organizationId a CREATE stamps.
 *
 * `requireOrganizationScope` resolves the caller's scope and refuses an
 * org-less caller. It does not decide what a new record belongs to, and
 * nothing validated a client-supplied organizationId against the caller's
 * scope -- `assertOrganizationIdResolves` only asserts the Organization
 * EXISTS, so naming a real organization you do not belong to passed it and
 * created a record already outside your own reach.
 *
 * The rule, by scope:
 *
 *   global        Administrador. Unconstrained -- the body's value stands,
 *                 or null. An administrator legitimately provisions for any
 *                 organization, and this is the same treatment #637 already
 *                 ships for Report.organizationIds (reports.routes.js maps
 *                 a global scope to [] rather than refusing).
 *   organization  exactly one id -- stamp it, ignore the body entirely.
 *                 The body is caller-controlled and the scope is not.
 *   organization  several ids -- the body must name one of them. Refusing
 *                 to guess is the only safe option, and picking [0] would
 *                 silently mis-file the record.
 *
 * The multi-id branch is currently UNREACHABLE through any route or script
 * in this repo: every writer of a UserRoleAssignment scope funnels through a
 * single scalar (registerUser, createFirstAdmin, user.routes.js's
 * changeUserRole + grantAdditionalRole pair, and both backfills), and
 * updateAssignmentScope converges every active org assignment onto one
 * value. It is implemented rather than thrown away because
 * resolveUserOrganizationScope's contract returns a list, and the branch
 * that guesses is the one that would be wrong.
 *
 * Callers with NO resolved scope (the machine-ingest route, which has no
 * user) must not call this -- see temperature.controller.
 */
function resolveOrganizationIdForCreate(organizationScope, requestedOrganizationId) {
  const requested = requestedOrganizationId === undefined || requestedOrganizationId === ''
    ? null
    : requestedOrganizationId;

  if (!organizationScope) {
    // Fail CLOSED. A missing scope means requireOrganizationScope is not on
    // the route, and falling back to the body here would silently restore
    // the exact trust this function exists to remove. The one create with
    // no caller scope -- POST /temperature/system/reading, machine ingest --
    // does not call this at all; its controller branches first.
    const error = new Error('Escopo organizacional não resolvido para esta criação');
    error.statusCode = 403;
    throw error;
  }

  if (organizationScope.scope === 'global') {
    return requested;
  }

  const ids = organizationScope.organizationIds || [];
  if (ids.length === 1) {
    return ids[0];
  }

  if (ids.length > 1) {
    if (requested !== null && ids.includes(String(requested))) {
      return String(requested);
    }
    const error = new Error(
      'Informe organizationId: a sua conta pertence a mais de uma organização.'
    );
    error.statusCode = 400;
    throw error;
  }

  // 'none'/'unassigned' -- requireOrganizationScope refuses these upstream,
  // so reaching here means the middleware is missing from the route.
  const error = new Error('Sem organização atribuída');
  error.statusCode = 403;
  throw error;
}

/**
 * #1053: the UPDATE-side twin of resolveOrganizationIdForCreate.
 *
 * #1029 made a sensor update check that the target is in the caller's scope
 * — the SOURCE. It does not check the DESTINATION, and the module's own
 * update allowlist contains the very field it scopes on, so an in-scope
 * caller could set it to another organization and push their own record out
 * of their reach. #1071's helper does not reach this: it is wired into
 * create paths only, because on a create there is no prior owner to compare
 * against.
 *
 * The rule is deliberately narrower than the create side. A create CHOOSES
 * an organization; an update MOVES a record between them, which is a
 * different act:
 *
 *   global        Administrador. May move a record — unconstrained, matching
 *                 the create side and #637's treatment of a global scope.
 *   organization  the incoming value must be absent, or equal to what the
 *                 record already has. Anything else is a push-out and is
 *                 refused with 403 rather than silently dropped, because a
 *                 caller who asked to move a record should be told they may
 *                 not, not told it worked.
 *
 * Silently stripping the field was the alternative and is worse: it makes a
 * refused move indistinguishable from a successful no-op in the response.
 */
function assertOrganizationFieldNotReparented(organizationScope, existingValue, requestedValue, fieldName = 'organizationId') {
  if (requestedValue === undefined) return;
  if (!organizationScope) {
    // #1183: fail CLOSED, like resolveOrganizationIdForCreate above. Every
    // real caller, global included, carries a scope object, so a missing one
    // means requireOrganizationScope is not on the route -- and returning
    // here made this check a silent no-op on exactly that mis-wiring.
    const error = new Error('Escopo organizacional não resolvido para esta atualização');
    error.statusCode = 403;
    throw error;
  }
  if (organizationScope.scope === 'global') return;

  const current = existingValue === undefined || existingValue === null ? null : String(existingValue);
  const requested = requestedValue === null || requestedValue === '' ? null : String(requestedValue);
  if (current === requested) return;

  const error = new Error(`Não é permitido alterar ${fieldName} para outra organização`);
  error.statusCode = 403;
  throw error;
}

module.exports = {
  assertOrganizationFieldNotReparented,
  resolveOrganizationIdForCreate,
  ROLE_CODE_BY_ACCESS_TYPE,
  getActiveAssignments,
  getActiveRoles,
  resolveUserHierarchyLevel,
  userHasPermission,
  getActiveRoleCodes,
  isAdministrator,
  isAuditReader,
  resolveRoleDisplayName,
  findUserAccountIdsByRoleCodes,
  grantRoleForAccessType,
  assertGrantPreconditions,
  changeUserRole,
  backfillUserRoleAssignments,
  grantAdditionalRole,
  revokeAdditionalRole,
  updateAssignmentScope,
  listOrganizationScopes,
  grantOrganizationScope,
  revokeOrganizationScope,
  resolveUserOrganizationScope,
  isOrganizationScopeUsable,
  applyOrganizationScopeFilter,
  isRecordInOrganizationScope,
};
