const { randomUUID } = require('crypto');

const ORGANIZATION_TYPES = ['biobank', 'university', 'hospital', 'laboratory', 'network'];

class OrganizationModel {
  static normalizeName(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase();
  }

  static validate(data = {}) {
    const errors = [];

    const officialName = String(data.officialName || '').trim();
    if (!officialName) {
      errors.push('officialName é obrigatório');
    } else if (officialName.length < 2) {
      errors.push('officialName deve ter ao menos 2 caracteres');
    }

    const countryCode = String(data.countryCode || '').trim();
    if (!countryCode) {
      errors.push('countryCode é obrigatório');
    } else if (!/^[A-Za-z]{2}$/.test(countryCode)) {
      errors.push('countryCode deve seguir ISO 3166-1 alpha-2');
    }

    if (data.organizationType !== undefined && data.organizationType !== null && data.organizationType !== '') {
      if (!ORGANIZATION_TYPES.includes(data.organizationType)) {
        errors.push(`organizationType deve ser um de: ${ORGANIZATION_TYPES.join(', ')}`);
      }
    }

    if (data.website !== undefined && data.website !== null && data.website !== '') {
      try {
        // eslint-disable-next-line no-new
        new URL(String(data.website));
      } catch (_) {
        errors.push('website deve ser uma URI válida');
      }
    }

    if (data.qualityStandards !== undefined && data.qualityStandards !== null && !Array.isArray(data.qualityStandards)) {
      errors.push('qualityStandards deve ser uma lista');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data = {}) {
    const officialName = String(data.officialName || '').trim().replace(/\s+/g, ' ');

    return {
      organizationId: randomUUID(),
      officialName,
      normalizedName: OrganizationModel.normalizeName(officialName),
      acronym: data.acronym ? String(data.acronym).trim() : null,
      organizationType: data.organizationType || null,
      countryCode: String(data.countryCode || '').trim().toUpperCase(),
      website: data.website ? String(data.website).trim() : null,
      contact: data.contact || null,
      qualityStandards: Array.isArray(data.qualityStandards) ? data.qualityStandards : [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = OrganizationModel;
module.exports.ORGANIZATION_TYPES = ORGANIZATION_TYPES;
