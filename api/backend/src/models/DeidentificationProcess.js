const crypto = require('crypto');

// Canonical Data Model v2.0.0 DeidentificationProcess (V2E-0338..0345),
// RNF030 C5 (#1318): a versioned de-identification method, its field
// transformations, risk assessment, key, responsible actor, input
// DatasetSnapshot and output files.
//
// Inactive structure: modelled and catalog-conformant, written by no flow.
// No authorized and versioned scientific-use flow exists yet.
// inactive-analytical-structures.arch.test.js pins that; the flow that
// activates it brings the gate and removes it there (see
// docs/decisions/2026-10-22-inactive-analytical-preparation-structures.md).

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const REQUIRED_STRINGS = [
  'deidentificationProcessId', 'methodVersion', 'riskAssessmentId',
  'responsibleActorId', 'inputSnapshotId',
];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);

class DeidentificationProcessModel {
  static fieldsOf(data = {}) {
    return {
      deidentificationProcessId: data.deidentificationProcessId || crypto.randomUUID(),
      methodVersion: data.methodVersion ?? null,
      fieldTransformations: Array.isArray(data.fieldTransformations) ? data.fieldTransformations : [],
      riskAssessmentId: data.riskAssessmentId ?? null,
      keyReference: data.keyReference ?? null,
      responsibleActorId: data.responsibleActorId ?? null,
      inputSnapshotId: data.inputSnapshotId ?? null,
      outputFileIds: Array.isArray(data.outputFileIds) ? data.outputFileIds : [],
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para DeidentificationProcess (1..1)`);
    }
    if (fields.fieldTransformations.length === 0 || !fields.fieldTransformations.every(isPlainObject)) {
      errors.push('fieldTransformations é obrigatório para DeidentificationProcess (1..*, object)');
    }
    if (fields.outputFileIds.length === 0 || !fields.outputFileIds.every(isNonEmptyString)) {
      errors.push('outputFileIds é obrigatório para DeidentificationProcess (1..*, Reference)');
    }
    if (fields.keyReference !== null && !isNonEmptyString(fields.keyReference)) {
      errors.push('keyReference deve ser um texto não vazio quando informado');
    }
    if (isNonEmptyString(fields.methodVersion) && !SEMVER.test(fields.methodVersion)) {
      errors.push(`methodVersion deve ser SemVer (MAJOR.MINOR.PATCH): ${fields.methodVersion}`);
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

module.exports = DeidentificationProcessModel;
