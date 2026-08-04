// dict-02 P1X-0209..0216 (#420): additive RBAC catalog entity. Seeded from
// roles.min.json's 4 hardcoded roles — does not replace accessType/roleName
// as enforcement authority yet (see #386/#421 for the atomic cutover).
const { randomUUID } = require('crypto');

const ROLE_STATUSES = ['active', 'inactive', 'deprecated'];

class RoleModel {
  static fieldsOf(data = {}) {
    return {
      roleId: String(data.roleId || randomUUID()).trim(),
      roleCode: String(data.roleCode || '').trim(),
      displayName: data.displayName ?? null,
      description: data.description ?? null,
      hierarchyLevel: data.hierarchyLevel ?? null,
      permissionIds: Array.isArray(data.permissionIds) ? data.permissionIds : [],
      roleStatus: data.roleStatus ?? 'active',
      effectivePeriod: data.effectivePeriod ?? null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.roleCode) {
      throw new Error('roleCode é obrigatório para Role');
    }
    if (!fields.permissionIds.length) {
      throw new Error('permissionIds deve conter ao menos um item para Role');
    }
    if (!ROLE_STATUSES.includes(fields.roleStatus)) {
      throw new Error(`roleStatus inválido: ${fields.roleStatus}`);
    }
    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = RoleModel;
module.exports.ROLE_STATUSES = ROLE_STATUSES;
