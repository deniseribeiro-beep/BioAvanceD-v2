const crypto = require('crypto');

/**
 * Modelo de validação e estrutura para Access
 * Baseado no Diagrama de Classes
 *
 * Stored `access` documents use the dict-02 AccessGrant names (P1X-0238..0250).
 * RENAMED maps each canonical name to the name documents carried before it.
 * New documents and every write use the canonical names only; a reader goes
 * through the accessors below, which fall back to the legacy name.
 *
 * The API keeps the old names: request bodies may still send `userId` and
 * `accessID`, and responses leave under them (apiViewOf).
 */
const RENAMED = Object.freeze({
  accessGrantId: 'accessID',
  userAccountId: 'userId'
});

// #1201: P1X-0243 permissionCodes is 1..* Core. A report grant authorizes
// reading the report, which is what viewReports names in the RBAC catalog.
const DEFAULT_PERMISSION_CODES = Object.freeze(['viewReports']);

function knownPermissionCodes() {
  const { PERMISSION_CATALOG } = require('../services/rbac-catalog-seed.service');
  return PERMISSION_CATALOG;
}

class AccessModel {
  static validate(data) {
    const errors = [];

    if (!data.reportID && data.reportID !== 0) {
      errors.push('reportID é obrigatório');
    }

    if (!data.reportType || typeof data.reportType !== 'string') {
      errors.push('reportType é obrigatório e deve ser string');
    }

    if (data.accessType && !this.isValidAccessType(data.accessType)) {
      errors.push('accessType inválido');
    }

    if (data.permissionCodes !== undefined && !this.isValidPermissionCodes(data.permissionCodes)) {
      errors.push('permissionCodes deve ser uma lista não vazia de códigos de permissão conhecidos');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // #1202: dict v2.0.0 AccessGrant (P1X-0238..0250) names this model as its
  // predecessor. reportType/accessType are its declared *Legacy extensions
  // (P1X-0242, P1X-0244). grantedBy is the authenticated caller, never taken
  // from the body.
  //
  // #1201: `data` is a request body, so the beneficiary arrives as
  // userAccountId or the API's userId, and a caller-chosen id as
  // accessGrantId or the API's accessID. Pass this to compare the document
  // with dict-02 AccessGrant.
  static fieldsOf(data = {}, { grantedBy = null } = {}) {
    return {
      accessGrantId: data.accessGrantId || data.accessID || null,
      reportID: data.reportID,
      reportType: data.reportType,
      accessType: data.accessType || 1, // Default: Visualizador
      userAccountId: (data.userAccountId ?? data.userId) || null,
      resourceType: 'report',
      resourceId: data.reportID,
      permissionCodes: this.isValidPermissionCodes(data.permissionCodes)
        ? [...data.permissionCodes]
        : [...DEFAULT_PERMISSION_CODES],
      grantedBy,
      grantStatus: 'active',
      grantedAt: data.grantedAt || null,
      expiresAt: data.expiresAt || null,
      revokedAt: null,
      revocationReason: null,
      createdAt: null,
      updatedAt: null
    };
  }

  static create(data, { grantedBy = null } = {}) {
    const fields = this.fieldsOf(data, { grantedBy });
    return {
      ...fields,
      accessGrantId: fields.accessGrantId || crypto.randomUUID(),
      grantedAt: fields.grantedAt || new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  // A renamed field of a stored grant, canonical name first, then the legacy
  // one. Only an absent canonical name (undefined) falls back.
  static storedValueOf(grant, field) {
    if (!grant) return undefined;
    return grant[field] !== undefined ? grant[field] : grant[RENAMED[field]];
  }

  static accessGrantIdOf(grant) {
    return AccessModel.storedValueOf(grant, 'accessGrantId');
  }

  static userAccountIdOf(grant) {
    return AccessModel.storedValueOf(grant, 'userAccountId');
  }

  // A stored grant under the API's names: each canonical field is returned
  // under its legacy name (the canonical value wins when a document carries
  // both), and the canonical name is removed.
  static apiViewOf(grant) {
    if (!grant || typeof grant !== 'object') return grant;
    const view = { ...grant };
    for (const [canonical, legacy] of Object.entries(RENAMED)) {
      if (view[canonical] !== undefined) view[legacy] = view[canonical];
      delete view[canonical];
    }
    return view;
  }

  static isValidPermissionCodes(codes) {
    if (!Array.isArray(codes) || codes.length === 0) return false;
    const catalog = knownPermissionCodes();
    return codes.every((code) => typeof code === 'string' && Object.prototype.hasOwnProperty.call(catalog, code));
  }

  static isValidAccessType(accessType) {
    return [1, 2, 3, 4].includes(accessType);
  }

  static validateAccessType(description) {
    const accessTypes = {
      'Visualizador': 1,
      'Operador': 2,
      'Coordenador': 3,
      'Administrador': 4
    };
    return accessTypes[description] || null;
  }
}

module.exports = AccessModel;
module.exports.RENAMED = RENAMED;
module.exports.DEFAULT_PERMISSION_CODES = DEFAULT_PERMISSION_CODES;
