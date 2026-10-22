const crypto = require('crypto');

// Canonical Data Model v2.0.0 Network (P1X-0001..0012), RF020 AC1 (#1322): a
// network of biobanks, entered by a Coordenador or Administrador, that the
// MIABIS export reads (see
// docs/decisions/2026-10-23-network-biobank-structures.md). networkStatus
// and networkType are open codes; networkMembers is not resolved, since a
// member may be a Biobank or a Network. create() never throws: validation is
// the router's job, as for Collection.js.

const REQUIRED_STRINGS = ['name', 'description', 'juristicPerson', 'networkStatus'];
const CODE_ARRAYS = ['countryCodes', 'networkMembers', 'commonCollaborationTopics'];
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPresent = (value) => value !== undefined && value !== null;

function isContactInformation(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).some(isNonEmptyString);
}

class NetworkModel {
  static fieldsOf(data = {}) {
    return {
      networkId: data.networkId || crypto.randomUUID(),
      acronym: data.acronym ?? null,
      name: data.name ?? null,
      url: data.url ?? null,
      juristicPerson: data.juristicPerson ?? null,
      countryCodes: Array.isArray(data.countryCodes)
        ? data.countryCodes.map((code) => (typeof code === 'string' ? code.trim().toUpperCase() : code))
        : [],
      contactInformation: data.contactInformation ?? null,
      description: data.description ?? null,
      networkStatus: data.networkStatus ?? null,
      networkMembers: Array.isArray(data.networkMembers) ? data.networkMembers : [],
      commonCollaborationTopics: Array.isArray(data.commonCollaborationTopics) ? data.commonCollaborationTopics : [],
      networkType: data.networkType ?? null,
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para Network (1..1)`);
    }
    for (const field of CODE_ARRAYS) {
      if (isPresent(data[field]) && !Array.isArray(data[field])) {
        errors.push(`${field} deve ser uma lista`);
      } else if (Array.isArray(data[field]) && !data[field].every(isNonEmptyString)) {
        errors.push(`${field} deve conter apenas códigos não vazios`);
      }
    }
    if (fields.countryCodes.length === 0) {
      errors.push('countryCodes é obrigatório para Network (1..*)');
    } else if (!fields.countryCodes.every((code) => typeof code === 'string' && COUNTRY_CODE.test(code))) {
      errors.push('countryCodes deve conter apenas códigos ISO 3166-1 alpha-2');
    }
    if (!isContactInformation(fields.contactInformation)) {
      errors.push('contactInformation é obrigatório para Network (1..1) e deve ter ao menos um contato preenchido');
    }
    if (fields.url !== null && fields.url !== '') {
      try {
        // eslint-disable-next-line no-new
        new URL(String(fields.url));
      } catch (_) {
        errors.push('url deve ser uma URI válida');
      }
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return { ...this.fieldsOf(data), createdAt: new Date(), updatedAt: new Date() };
  }
}

module.exports = NetworkModel;
