class ParticipantModel {
  static isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
  }

  static normalizePhone(phone) {
    if (phone === undefined || phone === null) return null;
    const digits = String(phone).replace(/\D/g, '').trim();
    if (!digits) return null;
    if (digits.length < 10 || digits.length > 15) return null;
    return digits;
  }

  static validate(data = {}) {
    const errors = [];
    const requiredText = ['participantId', 'sex', 'consentTemplateId'];
    for (const field of requiredText) {
      if (!data[field] || typeof data[field] !== 'string' || String(data[field]).trim() === '') {
        errors.push(`${field} é obrigatório`);
      }
    }
    // RF005/RNF007 (#575): patientName/birthDate/identityDocument are civil
    // identity — they live only on ParticipantIdentity, never on Patient.
    const allowed = new Set([
      'participantId','sex','email','phone','recordNumber','clinicalUnitId','clinicalUnit','unitAcronym','isDeceased','representativeName','representativeEmail','representativeIdentityDocument','representativePhone','consentTemplateId','status','consentToken','consentTokenCreatedAt','consentTokenExpiresAt','consentNotifiedAt','consentAcceptedAt','createdAt','updatedAt','anamneseGeral','dadosEspecificos'
    ]);
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) errors.push(`Campo não canônico: ${key}`);
    }
    if (data.email && !this.isValidEmail(data.email)) errors.push('email inválido');
    if (data.representativeEmail && !this.isValidEmail(data.representativeEmail)) errors.push('representativeEmail inválido');
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    // RF005/RNF007 (#575): patientName/birthDate/identityDocument are civil
    // identity — they live only on ParticipantIdentity, never on Patient.
    const allowed = new Set([
      'participantId','sex','email','phone','recordNumber','clinicalUnitId','clinicalUnit','unitAcronym','isDeceased','representativeName','representativeEmail','representativeIdentityDocument','representativePhone','consentTemplateId','status','consentToken','consentTokenCreatedAt','consentTokenExpiresAt','consentNotifiedAt','consentAcceptedAt','createdAt','updatedAt','anamneseGeral','dadosEspecificos'
    ]);
    const unexpectedFields = Object.keys(data).filter((key) => !allowed.has(key));
    if (unexpectedFields.length > 0) {
      const error = new Error('Payload contém campos não canônicos');
      error.statusCode = 422;
      error.code = 'NON_CANONICAL_FIELD';
      error.fields = unexpectedFields;
      throw error;
    }

    const normalized = {
      participantId: String(data.participantId || '').trim(),
      sex: String(data.sex || '').trim(),
      email: data.email ? String(data.email).trim().toLowerCase() : null,
      phone: this.normalizePhone(data.phone),
      recordNumber: data.recordNumber ? String(data.recordNumber).trim() : null,
      clinicalUnitId: data.clinicalUnitId || null,
      clinicalUnit: data.clinicalUnit || null,
      unitAcronym: data.unitAcronym || null,
      isDeceased: Boolean(data.isDeceased),
      representativeName: data.representativeName || null,
      representativeEmail: data.representativeEmail ? String(data.representativeEmail).trim().toLowerCase() : null,
      representativeIdentityDocument: data.representativeIdentityDocument || null,
      representativePhone: this.normalizePhone(data.representativePhone),
      consentTemplateId: data.consentTemplateId || null,
      status: data.status || 'PENDING_CONSENT',
      consentToken: data.consentToken || null,
      consentTokenCreatedAt: data.consentTokenCreatedAt ? new Date(data.consentTokenCreatedAt) : null,
      consentTokenExpiresAt: data.consentTokenExpiresAt ? new Date(data.consentTokenExpiresAt) : null,
      consentNotifiedAt: data.consentNotifiedAt ? new Date(data.consentNotifiedAt) : null,
      consentAcceptedAt: data.consentAcceptedAt ? new Date(data.consentAcceptedAt) : null,
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
      updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
      anamneseGeral: data.anamneseGeral || null,
      dadosEspecificos: data.dadosEspecificos || []
    };
    const validation = this.validate(normalized);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }
    return normalized;
  }

  static validateUnit(clinicalUnit) {
    return Boolean(clinicalUnit) && typeof clinicalUnit === 'string' && clinicalUnit.length > 0;
  }

  static fillAcronym(clinicalUnit) {
    if (!clinicalUnit) return null;

    const stopWords = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'OF', 'THE', 'DEL', 'LA', 'EL', 'Y']);
    const normalized = String(clinicalUnit)
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();

    if (!normalized) return null;

    const words = normalized.split(/\s+/).filter(Boolean);
    const relevantWords = words.filter((word) => !stopWords.has(word));
    const source = relevantWords.length > 0 ? relevantWords : words;

    const initials = source.map((word) => word[0]).join('').slice(0, 6);
    return initials || null;
  }
}

module.exports = ParticipantModel;
