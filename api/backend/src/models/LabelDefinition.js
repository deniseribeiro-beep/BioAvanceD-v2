const crypto = require('crypto');

// Canonical Data Model v2.0.0 LabelDefinition (V2E-0296..0303), RF029 AC8
// and RNF030 C3 (#1318): a label's concept, method, source, temporal anchor,
// uncertainty, version and restrictions.
//
// Inactive structure: modelled and catalog-conformant, written by no flow.
// RF029 AC8 permits it only in authorized and versioned scientific use, and
// no such flow exists yet. inactive-analytical-structures.arch.test.js pins
// that; the flow that activates it brings the gate and removes it there (see
// docs/decisions/2026-10-22-inactive-analytical-preparation-structures.md).

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const REQUIRED_STRINGS = ['labelDefinitionId', 'method', 'source', 'temporalAnchor', 'semanticVersion'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);
// INFERENCE, not a citation: concept (V2E-0297) is a CodeableConcept, and the
// repo has no CodeableConcept shape; it takes the {systemUri, code, version,
// display} Coding shape ClinicalObservation uses.
const isCoding = (value) => isPlainObject(value) && isNonEmptyString(value.systemUri) && isNonEmptyString(value.code);

class LabelDefinitionModel {
  static fieldsOf(data = {}) {
    return {
      labelDefinitionId: data.labelDefinitionId || crypto.randomUUID(),
      concept: data.concept ?? null,
      method: data.method ?? null,
      source: data.source ?? null,
      temporalAnchor: data.temporalAnchor ?? null,
      uncertainty: data.uncertainty ?? null,
      semanticVersion: data.semanticVersion ?? null,
      restrictions: Array.isArray(data.restrictions) ? data.restrictions : [],
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para LabelDefinition (1..1)`);
    }
    if (!isCoding(fields.concept)) errors.push('concept é obrigatório para LabelDefinition (1..1, Coding com systemUri e code)');
    if (!isPlainObject(fields.uncertainty)) errors.push('uncertainty é obrigatório para LabelDefinition (1..1, object)');
    if (isNonEmptyString(fields.semanticVersion) && !SEMVER.test(fields.semanticVersion)) {
      errors.push(`semanticVersion deve ser SemVer (MAJOR.MINOR.PATCH): ${fields.semanticVersion}`);
    }
    if (!fields.restrictions.every(isNonEmptyString)) errors.push('restrictions deve conter apenas textos não vazios');
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const { isValid, errors } = this.validate(fields);
    if (!isValid) throw new Error(errors.join('; '));
    return fields;
  }
}

module.exports = LabelDefinitionModel;
