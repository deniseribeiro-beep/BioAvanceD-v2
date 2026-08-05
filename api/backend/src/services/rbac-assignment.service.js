const { getCollection } = require('../utils/collectionResolver');
const UserRoleAssignmentModel = require('../models/UserRoleAssignment');

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
 * Grants the legacy role matching `accessType` to `userAccountId`, upserting
 * by (userAccountId, roleId) so calling this more than once for the same
 * user/role is a no-op — required for the backfill script to be idempotent
 * and safe to also call from every user-creation path.
 */
async function grantRoleForAccessType(db, { userAccountId, accessType, grantedBy }) {
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
  if (existing) return existing;

  const doc = UserRoleAssignmentModel.create({
    userAccountId: String(userAccountId),
    roleId: roleDoc.roleId,
    scopeType: 'global',
    grantedBy: String(grantedBy || 'system'),
  });
  await assignments.insertOne(doc);
  return doc;
}

/**
 * One-time idempotent backfill: grants every existing `users` document its
 * UserRoleAssignment from its current accessType, since UserRoleAssignment
 * didn't exist before #420 and roles.min.json has no per-user data.
 */
async function backfillUserRoleAssignments(db) {
  const users = db.collection('users');
  const userDocs = await users.find({}).toArray();

  const results = [];
  for (const user of userDocs) {
    if (!user.accessType) continue;
    const assignment = await grantRoleForAccessType(db, {
      userAccountId: user._id.toString(),
      accessType: user.accessType,
      grantedBy: 'system-backfill',
    });
    results.push(assignment);
  }
  return results;
}

/**
 * Revokes every current active assignment for `userAccountId` and grants the
 * one matching `accessType` — used when an admin edits a user's accessType
 * (`PUT /api/users/:id`), since enforcement now reads UserRoleAssignment
 * exclusively and a stale active assignment would keep the user's old
 * permissions in effect.
 */
async function changeUserRole(db, { userAccountId, accessType, changedBy }) {
  const assignments = await getCollection(db, 'userRoleAssignments');
  const activeDocs = await getActiveAssignments(db, userAccountId);

  const now = new Date();
  for (const doc of activeDocs) {
    await assignments.updateOne(
      { assignmentId: doc.assignmentId },
      { $set: { assignmentStatus: 'revoked', revokedBy: String(changedBy || 'system'), revokedAt: now, revocationReason: 'role_changed' } }
    );
  }

  return grantRoleForAccessType(db, { userAccountId, accessType, grantedBy: changedBy });
}

module.exports = {
  ROLE_CODE_BY_ACCESS_TYPE,
  getActiveAssignments,
  getActiveRoles,
  resolveUserHierarchyLevel,
  userHasPermission,
  grantRoleForAccessType,
  changeUserRole,
  backfillUserRoleAssignments,
};
