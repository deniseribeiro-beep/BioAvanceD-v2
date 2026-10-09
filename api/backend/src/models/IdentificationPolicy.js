const crypto = require('crypto');
const { SYMBOLOGY_VALUES } = require('./LabelIdentifier');

// Canonical Data Model v2.0.0 IdentificationPolicy (V2E-0200..0207),
// RF016 AC5: which symbologies, targets, privacy and checksum rules a
// configuration release allows, and what to fall back on when a code cannot
// be read. allowedSymbologies draws on RF016 AC5's three; fallbackMode lists
// only `manual_accession` in the catalog, the one value accepted.
const FALLBACK_MODE_VALUES = ['manual_accession'];
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

class IdentificationPolicyModel {
  static fieldsOf(data = {}) {
    return {
      identificationPolicyId: data.identificationPolicyId || crypto.randomUUID(),
      semanticVersion: data.semanticVersion ?? null,
      allowedSymbologies: Array.isArray(data.allowedSymbologies) ? data.allowedSymbologies.map((s) => String(s).toLowerCase()) : [],
      targetRules: Array.isArray(data.targetRules) ? data.targetRules : [],
      privacyRules: Array.isArray(data.privacyRules) ? data.privacyRules : [],
      checksumRules: data.checksumRules ?? null,
      fallbackMode: data.fallbackMode ? String(data.fallbackMode).toLowerCase() : null,
      configurationReleaseId: data.configurationReleaseId ?? null,
    };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    if (!fields.semanticVersion || !SEMVER.test(fields.semanticVersion)) {
      throw new Error(`semanticVersion é obrigatório e SemVer para IdentificationPolicy: ${fields.semanticVersion}`);
    }
    for (const field of ['allowedSymbologies', 'targetRules', 'privacyRules']) {
      if (!fields[field].length) {
        throw new Error(`${field} é obrigatório para IdentificationPolicy (1..*)`);
      }
    }
    const unknown = fields.allowedSymbologies.filter((s) => !SYMBOLOGY_VALUES.includes(s));
    if (unknown.length) {
      throw new Error(`allowedSymbologies inválido: ${unknown.join(', ')}`);
    }
    if (!fields.checksumRules || typeof fields.checksumRules !== 'object' || Array.isArray(fields.checksumRules)) {
      throw new Error('checksumRules é obrigatório para IdentificationPolicy (1..1, objeto)');
    }
    if (!FALLBACK_MODE_VALUES.includes(fields.fallbackMode)) {
      throw new Error(`fallbackMode inválido: ${fields.fallbackMode}`);
    }
    if (!fields.configurationReleaseId) {
      throw new Error('configurationReleaseId é obrigatório para IdentificationPolicy (1..1)');
    }
    return fields;
  }

  // RF016 AC5: a code is accepted only in a symbology the policy allows.
  static allows(policy, symbology) {
    return policy.allowedSymbologies.includes(String(symbology).toLowerCase());
  }
}

module.exports = IdentificationPolicyModel;
module.exports.FALLBACK_MODE_VALUES = FALLBACK_MODE_VALUES;
