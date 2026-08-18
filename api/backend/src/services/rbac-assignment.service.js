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
 * #615: resolves the scopeType/scopeId a new assignment should carry —
 * Administrador (hierarchyLevel 4) is the only bypass role and always gets
 * `global`; every other role (including additive ones like `auditor`, whose
 * roleDoc has no hierarchyLevel) is scoped to the given organizationId. The
 * single place this rule lives, so grant paths can't drift from each other.
 */
function resolveScopeForRole(roleDoc, organizationId) {
  if (Number(roleDoc.hierarchyLevel) === 4) {
    return { scopeType: 'global', scopeId: null };
  }
  const scopeId = organizationId == null ? null : (String(organizationId).trim() || null);
  return { scopeType: 'organization', scopeId };
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

  const { scopeType, scopeId } = resolveScopeForRole(roleDoc, organizationId);
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

  const results = [];
  for (const user of userDocs) {
    if (!user.accessType) continue;
    const organizationId = user.organizationId
      || (Array.isArray(user.organizationIds) ? user.organizationIds[0] : null)
      || null;
    const assignment = await grantRoleForAccessType(db, {
      userAccountId: user._id.toString(),
      accessType: user.accessType,
      grantedBy: 'system-backfill',
      organizationId,
    });
    results.push(assignment);
  }
  return results;
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

  return grantRoleForAccessType(db, { userAccountId, accessType, grantedBy: changedBy, organizationId });
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

  const { scopeType, scopeId } = resolveScopeForRole(roleDoc, organizationId);
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
async function updateAssignmentScope(db, { userAccountId, organizationId }) {
  const assignments = await getCollection(db, 'userRoleAssignments');
  const activeDocs = await getActiveAssignments(db, userAccountId);
  const scopeId = organizationId == null ? null : (String(organizationId).trim() || null);

  const updatedAssignmentIds = [];
  for (const doc of activeDocs) {
    if (doc.scopeType !== 'organization') continue;
    await assignments.updateOne({ assignmentId: doc.assignmentId }, { $set: { scopeId } });
    updatedAssignmentIds.push(doc.assignmentId);
  }
  return updatedAssignmentIds;
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
 */
function isRecordInOrganizationScope(record, scopeResult, fieldName) {
  if (scopeResult.scope === 'global') return true;
  const value = record && record[fieldName];
  return Boolean(value) && scopeResult.organizationIds.includes(value);
}

module.exports = {
  ROLE_CODE_BY_ACCESS_TYPE,
  getActiveAssignments,
  getActiveRoles,
  resolveUserHierarchyLevel,
  userHasPermission,
  getActiveRoleCodes,
  isAdministrator,
  resolveRoleDisplayName,
  findUserAccountIdsByRoleCodes,
  grantRoleForAccessType,
  changeUserRole,
  backfillUserRoleAssignments,
  grantAdditionalRole,
  revokeAdditionalRole,
  updateAssignmentScope,
  resolveUserOrganizationScope,
  isOrganizationScopeUsable,
  applyOrganizationScopeFilter,
  isRecordInOrganizationScope,
};
