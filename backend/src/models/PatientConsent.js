/**
 * Modelo de validação e estrutura para PatientConsent
 */
class PatientConsentModel {
  static validate(data) {
    const errors = [];

    if (!data.patientId || typeof data.patientId !== 'string') {
      errors.push('patientId é obrigatório e deve ser string');
    }

    if (!data.templateId || typeof data.templateId !== 'string') {
      errors.push('templateId é obrigatório e deve ser string');
    }

    if (data.status && !['ACTIVE', 'REVOKED'].includes(data.status)) {
      errors.push('status deve ser ACTIVE ou REVOKED');
    }

    if (!data.responses || typeof data.responses !== 'object' || Array.isArray(data.responses)) {
      errors.push('responses é obrigatório e deve ser um objeto');
    }

    if (data.ipAddress && typeof data.ipAddress !== 'string') {
      errors.push('ipAddress deve ser string');
    }

    if (data.userAgent && typeof data.userAgent !== 'string') {
      errors.push('userAgent deve ser string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      patientId: data.patientId,
      templateId: data.templateId,
      signedAt: data.signedAt ? new Date(data.signedAt) : new Date(),
      status: data.status || 'ACTIVE',
      revokedAt: data.revokedAt ? new Date(data.revokedAt) : null,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      responses: data.responses || {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = PatientConsentModel;
