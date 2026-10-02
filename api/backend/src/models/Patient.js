// RF005/RNF007 (#575): patientName/birthDate/identityDocument are civil
// identity — they live only on ParticipantIdentity, never on Patient.
// Single source of truth for Patient's canonical field shape (#345 — was
// previously duplicated identically between validate() and create(), plus
// a third, payload-level copy in paciente.controller.js#rejectCanonicalAliases
// that now builds its own allow-list off this same list).
// #1166 slice 4: 'email' and 'phone' stay on this list as accepted, validated
// INPUT only. create() no longer emits them: the contact is written to
// ParticipantIdentity alone (dict-02 P1X-0352/P1X-0353). #1168: likewise the
// four representative* fields (dict-02 P1X-0357..0360).
const CANONICAL_FIELDS = [
  'participantId','sex','email','phone','recordNumber','clinicalUnitId','clinicalUnit','unitAcronym','isDeceased','representativeName','representativeEmail','representativeIdentityDocument','representativePhone','consentTemplateId','status','consentTokenHash','consentTokenCreatedAt','consentTokenExpiresAt','consentNotifiedAt','consentAcceptedAt','createdAt','updatedAt','anamneseGeral','dadosEspecificos','studyId'
];

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
    const allowed = new Set(CANONICAL_FIELDS);
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) errors.push(`Campo não canônico: ${key}`);
    }
    if (data.email && !this.isValidEmail(data.email)) errors.push('email inválido');
    if (data.representativeEmail && !this.isValidEmail(data.representativeEmail)) errors.push('representativeEmail inválido');
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const allowed = new Set(CANONICAL_FIELDS);
    const unexpectedFields = Object.keys(data).filter((key) => !allowed.has(key));
    if (unexpectedFields.length > 0) {
      const error = new Error('Payload contém campos não canônicos');
      error.statusCode = 422;
      error.code = 'NON_CANONICAL_FIELD';
      error.fields = unexpectedFields;
      throw error;
    }

    // #1166 slice 4: validated here, persisted on ParticipantIdentity only.
    const email = data.email ? String(data.email).trim().toLowerCase() : null;
    if (email && !this.isValidEmail(email)) {
      throw new Error('email inválido');
    }
    // #1168: same for the representative's address.
    const representativeEmail = data.representativeEmail ? String(data.representativeEmail).trim().toLowerCase() : null;
    if (representativeEmail && !this.isValidEmail(representativeEmail)) {
      throw new Error('representativeEmail inválido');
    }

    const normalized = {
      participantId: String(data.participantId || '').trim(),
      sex: String(data.sex || '').trim(),
      recordNumber: data.recordNumber ? String(data.recordNumber).trim() : null,
      clinicalUnitId: data.clinicalUnitId || null,
      clinicalUnit: data.clinicalUnit || null,
      unitAcronym: data.unitAcronym || null,
      isDeceased: Boolean(data.isDeceased),
      consentTemplateId: data.consentTemplateId || null,
      status: data.status || 'PENDING_CONSENT',
      consentTokenHash: data.consentTokenHash || null,
      consentTokenCreatedAt: data.consentTokenCreatedAt ? new Date(data.consentTokenCreatedAt) : null,
      consentTokenExpiresAt: data.consentTokenExpiresAt ? new Date(data.consentTokenExpiresAt) : null,
      consentNotifiedAt: data.consentNotifiedAt ? new Date(data.consentNotifiedAt) : null,
      consentAcceptedAt: data.consentAcceptedAt ? new Date(data.consentAcceptedAt) : null,
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
      updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
      anamneseGeral: data.anamneseGeral || null,
      dadosEspecificos: data.dadosEspecificos || [],
      // RF021 AC#4 (#594): optional study linkage, same pattern as
      // Sample.js's studyId and PatientConsent.js's studyId (#593).
      studyId: data.studyId || null
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

ParticipantModel.CANONICAL_FIELDS = CANONICAL_FIELDS;

// #1277: the value type each field an update may carry must hold. Every
// CANONICAL_FIELDS entry is here, plus the three civil-identity fields the
// update payload still routes on to ParticipantIdentity (#575). `nullable`
// fields may be cleared with null; the others are required on create.
// A date accepts a Date or a string that parses as one.
const FIELD_TYPES = {
  participantId: { type: 'string' },
  sex: { type: 'string' },
  email: { type: 'string', nullable: true },
  phone: { type: 'string', nullable: true },
  recordNumber: { type: 'string', nullable: true },
  clinicalUnitId: { type: 'string', nullable: true },
  clinicalUnit: { type: 'string', nullable: true },
  unitAcronym: { type: 'string', nullable: true },
  isDeceased: { type: 'boolean' },
  representativeName: { type: 'string', nullable: true },
  representativeEmail: { type: 'string', nullable: true },
  representativeIdentityDocument: { type: 'string', nullable: true },
  representativePhone: { type: 'string', nullable: true },
  consentTemplateId: { type: 'string' },
  status: { type: 'string' },
  consentTokenHash: { type: 'string', nullable: true },
  consentTokenCreatedAt: { type: 'date', nullable: true },
  consentTokenExpiresAt: { type: 'date', nullable: true },
  consentNotifiedAt: { type: 'date', nullable: true },
  consentAcceptedAt: { type: 'date', nullable: true },
  createdAt: { type: 'date' },
  updatedAt: { type: 'date' },
  anamneseGeral: { type: 'object', nullable: true },
  dadosEspecificos: { type: 'array' },
  studyId: { type: 'string', nullable: true },
  patientName: { type: 'string', nullable: true },
  birthDate: { type: 'date', nullable: true },
  identityDocument: { type: 'string', nullable: true }
};

const TYPE_NAMES = {
  string: 'um texto',
  boolean: 'verdadeiro ou falso',
  date: 'uma data',
  object: 'um objeto',
  array: 'uma lista'
};

function holdsType(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'date':
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(new Date(value).getTime());
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
    case 'array': return Array.isArray(value);
    default: return false;
  }
}

/**
 * #1277: the type errors of an update patch, one per offending field, naming
 * it. Only the keys FIELD_TYPES declares are checked; whether a key is
 * allowed at all is the controller's allow-list (rejectCanonicalAliases).
 * An undefined value is an absent key.
 */
ParticipantModel.validateUpdateTypes = function validateUpdateTypes(patch = {}) {
  const errors = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined || !Object.prototype.hasOwnProperty.call(FIELD_TYPES, field)) continue;
    const { type, nullable } = FIELD_TYPES[field];
    if (value === null) {
      if (!nullable) errors.push(`${field} não pode ser nulo`);
      continue;
    }
    if (!holdsType(value, type)) errors.push(`${field} deve ser ${TYPE_NAMES[type]}`);
  }
  return errors;
};

ParticipantModel.FIELD_TYPES = FIELD_TYPES;

/**
 * #1045: removes the consent CREDENTIAL from a participant document on its way
 * out of the API.
 *
 * `consentToken` is the 64-char secret minted by NotificationService and is
 * the SOLE credential for the deliberately-unauthenticated
 * POST /api/e-consent/consent-tokens/accept. Any response carrying it lets an
 * authenticated org user record a legally-meaningful consent on a
 * participant's behalf through a call that cannot name them -- and it then
 * survives wherever that response goes: devtools, an HAR on a support ticket,
 * a client log, a proxy. The window is 7 days.
 *
 * `consentTokenCreatedAt` goes too: it is only ever useful next to the token.
 *
 * DELIBERATELY KEPT: `consentTokenExpiresAt` and `consentNotifiedAt`. The
 * patient directory renders both and neither is a credential -- stripping the
 * whole consent block would break the badge and the resend flow instead.
 *
 * #1049: the token is no longer stored at all -- only `consentTokenHash`
 * (utils/consentTokenHash.js). The hash is stripped too: it is not a usable
 * credential, but it is still nothing a response needs. A legacy row's
 * plaintext `consentToken` is stripped until the migration has converted it.
 *
 * Applied at the RESPONSE boundary rather than in a query projection on
 * purpose: the same documents are read internally by paths that legitimately
 * need the hash (validateConsentToken, acceptConsentToken), so a projection
 * would break them.
 */
ParticipantModel.stripConsentSecrets = function stripConsentSecrets(patient) {
  if (!patient || typeof patient !== 'object') return patient;
  if (Array.isArray(patient)) return patient.map(ParticipantModel.stripConsentSecrets);

  const { consentToken, consentTokenHash, consentTokenCreatedAt, ...rest } = patient;
  return rest;
};

module.exports = ParticipantModel;
