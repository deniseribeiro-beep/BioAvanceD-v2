const crypto = require('crypto');

// Canonical Data Model v2.0.0 RCSValidationStudy (V2E-0361..0368), RF018
// (#1320): the study that validates an RCS rule package for a context of
// use, with its expert panel, outcomes, metrics, protocol and status.
// RCSRulePackage's validationEvidenceIds (V2E-0360) references it (REL-0089).
//
// No collection holds it and no flow writes it (see
// docs/decisions/2026-10-27-rcs-validation-study-model.md).

const REQUIRED_STRINGS = ['rcsValidationStudyId', 'contextOfUse', 'rulePackageId', 'expertPanelDefinition'];
const REQUIRED_ARRAYS = ['outcomes', 'metrics'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);

const isUri = (value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

// Object.freeze is shallow, so each array and plain object is copied and
// frozen level by level.
const deepFreeze = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  if (isPlainObject(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepFreeze(entry)])));
  }
  return value;
};

class RcsValidationStudyModel {
  static fieldsOf(data = {}) {
    return {
      rcsValidationStudyId: data.rcsValidationStudyId || crypto.randomUUID(),
      contextOfUse: data.contextOfUse ?? null,
      rulePackageId: data.rulePackageId ?? null,
      expertPanelDefinition: data.expertPanelDefinition ?? null,
      outcomes: Array.isArray(data.outcomes) ? data.outcomes : [],
      metrics: Array.isArray(data.metrics) ? data.metrics : [],
      protocolUri: data.protocolUri ?? null,
      status: data.status ?? null,
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    // The id is not UUID-checked, as rcsRulePackageId is not: the
    // dictionary's example is rcs-validation-synthetic-001.
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para RCSValidationStudy (1..1)`);
    }
    for (const field of REQUIRED_ARRAYS) {
      if (fields[field].length === 0 || !fields[field].every(isNonEmptyString)) {
        errors.push(`${field} é obrigatório para RCSValidationStudy (1..*)`);
      }
    }
    if (!isNonEmptyString(fields.protocolUri) || !isUri(fields.protocolUri)) {
      errors.push(`protocolUri deve ser uma URI para RCSValidationStudy (1..1): ${fields.protocolUri}`);
    }
    // INFERENCE, not a citation: the cell and the example both read
    // `planned` and name no set, so status stays an open code.
    if (!isNonEmptyString(fields.status)) {
      errors.push('status é obrigatório para RCSValidationStudy (1..1)');
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

module.exports = RcsValidationStudyModel;
