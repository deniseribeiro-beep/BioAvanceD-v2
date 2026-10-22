const crypto = require('crypto');

// Canonical Data Model v2.0.0 FeatureDefinition (V2E-0304..0313), RF029 AC8
// and RNF030 C3 (#1318): a feature's semantics, type, unit, transformation,
// time window, version, leakage risk and inputs.
//
// Inactive structure: modelled and catalog-conformant, written by no flow.
// RF029 AC8 permits it only in authorized and versioned scientific use, and
// no such flow exists yet. inactive-analytical-structures.arch.test.js pins
// that; the flow that activates it brings the gate and removes it there (see
// docs/decisions/2026-10-22-inactive-analytical-preparation-structures.md).

// INFERENCE, not a citation: V2E-0312's vocabulary cell reads `none` and its
// example `low`; the set extends that one-value cell to the scale it names.
// dataType stays an open code.
const LEAKAGE_RISKS = ['none', 'low', 'medium', 'high'];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const REQUIRED_STRINGS = [
  'featureDefinitionId', 'featureName', 'semantics', 'dataType',
  'transformation', 'semanticVersion', 'leakageRisk',
];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());
// The {systemUri, code, version, display} Coding shape ClinicalObservation uses.
const isCoding = (value) => value !== null && typeof value === 'object'
  && isNonEmptyString(value.systemUri) && isNonEmptyString(value.code);

// A Period is {start, end}, end null meaning open-ended, as in Encounter.js.
function periodOf(value) {
  if (!value) return null;
  return {
    start: value.start ? new Date(value.start) : null,
    end: value.end ? new Date(value.end) : null,
  };
}

function periodErrors(field, period) {
  if (!isValidDate(period.start)) return [`${field}.start deve ser uma data ISO 8601`];
  if (period.end === null) return [];
  if (!isValidDate(period.end)) return [`${field}.end deve ser uma data ISO 8601`];
  return period.end < period.start ? [`${field}.end não pode ser anterior a ${field}.start`] : [];
}

class FeatureDefinitionModel {
  static fieldsOf(data = {}) {
    return {
      featureDefinitionId: data.featureDefinitionId || crypto.randomUUID(),
      featureName: data.featureName ?? null,
      semantics: data.semantics ?? null,
      dataType: data.dataType ?? null,
      unit: data.unit ?? null,
      transformation: data.transformation ?? null,
      timeWindow: periodOf(data.timeWindow),
      semanticVersion: data.semanticVersion ?? null,
      leakageRisk: data.leakageRisk ?? null,
      inputRefs: Array.isArray(data.inputRefs) ? data.inputRefs : [],
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para FeatureDefinition (1..1)`);
    }
    if (fields.inputRefs.length === 0 || !fields.inputRefs.every(isNonEmptyString)) {
      errors.push('inputRefs é obrigatório para FeatureDefinition (1..*, Reference)');
    }
    if (fields.unit !== null && !isCoding(fields.unit)) errors.push('unit deve ser um Coding com systemUri e code');
    if (fields.timeWindow !== null) errors.push(...periodErrors('timeWindow', fields.timeWindow));
    if (isNonEmptyString(fields.semanticVersion) && !SEMVER.test(fields.semanticVersion)) {
      errors.push(`semanticVersion deve ser SemVer (MAJOR.MINOR.PATCH): ${fields.semanticVersion}`);
    }
    if (isNonEmptyString(fields.leakageRisk) && !LEAKAGE_RISKS.includes(fields.leakageRisk)) {
      errors.push(`leakageRisk inválido: ${fields.leakageRisk}`);
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const { isValid, errors } = this.validate(fields);
    if (!isValid) throw new Error(errors.join('; '));
    return fields;
  }
}

module.exports = FeatureDefinitionModel;
module.exports.LEAKAGE_RISKS = LEAKAGE_RISKS;
