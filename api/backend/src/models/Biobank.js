const crypto = require('crypto');

// Canonical Data Model v2.0.0 Biobank (ELM-0032..0038, P1X-0036..0043), RF020
// AC1 (#1322): a biobank, entered by a Coordenador or Administrador, that the
// MIABIS export reads (see
// docs/decisions/2026-10-23-network-biobank-structures.md). Both capability
// pairs (ELM-0037/0038 and P1X-0040/0042) are catalog fields, so both are
// stored as given. biobankStatus is an open code. create() never throws:
// validation is the router's job, as for Collection.js.

const REQUIRED_STRINGS = ['biobankName', 'biobankDescription', 'legalEntityId', 'biobankStatus'];
const CODE_ARRAYS = ['infrastructuralCapabilities', 'organisationalCapabilities', 'bioprocessingAnalyticalCapabilities'];
const CODEABLE_CONCEPT_ARRAYS = ['infrastructureCapabilities', 'bioprocessingCapabilities', 'qualityManagementStandards'];
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPresent = (value) => value !== undefined && value !== null;
const asArray = (value) => (Array.isArray(value) ? value : []);

function isContactInformation(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).some(isNonEmptyString);
}

class BiobankModel {
  static fieldsOf(data = {}) {
    return {
      biobankId: data.biobankId || crypto.randomUUID(),
      biobankName: data.biobankName ?? null,
      biobankDescription: data.biobankDescription ?? null,
      legalEntityId: data.legalEntityId ?? null,
      biobankStatus: data.biobankStatus ?? null,
      infrastructureCapabilities: asArray(data.infrastructureCapabilities),
      bioprocessingCapabilities: asArray(data.bioprocessingCapabilities),
      acronym: data.acronym ?? null,
      url: data.url ?? null,
      countryCode: typeof data.countryCode === 'string' ? data.countryCode.trim().toUpperCase() : (data.countryCode ?? null),
      contactInformation: data.contactInformation ?? null,
      infrastructuralCapabilities: asArray(data.infrastructuralCapabilities),
      organisationalCapabilities: asArray(data.organisationalCapabilities),
      bioprocessingAnalyticalCapabilities: asArray(data.bioprocessingAnalyticalCapabilities),
      qualityManagementStandards: asArray(data.qualityManagementStandards),
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para Biobank (1..1)`);
    }
    if (!isNonEmptyString(fields.countryCode)) {
      errors.push('countryCode é obrigatório para Biobank (1..1)');
    } else if (!COUNTRY_CODE.test(fields.countryCode)) {
      errors.push('countryCode deve seguir ISO 3166-1 alpha-2');
    }
    if (!isContactInformation(fields.contactInformation)) {
      errors.push('contactInformation é obrigatório para Biobank (1..1) e deve ter ao menos um contato preenchido');
    }
    if (fields.url !== null && fields.url !== '') {
      try {
        // eslint-disable-next-line no-new
        new URL(String(fields.url));
      } catch (_) {
        errors.push('url deve ser uma URI válida');
      }
    }
    for (const field of [...CODE_ARRAYS, ...CODEABLE_CONCEPT_ARRAYS]) {
      if (isPresent(data[field]) && !Array.isArray(data[field])) {
        errors.push(`${field} deve ser uma lista`);
      }
    }
    for (const field of CODE_ARRAYS) {
      if (Array.isArray(data[field]) && !data[field].every(isNonEmptyString)) {
        errors.push(`${field} deve conter apenas códigos não vazios`);
      }
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return { ...this.fieldsOf(data), createdAt: new Date(), updatedAt: new Date() };
  }
}

module.exports = BiobankModel;
