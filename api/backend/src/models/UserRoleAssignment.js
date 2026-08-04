// dict-02 P1X-0225..0237 (#420): additive RBAC association entity, linking
// a UserAccount to a Role with optional scope. Not seeded by this slice
// (roles.min.json has no per-user assignment data) — collection is reserved
// for #421's cutover, which will populate it from existing User.accessType.
const { randomUUID } = require('crypto');

const SCOPE_TYPES = ['global', 'organization', 'biobank', 'collection', 'study', 'resource'];
const ASSIGNMENT_STATUSES = ['active', 'expired', 'revoked', 'suspended'];

class UserRoleAssignmentModel {
  static fieldsOf(data = {}) {
    return {
      assignmentId: String(data.assignmentId || randomUUID()).trim(),
      userAccountId: String(data.userAccountId || '').trim(),
      roleId: String(data.roleId || '').trim(),
      scopeType: data.scopeType ?? null,
      scopeId: data.scopeId ?? null,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
      assignmentStatus: data.assignmentStatus ?? 'active',
      grantedBy: String(data.grantedBy || '').trim(),
      grantedAt: data.grantedAt ? new Date(data.grantedAt) : null,
      revokedBy: data.revokedBy ?? null,
      revokedAt: data.revokedAt ? new Date(data.revokedAt) : null,
      revocationReason: data.revocationReason ?? null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.userAccountId) {
      throw new Error('userAccountId é obrigatório para UserRoleAssignment');
    }
    if (!fields.roleId) {
      throw new Error('roleId é obrigatório para UserRoleAssignment');
    }
    if (fields.scopeType && !SCOPE_TYPES.includes(fields.scopeType)) {
      throw new Error(`scopeType inválido: ${fields.scopeType}`);
    }
    if (!ASSIGNMENT_STATUSES.includes(fields.assignmentStatus)) {
      throw new Error(`assignmentStatus inválido: ${fields.assignmentStatus}`);
    }
    if (!fields.grantedBy) {
      throw new Error('grantedBy é obrigatório para UserRoleAssignment');
    }
    const now = new Date();
    return { ...fields, grantedAt: fields.grantedAt || now, validFrom: fields.validFrom || now };
  }
}

module.exports = UserRoleAssignmentModel;
module.exports.SCOPE_TYPES = SCOPE_TYPES;
module.exports.ASSIGNMENT_STATUSES = ASSIGNMENT_STATUSES;
