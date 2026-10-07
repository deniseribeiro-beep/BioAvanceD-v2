/**
 * ConfigurationProfile (RF014 AC1, CFG-002; dict v2.0.0 V2E-0011..0019):
 * what a family of ConfigurationReleases configures and where it applies.
 * Releases point at it by profileId (V2E-0033); the profile itself holds
 * no live values.
 */
const crypto = require('crypto');

// V2E-0013's extraction keeps only `organization`. The security
// configuration is scoped to a deployment environment instead (P1X-0277;
// plano §4 F1.2, "Uma release ativa por ambiente"), so `environment` is
// the second scope.
const SCOPE_TYPES = ['organization', 'environment'];

class ConfigurationProfileModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      profileId: data.profileId,
      profileName: data.profileName,
      scopeType: data.scopeType,
      scopeId: data.scopeId,
      settings: data.settings,
      allowedValues: data.allowedValues,
      defaults: data.defaults,
      dependencies: data.dependencies,
      ownerId: data.ownerId,
    };
  }

  static validate(data = {}) {
    const errors = [];
    for (const field of ['profileId', 'profileName', 'scopeId', 'ownerId']) {
      if (!data[field] || typeof data[field] !== 'string') {
        errors.push(`${field} é obrigatório e deve ser string`);
      }
    }
    if (!SCOPE_TYPES.includes(data.scopeType)) {
      errors.push(`scopeType deve ser um de: ${SCOPE_TYPES.join('|')}`);
    }
    for (const field of ['settings', 'allowedValues']) {
      if (!data[field] || typeof data[field] !== 'object' || Array.isArray(data[field])) {
        errors.push(`${field} deve ser um objeto`);
      }
    }
    if (data.dependencies !== undefined && !Array.isArray(data.dependencies)) {
      errors.push('dependencies deve ser um array');
    }
    return { isValid: errors.length === 0, errors };
  }

  static create({ profileName, scopeType, scopeId, settings, allowedValues = {}, defaults = null, dependencies = [], ownerId, now = new Date() } = {}) {
    const profile = {
      profileId: crypto.randomUUID(),
      profileName,
      scopeType,
      scopeId,
      settings,
      allowedValues,
      defaults,
      dependencies,
      ownerId,
      createdAt: now,
    };
    const { isValid, errors } = ConfigurationProfileModel.validate(profile);
    if (!isValid) throw new Error(`ConfigurationProfile inválido: ${errors.join('; ')}`);
    return profile;
  }
}

module.exports = ConfigurationProfileModel;
module.exports.SCOPE_TYPES = SCOPE_TYPES;
