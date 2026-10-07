/**
 * Modelo de validação e estrutura para Access
 * Baseado no Diagrama de Classes
 */
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

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // #1202: dict v2.0.0 AccessGrant (P1X-0238..0250) names this model as its
  // predecessor. The canonical fields that need no invented mapping are
  // written here; reportType/accessType are its declared *Legacy extensions.
  // grantedBy is the authenticated caller, never taken from the body.
  static create(data, { grantedBy = null } = {}) {
    return {
      accessID: data.accessID || null,
      reportID: data.reportID,
      reportType: data.reportType,
      accessType: data.accessType || 1, // Default: Visualizador
      userId: data.userId || null,
      resourceType: 'report',
      resourceId: data.reportID,
      grantedBy,
      grantStatus: 'active',
      grantedAt: data.grantedAt || new Date(),
      expiresAt: data.expiresAt || null,
      revokedAt: null,
      revocationReason: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
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

