const crypto = require('crypto');

// Canonical Data Model v2.0.0 CohortDefinition (V2E-0314..0321), RF029 AC8
// (#1318): a cohort's population, inclusion and exclusion criteria, time
// window, terminology versions, source DatasetSnapshot and checksum.
//
// Inactive structure: modelled and catalog-conformant, written by no flow.
// RF029 AC8 permits it only in authorized and versioned scientific use, and
// no such flow exists yet. inactive-analytical-structures.arch.test.js pins
// that; the flow that activates it brings the gate and removes it there (see
// docs/decisions/2026-10-22-inactive-analytical-preparation-structures.md).

// The synthetic examples write checksums as `sha256:<hex>`; a bare 64-hex
// digest is the same value.
const SHA256 = /^(sha256:)?[a-f0-9]{64}$/i;

const REQUIRED_STRINGS = ['cohortDefinitionId', 'population', 'datasetSnapshotId', 'checksum'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);
const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

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

class CohortDefinitionModel {
  static fieldsOf(data = {}) {
    return {
      cohortDefinitionId: data.cohortDefinitionId || crypto.randomUUID(),
      population: data.population ?? null,
      inclusionCriteria: Array.isArray(data.inclusionCriteria) ? data.inclusionCriteria : [],
      exclusionCriteria: Array.isArray(data.exclusionCriteria) ? data.exclusionCriteria : [],
      timeWindow: periodOf(data.timeWindow),
      terminologyVersions: Array.isArray(data.terminologyVersions) ? data.terminologyVersions : [],
      datasetSnapshotId: data.datasetSnapshotId ?? null,
      checksum: data.checksum ?? null,
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para CohortDefinition (1..1)`);
    }
    if (fields.inclusionCriteria.length === 0 || !fields.inclusionCriteria.every(isPlainObject)) {
      errors.push('inclusionCriteria é obrigatório para CohortDefinition (1..*, object)');
    }
    if (!fields.exclusionCriteria.every(isPlainObject)) errors.push('exclusionCriteria deve conter apenas objetos');
    if (fields.timeWindow === null) errors.push('timeWindow é obrigatório para CohortDefinition (1..1, Period)');
    else errors.push(...periodErrors('timeWindow', fields.timeWindow));
    if (fields.terminologyVersions.length === 0 || !fields.terminologyVersions.every(isNonEmptyString)) {
      errors.push('terminologyVersions é obrigatório para CohortDefinition (1..*, Reference)');
    }
    if (isNonEmptyString(fields.checksum) && !SHA256.test(fields.checksum)) {
      errors.push(`checksum deve ser um digest SHA-256: ${fields.checksum}`);
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

module.exports = CohortDefinitionModel;
