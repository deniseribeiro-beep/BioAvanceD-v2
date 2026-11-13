/**
 * Modelo de validação e estrutura para PatientConsent
 */
const crypto = require('crypto');

class PatientConsentModel {
  static validate(data) {
    const errors = [];

    if (!data.participantId || typeof data.participantId !== 'string') {
      errors.push('participantId é obrigatório e deve ser string');
    }

    if (!data.consentTemplateId || typeof data.consentTemplateId !== 'string') {
      errors.push('consentTemplateId é obrigatório e deve ser string');
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

    if (data.signatureName && typeof data.signatureName !== 'string') {
      errors.push('signatureName deve ser string');
    }

    if (data.signatureImageBase64 && typeof data.signatureImageBase64 !== 'string') {
      errors.push('signatureImageBase64 deve ser string');
    }

    if (data.signatureMimeType && typeof data.signatureMimeType !== 'string') {
      errors.push('signatureMimeType deve ser string');
    }

    if (data.signatureHash && typeof data.signatureHash !== 'string') {
      errors.push('signatureHash deve ser string');
    }

    if (data.studyId !== undefined && data.studyId !== null && typeof data.studyId !== 'string') {
      errors.push('studyId deve ser string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      consentId: data.consentId || crypto.randomUUID(),
      participantId: data.participantId,
      consentTemplateId: data.consentTemplateId,
      // #827: dict-02 ELM-0091 and the evidence trio ELM-0105/0106, P1X-0373
      consentVersion: data.consentVersion || null,
      consentModel: data.consentModel || null,
      evidenceDocumentUri: data.evidenceDocumentUri || null,
      evidenceHash: data.evidenceHash || null,
      evidenceMimeType: data.evidenceMimeType || null,
      evidenceEncryption: data.evidenceEncryption || null,
      signedTcleDocumentUri: data.signedTcleDocumentUri || null,
      signedTcleHash: data.signedTcleHash || null,
      signedTcleEncryption: data.signedTcleEncryption || null,
      signedAt: data.signedAt ? new Date(data.signedAt) : new Date(),
      status: data.status || 'ACTIVE',
      revokedAt: data.revokedAt ? new Date(data.revokedAt) : null,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      signatureName: data.signatureName || null,
      signatureImageBase64: data.signatureImageBase64 || null,
      signatureMimeType: data.signatureMimeType || null,
      signatureHash: data.signatureHash || null,
      responses: data.responses || {},
      studyId: data.studyId || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = PatientConsentModel;
