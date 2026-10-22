const crypto = require('crypto');
const { AXIS_CODES } = require('./RcsInputSnapshot');

// Canonical Data Model v2.0.0 RCSPreanalyticalAxisInput (V2E-0513..0523),
// RF018 AC5, AC6, AC9 and AC10 (#1320): one matrix-specific axis of an
// RCSInputSnapshot, with its observed SPREC code, severity, maximum weight,
// weighted penalty (eq:axis_penalty, p_i = W_i * s_i), mapping release,
// resolution status, applicable context and evidence.
//
// No flow writes this model yet. A later #1320 slice wires it into the
// assessment write, so no score, grade or route changes here (see
// docs/decisions/2026-10-22-rcs-input-snapshot-structures.md).

const ALL_AXIS_CODES = [...new Set([...AXIS_CODES.fluid, ...AXIS_CODES.solid])];

// INFERENCE, not a citation: V2E-0521's cell reads only `resolved`; the set
// is read from RULE-011's list of absent, unknown, invalid, incompatible and
// not_scored.
const RESOLUTION_STATUSES = ['resolved', 'absent', 'unknown', 'invalid', 'incompatible', 'not_scored'];

const REQUIRED_STRINGS = ['axisInputId', 'snapshotId', 'sprecCode', 'severityMappingReleaseId'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && !(value instanceof Date);
const isNumberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value)
  && value >= min && value <= max;
// rcs-certification.service.js's rounding of a penalty.
const round = (value) => Math.round(value * 1e6) / 1e6;

// Object.freeze is shallow, so each array and plain object is copied and
// frozen level by level. A Date is kept as it is.
const deepFreeze = (value) => {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  if (isPlainObject(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepFreeze(entry)])));
  }
  return value;
};

class RcsPreanalyticalAxisInputModel {
  static fieldsOf(data = {}) {
    return {
      axisInputId: data.axisInputId || crypto.randomUUID(),
      snapshotId: data.snapshotId ?? null,
      axisCode: data.axisCode ?? null,
      sprecCode: data.sprecCode ?? null,
      severity: data.severity ?? null,
      maximumWeight: data.maximumWeight ?? null,
      weightedPenalty: data.weightedPenalty ?? null,
      severityMappingReleaseId: data.severityMappingReleaseId ?? null,
      resolutionStatus: data.resolutionStatus ?? null,
      applicabilityContext: data.applicabilityContext ?? null,
      evidenceIds: Array.isArray(data.evidenceIds) ? data.evidenceIds : [],
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(fields[field])) errors.push(`${field} é obrigatório para RCSPreanalyticalAxisInput (1..1)`);
    }
    if (!ALL_AXIS_CODES.includes(fields.axisCode)) errors.push(`axisCode inválido: ${fields.axisCode}`);
    if (!isNumberIn(fields.maximumWeight, 0, 100)) {
      errors.push(`maximumWeight deve ser um número entre 0 e 100: ${fields.maximumWeight}`);
    }
    if (!RESOLUTION_STATUSES.includes(fields.resolutionStatus)) {
      errors.push(`resolutionStatus inválido: ${fields.resolutionStatus}`);
    } else if (fields.resolutionStatus === 'resolved') {
      if (!isNumberIn(fields.severity, 0, 1)) errors.push(`severity deve ser um número entre 0 e 1: ${fields.severity}`);
      if (typeof fields.weightedPenalty !== 'number') {
        errors.push('weightedPenalty é obrigatório para um eixo resolved (1..1)');
      } else if (isNumberIn(fields.severity, 0, 1) && isNumberIn(fields.maximumWeight, 0, 100)
        && fields.weightedPenalty !== round(fields.maximumWeight * fields.severity)) {
        // eq:axis_penalty: p_i = W_i * s_i.
        errors.push(`weightedPenalty deve ser maximumWeight * severity: ${fields.weightedPenalty}`);
      }
    } else {
      // RULE-011: an absent, unknown, invalid, incompatible or not_scored axis
      // never gets a zero penalty.
      // INFERENCE, not a citation: it carries null severity and penalty;
      // RULE-011 outranks V2E-0517's and V2E-0519's 1..1.
      if (fields.severity !== null) errors.push(`severity deve ser null para um eixo ${fields.resolutionStatus}, nunca 0`);
      if (fields.weightedPenalty !== null) {
        errors.push(`weightedPenalty deve ser null para um eixo ${fields.resolutionStatus}, nunca 0`);
      }
    }
    if (fields.applicabilityContext !== null && !isPlainObject(fields.applicabilityContext)) {
      errors.push('applicabilityContext deve ser um objeto (0..1)');
    }
    if (fields.evidenceIds.length === 0 || !fields.evidenceIds.every(isNonEmptyString)) {
      errors.push('evidenceIds é obrigatório para RCSPreanalyticalAxisInput (1..*, Reference)');
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

module.exports = RcsPreanalyticalAxisInputModel;
module.exports.RESOLUTION_STATUSES = RESOLUTION_STATUSES;
