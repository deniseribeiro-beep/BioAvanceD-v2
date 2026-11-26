/**
 * Modelo de validação e estrutura para ConsentTemplate
 */
const crypto = require('crypto');

// ENUM-0043..0046: the four consent modalities (Consent.consentModel).
const CONSENT_MODELS = ['specific', 'broad', 'tiered', 'dynamic'];
// BCP 47 (P1X-0093), the shape only: a primary language subtag and optional subtags.
const BCP47 = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

function isUri(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * RF010 AC1 (dict v2.0.0 P1X-0093, V2E-0430, V2E-0432): the term's language,
 * jurisdiction and the checksum of the exact text, plus the consent
 * modality it offers, which each Consent signed on it records (ELM-0095).
 * Language and jurisdiction default to this deployment's: Portuguese, under
 * Brazilian law. The checksum is always computed from the text, never taken
 * from the caller. The controlled document's URI (P1X-0095) is optional, as
 * caae is, until the builder sends one (#1492).
 */
function documentControlOf(data, text) {
  return {
    language: typeof data.language === 'string' && data.language.trim() ? data.language.trim() : 'pt-BR',
    jurisdiction: typeof data.jurisdiction === 'string' && data.jurisdiction.trim() ? data.jurisdiction.trim() : 'BR',
    consentModel: data.consentModel ?? null,
    documentUri: typeof data.documentUri === 'string' && data.documentUri.trim() ? data.documentUri.trim() : null,
    checksum: `sha256:${crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex')}`,
  };
}

function documentControlErrors(data) {
  const errors = [];
  if (data.language !== undefined && data.language !== null
    && (typeof data.language !== 'string' || !BCP47.test(data.language.trim()))) {
    errors.push('language deve ser uma etiqueta BCP 47 (ex.: pt-BR)');
  }
  if (data.jurisdiction !== undefined && data.jurisdiction !== null
    && (typeof data.jurisdiction !== 'string' || data.jurisdiction.trim().length === 0)) {
    errors.push('jurisdiction deve ser um texto válido');
  }
  if (data.consentModel !== undefined && data.consentModel !== null && !CONSENT_MODELS.includes(data.consentModel)) {
    errors.push(`consentModel deve ser um de: ${CONSENT_MODELS.join(', ')}`);
  }
  if (data.documentUri !== undefined && data.documentUri !== null && !isUri(String(data.documentUri).trim())) {
    errors.push('documentUri deve ser uma URI');
  }
  return errors;
}

class ConsentTemplateModel {
  static validate(data) {
    const errors = [...documentControlErrors(data)];

    if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
      errors.push('title é obrigatório e deve ser um texto válido');
    }

    const contentValue = data.content || data.htmlContent;
    if (!contentValue || typeof contentValue !== 'string' || contentValue.trim().length === 0) {
      errors.push('content é obrigatório e deve ser um texto válido');
    }

    if (data.version !== undefined && (typeof data.version !== 'string' || data.version.trim().length === 0)) {
      errors.push('version deve ser um texto válido');
    }

    if (data.caae !== undefined && (typeof data.caae !== 'string' || data.caae.trim().length === 0)) {
      errors.push('caae deve ser um texto válido');
    }

    if (data.active !== undefined && typeof data.active !== 'boolean') {
      errors.push('active deve ser booleano');
    }

    if (data.permissions !== undefined) {
      if (!Array.isArray(data.permissions)) {
        errors.push('permissions deve ser um array');
      } else {
        data.permissions.forEach((permission, index) => {
          if (!permission || typeof permission !== 'object') {
            errors.push(`permissions[${index}] deve ser um objeto`);
            return;
          }
          if (!permission.key || typeof permission.key !== 'string') {
            errors.push(`permissions[${index}].key é obrigatório e deve ser string`);
          }
          if (!permission.label || typeof permission.label !== 'string') {
            errors.push(`permissions[${index}].label é obrigatório e deve ser string`);
          }
          if (permission.required !== undefined && typeof permission.required !== 'boolean') {
            errors.push(`permissions[${index}].required deve ser booleano`);
          }
          if (permission.purposeCode !== undefined && (typeof permission.purposeCode !== 'string' || permission.purposeCode.trim().length === 0)) {
            errors.push(`permissions[${index}].purposeCode deve ser um código DUO`);
          }
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    const content = (data.content || data.htmlContent).trim();
    const htmlContent = data.htmlContent ? data.htmlContent.trim() : (data.content || '').trim();
    return {
      ...documentControlOf(data, htmlContent || content),
      title: data.title.trim(),
      content: (data.content || data.htmlContent).trim(),
      htmlContent: data.htmlContent ? data.htmlContent.trim() : (data.content || '').trim(),
      version: typeof data.version === 'string' && data.version.trim().length > 0 ? data.version.trim() : 'v1',
      versionGroupId: typeof data.versionGroupId === 'string' && data.versionGroupId.trim().length > 0 ? data.versionGroupId.trim() : undefined,
      previousTemplateId: typeof data.previousTemplateId === 'string' && data.previousTemplateId.trim().length > 0 ? data.previousTemplateId.trim() : undefined,
      // #824: RF010 AC#1's lineage fields, as the policy path writes them, so
      // the publication sweep can resolve a builder-published revision.
      previousPolicyId: typeof data.previousPolicyId === 'string' && data.previousPolicyId.trim().length > 0 ? data.previousPolicyId.trim() : null,
      revisionType: data.revisionType === 'update' ? 'update' : 'create',
      // #824: the builder sends a validity period and createPatientConsent
      // enforces one, but this dropped both -- a builder-published term was
      // valid forever whatever the operator entered.
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validTo: data.validTo ? new Date(data.validTo) : null,
      caae: typeof data.caae === 'string' ? data.caae.trim() : '',
      active: data.active === undefined ? true : data.active,
      permissions: Array.isArray(data.permissions) ? data.permissions : [],
      createdAt: new Date()
    };
  }
}

module.exports = ConsentTemplateModel;
module.exports.CONSENT_MODELS = CONSENT_MODELS;
module.exports.documentControlOf = documentControlOf;
module.exports.documentControlErrors = documentControlErrors;
