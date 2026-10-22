const crypto = require('crypto');

// Canonical Data Model v2.0.0 DatasetRepresentativenessAssessment
// (V2E-0330..0337), RNF030 C5's "representatividade" (#1318): the authorized
// strata of a DatasetSnapshot, its distribution and missingness metrics,
// suppression threshold and limitations.
//
// Inactive structure: modelled and catalog-conformant, written by no flow.
// No authorized and versioned scientific-use flow exists yet.
// inactive-analytical-structures.arch.test.js pins that; the flow that
// activates it brings the gate and removes it there (see
// docs/decisions/2026-10-22-inactive-analytical-preparation-structures.md).

const REQUIRED_STRINGS = ['representativenessAssessmentId', 'snapshotId'];
const REQUIRED_OBJECT_ARRAYS = ['distributionMetrics', 'missingnessMetrics'];
// authorizedStrata is an open code list; limitations is free text.
const REQUIRED_STRING_ARRAYS = ['authorizedStrata', 'limitations'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);
const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

class DatasetRepresentativenessAssessmentModel {
  static fieldsOf(data = {}) {
    return {
      representativenessAssessmentId: data.representativenessAssessmentId || crypto.randomUUID(),
      snapshotId: data.snapshotId ?? null,
      authorizedStrata: Array.isArray(data.authorizedStrata) ? data.authorizedStrata : [],
      distributionMetrics: Array.isArray(data.distributionMetrics) ? data.distributionMetrics : [],
      missingnessMetrics: Array.isArray(data.missingnessMetrics) ? data.missingnessMetrics : [],
      suppressionThreshold: data.suppressionThreshold ?? null,
      limitations: Array.isArray(data.limitations) ? data.limitations : [],
      assessedAt: data.assessedAt ? new Date(data.assessedAt) : null,
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) {
        errors.push(`${field} é obrigatório para DatasetRepresentativenessAssessment (1..1)`);
      }
    }
    for (const field of REQUIRED_STRING_ARRAYS) {
      if (fields[field].length === 0 || !fields[field].every(isNonEmptyString)) {
        errors.push(`${field} é obrigatório para DatasetRepresentativenessAssessment (1..*, texto não vazio)`);
      }
    }
    for (const field of REQUIRED_OBJECT_ARRAYS) {
      if (fields[field].length === 0 || !fields[field].every(isPlainObject)) {
        errors.push(`${field} é obrigatório para DatasetRepresentativenessAssessment (1..*, object)`);
      }
    }
    if (!Number.isInteger(fields.suppressionThreshold)) {
      errors.push('suppressionThreshold é obrigatório para DatasetRepresentativenessAssessment (1..1, integer)');
    }
    if (!isValidDate(fields.assessedAt)) {
      errors.push('assessedAt é obrigatório para DatasetRepresentativenessAssessment (1..1, ISO 8601)');
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf({ ...data, assessedAt: data.assessedAt || new Date() });
    const { isValid, errors } = this.validate(fields);
    if (!isValid) throw new Error(errors.join('; '));
    return fields;
  }
}

module.exports = DatasetRepresentativenessAssessmentModel;
