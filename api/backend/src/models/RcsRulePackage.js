const crypto = require('crypto');

// Canonical Data Model v2.0.0 RCSRulePackage (V2E-0354..0360), RF018 AC10
// and CFG-006 (#1320): the versioned package of rules an RCS assessment runs,
// with its SPREC mapping release, its checksum, its governance gate version,
// its status and its validation evidence.
//
// A Phase 1 structure written by no flow: modelled and catalog-conformant,
// with no collection registered. rcs-certification.service.js#rulePackage()
// does not use it (see docs/decisions/2026-10-24-rcs-rule-package-model.md).

// V2E-0357 is a SHA-256 digest, written `sha256:<hex>` as the service writes
// the package checksum; a bare 64-hex digest is the same value.
const SHA256 = /^(sha256:)?[a-f0-9]{64}$/i;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// INFERENCE, not a citation: the cell reads `draft` and the example
// `active`. The set is the repo's release lifecycle, as
// ConfigurationRelease.js and InteroperabilityMappingRelease.js use it.
const STATUSES = ['draft', 'candidate', 'approved', 'active', 'superseded', 'retired'];

const REQUIRED_STRINGS = ['rcsRulePackageId', 'sprecMappingReleaseId'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);

// Object.freeze is shallow, so each array and plain object is copied and
// frozen level by level.
const deepFreeze = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  if (isPlainObject(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepFreeze(entry)])));
  }
  return value;
};

class RcsRulePackageModel {
  static fieldsOf(data = {}) {
    return {
      rcsRulePackageId: data.rcsRulePackageId || crypto.randomUUID(),
      semanticVersion: data.semanticVersion ?? null,
      sprecMappingReleaseId: data.sprecMappingReleaseId ?? null,
      checksum: data.checksum ?? null,
      governanceGateVersion: data.governanceGateVersion ?? null,
      status: data.status ?? null,
      validationEvidenceIds: Array.isArray(data.validationEvidenceIds) ? data.validationEvidenceIds : [],
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para RCSRulePackage (1..1)`);
    }
    // V2E-0355's vocabulary is SemVer.
    if (!isNonEmptyString(fields.semanticVersion) || !SEMVER.test(fields.semanticVersion)) {
      errors.push(`semanticVersion deve ser SemVer (MAJOR.MINOR.PATCH) para RCSRulePackage (1..1): ${fields.semanticVersion}`);
    }
    if (!isNonEmptyString(fields.checksum) || !SHA256.test(fields.checksum)) {
      errors.push(`checksum deve ser um digest SHA-256 para RCSRulePackage (1..1): ${fields.checksum}`);
    }
    // V2E-0358's vocabulary is internal, so it is not SemVer-checked: the
    // running gate's version is RCS-GOV-1.0.
    if (!isNonEmptyString(fields.governanceGateVersion)) {
      errors.push('governanceGateVersion é obrigatório para RCSRulePackage (1..1)');
    }
    if (!STATUSES.includes(fields.status)) {
      errors.push(`status inválido para RCSRulePackage (1..1): ${fields.status}`);
    }
    if (fields.validationEvidenceIds.length === 0 || !fields.validationEvidenceIds.every(isNonEmptyString)) {
      errors.push('validationEvidenceIds é obrigatório para RCSRulePackage (1..*, Reference)');
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const { isValid, errors } = this.validate(fields);
    if (!isValid) throw new Error(errors.join('; '));
    return deepFreeze(fields);
  }
}

module.exports = RcsRulePackageModel;
module.exports.STATUSES = STATUSES;
