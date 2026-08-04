// dict-02 P1X-0217..0224 (#420): additive RBAC catalog entity, referenced by
// Role.permissionIds. See Role.js for the same scope-boundary note.
const { randomUUID } = require('crypto');

const PERMISSION_STATUSES = ['active', 'inactive', 'deprecated'];
const ALLOWED_ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE', 'EXPORT', 'APPROVE', 'RELEASE'];

class PermissionModel {
  static fieldsOf(data = {}) {
    return {
      permissionId: String(data.permissionId || randomUUID()).trim(),
      permissionCode: String(data.permissionCode || '').trim(),
      displayName: data.displayName ?? null,
      description: data.description ?? null,
      resourceType: data.resourceType ?? null,
      allowedActions: Array.isArray(data.allowedActions) ? data.allowedActions : [],
      conditionExpression: data.conditionExpression ?? null,
      permissionStatus: data.permissionStatus ?? 'active',
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.permissionCode) {
      throw new Error('permissionCode é obrigatório para Permission');
    }
    if (!fields.resourceType) {
      throw new Error('resourceType é obrigatório para Permission');
    }
    if (!fields.allowedActions.length) {
      throw new Error('allowedActions deve conter ao menos um item para Permission');
    }
    for (const action of fields.allowedActions) {
      if (!ALLOWED_ACTIONS.includes(action)) {
        throw new Error(`allowedActions contém ação inválida: ${action}`);
      }
    }
    if (!PERMISSION_STATUSES.includes(fields.permissionStatus)) {
      throw new Error(`permissionStatus inválido: ${fields.permissionStatus}`);
    }
    const now = new Date();
    return { ...fields, createdAt: now, updatedAt: now };
  }
}

module.exports = PermissionModel;
module.exports.PERMISSION_STATUSES = PERMISSION_STATUSES;
module.exports.ALLOWED_ACTIONS = ALLOWED_ACTIONS;
